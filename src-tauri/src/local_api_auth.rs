use std::io::Write;
use std::path::Path;

pub const TOKEN_HEADER: &str = "x-humhum-token";

#[derive(Debug)]
pub struct LocalApiAuth {
    token: String,
}

impl LocalApiAuth {
    #[cfg(test)]
    fn from_token(token: String) -> Self {
        Self { token }
    }

    pub fn load_or_create(humhum_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(humhum_dir)
            .map_err(|error| format!("Could not create HUMHUM directory: {error}"))?;
        let token_path = humhum_dir.join("local-api-token");
        if std::fs::symlink_metadata(&token_path)
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err("Local API token cannot be a symbolic link".into());
        }
        let token = if token_path.exists() {
            protect_owner_only(&token_path)?;
            std::fs::read_to_string(&token_path)
                .map_err(|error| format!("Could not read local API token: {error}"))?
                .trim()
                .to_string()
        } else {
            let token = uuid::Uuid::new_v4().to_string();
            write_new_token(&token_path, &token)?;
            token
        };
        if token.is_empty() {
            return Err("Local API token is empty".into());
        }

        Ok(Self { token })
    }

    pub fn authorizes(&self, candidate: Option<&str>) -> bool {
        candidate.is_some_and(|value| constant_time_eq(value.as_bytes(), self.token.as_bytes()))
    }
}

fn write_new_token(path: &Path, token: &str) -> Result<(), String> {
    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("Could not create local API token: {error}"))?;
    if let Err(error) = protect_owner_only(path) {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err(error);
    }
    let result = file
        .write_all(format!("{token}\n").as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Could not write local API token: {error}"));
    if result.is_err() {
        drop(file);
        let _ = std::fs::remove_file(path);
    }
    result
}

#[cfg(unix)]
pub(crate) fn protect_owner_only(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = std::fs::metadata(path)
        .map_err(|error| format!("Could not inspect private HUMHUM file: {error}"))?
        .permissions();
    permissions.set_mode(0o600);
    std::fs::set_permissions(path, permissions)
        .map_err(|error| format!("Could not protect private HUMHUM file: {error}"))
}

#[cfg(target_os = "windows")]
pub(crate) fn protect_owner_only(path: &Path) -> Result<(), String> {
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{
        SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
    };

    let sid = current_windows_user_sid()?;
    let sddl = windows_owner_only_sddl(&sid)?;
    let sddl_wide = std::ffi::OsStr::new(&sddl)
        .encode_wide()
        .chain(once(0))
        .collect::<Vec<_>>();
    let path_wide = path
        .as_os_str()
        .encode_wide()
        .chain(once(0))
        .collect::<Vec<_>>();
    let mut descriptor = null_mut();
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl_wide.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            null_mut(),
        )
    };
    if converted == 0 {
        return Err(windows_api_error(
            "Could not build private HUMHUM file ACL",
            unsafe { GetLastError() },
        ));
    }

    let applied = unsafe {
        SetFileSecurityW(
            path_wide.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor,
        )
    };
    let apply_error = (applied == 0).then(|| unsafe { GetLastError() });
    unsafe {
        let _ = LocalFree(descriptor);
    }
    if let Some(error) = apply_error {
        Err(windows_api_error(
            "Could not protect private HUMHUM file",
            error,
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(any(unix, target_os = "windows")))]
pub(crate) fn protect_owner_only(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Write a private file without publishing the new contents until its owner-only
/// permissions have been applied. Existing destinations are protected first so
/// both ReplaceFileW (which may preserve destination metadata) and MoveFileExW
/// remain safe.
pub(crate) fn write_private_file_atomically(
    destination: &Path,
    contents: &[u8],
) -> Result<(), String> {
    write_private_file_atomically_with(destination, contents, protect_owner_only)
}

fn write_private_file_atomically_with(
    destination: &Path,
    contents: &[u8],
    mut protect: impl FnMut(&Path) -> Result<(), String>,
) -> Result<(), String> {
    if let Ok(metadata) = std::fs::symlink_metadata(destination) {
        if metadata.file_type().is_symlink() {
            return Err("Private HUMHUM file cannot be a symbolic link".into());
        }
        protect(destination)?;
    }

    crate::knowledge_store::write_file_atomically_with(destination, contents, |temporary| {
        protect(temporary)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::PermissionDenied, error))
    })
    .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn current_windows_user_sid() -> Result<String, String> {
    static CURRENT_USER_SID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    if let Some(sid) = CURRENT_USER_SID.get() {
        return Ok(sid.clone());
    }
    let sid = query_windows_user_sid()?;
    let _ = CURRENT_USER_SID.set(sid.clone());
    Ok(CURRENT_USER_SID.get().cloned().unwrap_or(sid))
}

#[cfg(target_os = "windows")]
fn query_windows_user_sid() -> Result<String, String> {
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, LocalFree, ERROR_INSUFFICIENT_BUFFER,
    };
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(windows_api_error(
            "Could not open the current process token",
            unsafe { GetLastError() },
        ));
    }

    let result = (|| {
        let mut required_bytes = 0_u32;
        let initial = unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                std::ptr::null_mut(),
                0,
                &mut required_bytes,
            )
        };
        let initial_error = unsafe { GetLastError() };
        if initial != 0 || initial_error != ERROR_INSUFFICIENT_BUFFER || required_bytes == 0 {
            return Err(windows_api_error(
                "Could not size the current user SID",
                initial_error,
            ));
        }

        let word_size = std::mem::size_of::<usize>();
        let mut token_information = vec![0_usize; (required_bytes as usize).div_ceil(word_size)];
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                token_information.as_mut_ptr().cast(),
                required_bytes,
                &mut required_bytes,
            )
        } == 0
        {
            return Err(windows_api_error(
                "Could not read the current user SID",
                unsafe { GetLastError() },
            ));
        }

        let token_user = unsafe { &*token_information.as_ptr().cast::<TOKEN_USER>() };
        if token_user.User.Sid.is_null() {
            return Err("Windows returned an empty current user SID".into());
        }
        let mut sid_string = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(token_user.User.Sid, &mut sid_string) } == 0 {
            return Err(windows_api_error(
                "Could not format the current user SID",
                unsafe { GetLastError() },
            ));
        }

        let sid = unsafe {
            let length = (0..256)
                .find(|offset| *sid_string.add(*offset) == 0)
                .ok_or_else(|| "Windows returned an overlong current user SID".to_string());
            let value = length.map(|length| {
                String::from_utf16_lossy(std::slice::from_raw_parts(sid_string, length))
            });
            let _ = LocalFree(sid_string.cast());
            value
        }?;
        if is_windows_sid(&sid) {
            Ok(sid)
        } else {
            Err("Windows returned an invalid current user SID".into())
        }
    })();

    unsafe {
        let _ = CloseHandle(token);
    }
    result
}

