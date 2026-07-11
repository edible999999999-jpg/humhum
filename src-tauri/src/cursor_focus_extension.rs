use crate::session_store::SessionRoute;
use std::path::{Path, PathBuf};

const EXTENSION_ID: &str = "humhum.session-focus";
const EXTENSION_VERSION: &str = "0.1.0";
const EXTENSION_JS: &str = include_str!("../../hooks/humhum-cursor-focus-extension.js");

fn extension_root(home: &Path) -> PathBuf {
    home.join(".cursor/extensions")
}

fn extension_dir(home: &Path) -> PathBuf {
    extension_root(home).join(format!("{EXTENSION_ID}-{EXTENSION_VERSION}"))
}

fn registry_path(home: &Path) -> PathBuf {
    extension_root(home).join("extensions.json")
}

fn read_registry(home: &Path) -> Result<Vec<serde_json::Value>, String> {
    let path = registry_path(home);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("Could not read Cursor extension registry: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Could not parse Cursor extension registry: {error}"))
}

fn write_registry(home: &Path, entries: &[serde_json::Value]) -> Result<(), String> {
    let path = registry_path(home);
    let content = serde_json::to_vec_pretty(entries)
        .map_err(|error| format!("Could not serialize Cursor extension registry: {error}"))?;
    std::fs::write(path, content)
        .map_err(|error| format!("Could not write Cursor extension registry: {error}"))
}

fn is_humhum_entry(entry: &serde_json::Value) -> bool {
    entry["identifier"]["id"].as_str() == Some(EXTENSION_ID)
}

pub fn install_at(home: &Path) -> Result<(), String> {
    let root = extension_root(home);
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create Cursor extension directory: {error}"))?;
    for entry in std::fs::read_dir(&root)
        .map_err(|error| format!("Could not inspect Cursor extensions: {error}"))?
        .filter_map(Result::ok)
    {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&format!("{EXTENSION_ID}-")) {
            std::fs::remove_dir_all(entry.path()).map_err(|error| {
                format!("Could not replace old HUMHUM Cursor extension: {error}")
            })?;
        }
    }

    let directory = extension_dir(home);
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create HUMHUM Cursor extension: {error}"))?;
    let manifest = serde_json::json!({
        "name": "session-focus",
        "displayName": "HUMHUM Session Focus",
        "description": "Returns HUMHUM to the matching Cursor terminal after local verification.",
        "version": EXTENSION_VERSION,
        "publisher": "humhum",
        "license": "MIT",
        "engines": { "vscode": "^1.85.0" },
        "categories": ["Other"],
        "activationEvents": ["onUri"],
        "main": "./extension.js",
        "contributes": {},
    });
    std::fs::write(
        directory.join("package.json"),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .map_err(|error| format!("Could not write Cursor extension manifest: {error}"))?;
    std::fs::write(directory.join("extension.js"), EXTENSION_JS)
        .map_err(|error| format!("Could not write Cursor extension runtime: {error}"))?;

    let mut registry = read_registry(home)?;
    registry.retain(|entry| !is_humhum_entry(entry));
    registry.push(serde_json::json!({
        "identifier": { "id": EXTENSION_ID },
        "version": EXTENSION_VERSION,
        "location": {
            "$mid": 1,
            "path": directory.to_string_lossy(),
            "scheme": "file"
        },
        "relativeLocation": directory.file_name().and_then(|name| name.to_str()),
        "metadata": {
            "installedTimestamp": chrono::Utc::now().timestamp_millis(),
            "source": "file",
            "isApplicationScoped": false,
            "isMachineScoped": false,
            "isBuiltin": false,
            "pinned": false
        }
    }));
    write_registry(home, &registry)
}

pub fn uninstall_at(home: &Path) -> Result<(), String> {
    let root = extension_root(home);
    if root.exists() {
        for entry in std::fs::read_dir(&root)
            .map_err(|error| format!("Could not inspect Cursor extensions: {error}"))?
            .filter_map(Result::ok)
        {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(&format!("{EXTENSION_ID}-"))
            {
                std::fs::remove_dir_all(entry.path()).map_err(|error| {
                    format!("Could not remove HUMHUM Cursor extension: {error}")
                })?;
            }
        }
    }
    let mut registry = read_registry(home)?;
    registry.retain(|entry| !is_humhum_entry(entry));
    write_registry(home, &registry)
}

pub fn is_installed_at(home: &Path) -> bool {
    extension_dir(home).join("package.json").is_file()
        && extension_dir(home).join("extension.js").is_file()
}

pub fn ensure_for_managed_hook(home: &Path) -> Result<bool, String> {
    let hooks = home.join(".cursor/hooks.json");
    if !hooks.is_file() {
        return Ok(false);
    }
    let content = std::fs::read_to_string(hooks)
        .map_err(|error| format!("Could not inspect Cursor hooks: {error}"))?;
    if !content.contains("humhum") {
        return Ok(false);
    }
    if !is_installed_at(home) {
        install_at(home)?;
    }
    Ok(true)
}

pub fn focus_request_url(
    workspace: &Path,
    route: &SessionRoute,
    nonce: &str,
) -> Result<String, String> {
    uuid::Uuid::parse_str(nonce).map_err(|_| "Invalid focus receipt id")?;
    let workspace = workspace
        .canonicalize()
        .map_err(|error| format!("Cursor workspace is unavailable: {error}"))?;
    if !workspace.is_dir() {
        return Err("Cursor workspace must be a directory".into());
    }
    let mut query = vec![
        ("cwd", workspace.to_string_lossy().to_string()),
        ("receipt", nonce.to_string()),
    ];
    if let Some(tty) = route.tty.as_deref().and_then(normalize_tty_hint) {
        query.push(("tty", tty));
    }
    if let Some(pid) = route.parent_pid.filter(|pid| *pid > 0) {
        query.push(("pid", pid.to_string()));
    }
    let encoded = query
        .into_iter()
        .map(|(name, value)| format!("{name}={}", percent_encode(&value)))
        .collect::<Vec<_>>()
        .join("&");
    Ok(format!("cursor://{EXTENSION_ID}/focus?{encoded}"))
}

pub fn receipt_path(home: &Path, nonce: &str) -> Result<PathBuf, String> {
    if uuid::Uuid::parse_str(nonce).is_err() {
        return Err("Invalid focus receipt id".into());
    }
    Ok(home.join(".humhum/cursor-focus").join(nonce))
}

fn normalize_tty_hint(value: &str) -> Option<String> {
    let suffix = value.trim().strip_prefix("/dev/").unwrap_or(value.trim());
    let digits = suffix.strip_prefix("ttys")?;
    (!digits.is_empty() && digits.chars().all(|character| character.is_ascii_digit()))
        .then(|| suffix.to_string())
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_without_replacing_other_cursor_extensions() {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().join(".cursor/extensions");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("extensions.json"),
            r#"[{"identifier":{"id":"someone.else"}}]"#,
        )
        .unwrap();

        install_at(home.path()).unwrap();

        assert!(is_installed_at(home.path()));
        let registry: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("extensions.json")).unwrap()).unwrap();
        assert!(registry
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| { entry["identifier"]["id"] == "someone.else" }));
        assert!(registry
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| { entry["identifier"]["id"] == "humhum.session-focus" }));

        uninstall_at(home.path()).unwrap();
        assert!(!is_installed_at(home.path()));
        let registry: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("extensions.json")).unwrap()).unwrap();
        assert_eq!(registry.as_array().unwrap().len(), 1);
    }

    #[test]
    fn focus_uri_encodes_workspace_and_uses_only_safe_route_hints() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = temp.path().join("project with spaces");
        std::fs::create_dir(&workspace).unwrap();
        let route = SessionRoute {
            tty: Some("ttys007".into()),
            parent_pid: Some(1234),
            ..SessionRoute::default()
        };
        let nonce = "019f2dc3-34d4-7051-81fe-d1d5ab043849";

        let url = focus_request_url(&workspace, &route, nonce).unwrap();

        assert!(url.starts_with("cursor://humhum.session-focus/focus?"));
        assert!(url.contains("cwd=%2F"));
        assert!(url.contains("tty=ttys007"));
        assert!(url.contains("pid=1234"));
        assert!(url.contains(&format!("receipt={nonce}")));
        assert!(focus_request_url(&workspace, &route, "../../escape").is_err());
    }

    #[test]
    fn migration_installs_only_when_humhum_manages_cursor_hooks() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".cursor")).unwrap();
        std::fs::write(home.path().join(".cursor/hooks.json"), "{}").unwrap();
        assert!(!ensure_for_managed_hook(home.path()).unwrap());
        assert!(!is_installed_at(home.path()));

        std::fs::write(
            home.path().join(".cursor/hooks.json"),
            r#"{"hooks":{"sessionStart":[{"command":"~/.humhum/hooks/humhum-hook.sh"}]}}"#,
        )
        .unwrap();
        assert!(ensure_for_managed_hook(home.path()).unwrap());
        assert!(is_installed_at(home.path()));
    }
}