#[cfg(target_os = "windows")]
fn windows_api_error(description: &str, code: u32) -> String {
    format!(
        "{description}: {}",
        std::io::Error::from_raw_os_error(code as i32)
    )
}

#[cfg(test)]
fn parse_windows_user_sid(output: &[u8]) -> Option<String> {
    String::from_utf8_lossy(output)
        .split(|character: char| character == ',' || character == '"' || character.is_whitespace())
        .find(|field| is_windows_sid(field))
        .map(str::to_string)
}

#[cfg(any(target_os = "windows", test))]
fn is_windows_sid(value: &str) -> bool {
    value.len() <= 184
        && value.starts_with("S-1-")
        && value
            .split('-')
            .skip(1)
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

#[cfg(any(target_os = "windows", test))]
fn windows_owner_only_sddl(sid: &str) -> Result<String, String> {
    if is_windows_sid(sid) {
        Ok(format!("D:P(A;;FA;;;{sid})"))
    } else {
        Err("Could not protect private HUMHUM file: current user SID is invalid".into())
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_exact_local_api_token() {
        let auth = LocalApiAuth::from_token("secret-token".into());
        assert!(auth.authorizes(Some("secret-token")));
        assert!(!auth.authorizes(Some("wrong")));
        assert!(!auth.authorizes(None));
    }

    #[test]
    fn parses_windows_user_sid_without_trusting_the_account_name() {
        let output = br#""ACME\alice,admin","S-1-5-21-123-456-789-1001"\r\n"#;

        assert_eq!(
            parse_windows_user_sid(output).as_deref(),
            Some("S-1-5-21-123-456-789-1001")
        );
        assert_eq!(
            windows_owner_only_sddl("S-1-5-21-123-456-789-1001").unwrap(),
            "D:P(A;;FA;;;S-1-5-21-123-456-789-1001)"
        );
        assert!(windows_owner_only_sddl("S-1-5-21-1 /grant Everyone:F").is_err());
        assert_eq!(parse_windows_user_sid(b"not a SID"), None);
    }

    #[test]
    fn private_atomic_write_does_not_commit_when_permission_setup_fails() {
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("private.json");
        std::fs::write(&destination, b"old contents").unwrap();

        let result =
            write_private_file_atomically_with(&destination, b"new secret contents", |path| {
                if path == destination {
                    Ok(())
                } else {
                    assert_eq!(std::fs::metadata(path).unwrap().len(), 0);
                    Err("injected ACL failure".into())
                }
            });

        assert!(result.unwrap_err().contains("injected ACL failure"));
        assert_eq!(std::fs::read(&destination).unwrap(), b"old contents");
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn token_file_is_created_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let auth = LocalApiAuth::load_or_create(temp.path()).unwrap();
        let token_path = temp.path().join("local-api-token");

        assert!(auth.authorizes(Some(std::fs::read_to_string(&token_path).unwrap().trim())));
        assert_eq!(
            std::fs::metadata(token_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn private_file_has_one_protected_full_control_ace_on_windows() {
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("private.json");
        write_private_file_atomically(&destination, b"private contents").unwrap();
        let sid = current_windows_user_sid().unwrap();
        let script = r#"
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $env:HUMHUM_ACL_TEST_PATH
$rules = @($acl.Access)
if (-not $acl.AreAccessRulesProtected) { exit 10 }
if ($rules.Count -ne 1) { exit 11 }
$ruleSid = $rules[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
if ($ruleSid -ne $env:HUMHUM_ACL_TEST_SID) { exit 12 }
if ($rules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { exit 13 }
if ($rules[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) { exit 14 }
if ($rules[0].IsInherited) { exit 15 }
"#;
        let system_root = std::env::var_os("SystemRoot").expect("SystemRoot is unavailable");
        let powershell = std::path::PathBuf::from(system_root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new(powershell);
        command.creation_flags(0x0800_0000);
        let output = command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ])
            .env("HUMHUM_ACL_TEST_PATH", &destination)
            .env("HUMHUM_ACL_TEST_SID", sid)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "ACL assertion failed with {}: {}{}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
