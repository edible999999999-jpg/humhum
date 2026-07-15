use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::time::Duration;

pub async fn discover_tailnet_ipv4() -> Option<Ipv4Addr> {
    discover_from_candidates(&tailscale_cli_candidates(), Duration::from_secs(2)).await
}

fn parse_tailnet_ipv4(output: &[u8]) -> Option<Ipv4Addr> {
    if output.len() > 64 {
        return None;
    }
    let text = std::str::from_utf8(output).ok()?;
    let value = text.trim_end_matches(['\r', '\n']);
    if value.is_empty() || value.contains(['\r', '\n']) || value.trim() != value {
        return None;
    }
    let address: Ipv4Addr = value.parse().ok()?;
    let [first, second, third, fourth] = address.octets();
    let in_cgnat = first == 100 && (64..=127).contains(&second);
    let network_boundary = second == 64 && third == 0 && fourth == 0;
    let broadcast_boundary = second == 127 && third == 255 && fourth == 255;
    let reserved = second == 100 && (third == 0 || third == 100);
    (in_cgnat && !network_boundary && !broadcast_boundary && !reserved).then_some(address)
}

fn tailscale_cli_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from("tailscale")];

    #[cfg(target_os = "windows")]
    {
        push_unique(&mut candidates, PathBuf::from("tailscale.exe"));
        for root in ["ProgramFiles", "ProgramW6432", "LOCALAPPDATA"] {
            if let Some(root) = std::env::var_os(root).map(PathBuf::from) {
                push_unique(
                    &mut candidates,
                    root.join("Tailscale").join("tailscale.exe"),
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    for path in [
        "/usr/local/bin/tailscale",
        "/opt/homebrew/bin/tailscale",
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    ] {
        push_unique(&mut candidates, PathBuf::from(path));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    for path in ["/usr/bin/tailscale", "/usr/local/bin/tailscale"] {
        push_unique(&mut candidates, PathBuf::from(path));
    }

    candidates
}

fn push_unique(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidates.contains(&candidate) {
        candidates.push(candidate);
    }
}

async fn discover_from_candidates(paths: &[PathBuf], limit: Duration) -> Option<Ipv4Addr> {
    let discovery = async {
        for path in paths {
            let mut command = tokio::process::Command::new(path);
            command
                .args(["ip", "-4"])
                .env("TAILSCALE_BE_CLI", "1")
                .kill_on_drop(true);
            let Ok(output) = command.output().await else {
                continue;
            };
            if output.status.success() {
                if let Some(address) = parse_tailnet_ipv4(&output.stdout) {
                    return Some(address);
                }
            }
        }
        None
    };
    tokio::time::timeout(limit, discovery).await.ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    #[cfg(unix)]
    use std::time::Duration;

    #[test]
    fn accepts_only_one_assignable_cgnat_ipv4() {
        assert_eq!(
            parse_tailnet_ipv4(b"100.64.0.1\n"),
            Some("100.64.0.1".parse().unwrap())
        );
        assert_eq!(
            parse_tailnet_ipv4(b"100.127.255.254\n"),
            Some("100.127.255.254".parse().unwrap())
        );
        assert_eq!(parse_tailnet_ipv4(b"100.64.0.0\n"), None);
        assert_eq!(parse_tailnet_ipv4(b"100.127.255.255\n"), None);
        assert_eq!(parse_tailnet_ipv4(b"100.100.100.100\n"), None);
        assert_eq!(parse_tailnet_ipv4(b"192.168.1.20\n"), None);
        assert_eq!(parse_tailnet_ipv4(b"8.8.8.8\n"), None);
        assert_eq!(parse_tailnet_ipv4(b"100.70.1.2\n100.70.1.3\n"), None);
        assert_eq!(parse_tailnet_ipv4(b"status: 100.70.1.2\n"), None);
        assert_eq!(parse_tailnet_ipv4(&[0xff, 0xfe]), None);
    }

    #[test]
    fn candidates_include_platform_and_path_entries() {
        let candidates = tailscale_cli_candidates();

        assert!(candidates.contains(&"tailscale".into()));
        #[cfg(target_os = "windows")]
        assert!(candidates.contains(&"tailscale.exe".into()));
        #[cfg(target_os = "macos")]
        {
            assert!(candidates.contains(&"/usr/local/bin/tailscale".into()));
            assert!(candidates.contains(&"/opt/homebrew/bin/tailscale".into()));
            assert!(
                candidates.contains(&"/Applications/Tailscale.app/Contents/MacOS/Tailscale".into())
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn executable_fixture_succeeds_and_nonzero_or_timeout_falls_back() {
        let temp = tempfile::tempdir().unwrap();
        let valid = fixture(temp.path(), "valid", "printf '100.101.2.3\\n'", 0);
        let failed = fixture(temp.path(), "failed", "printf '100.102.3.4\\n'", 7);
        let sleeping = fixture(
            temp.path(),
            "sleeping",
            "sleep 5; printf '100.103.4.5\\n'",
            0,
        );

        assert_eq!(
            discover_from_candidates(&[valid], Duration::from_secs(1)).await,
            Some("100.101.2.3".parse().unwrap())
        );
        assert_eq!(
            discover_from_candidates(&[failed], Duration::from_secs(1)).await,
            None
        );
        let started = std::time::Instant::now();
        assert_eq!(
            discover_from_candidates(&[sleeping], Duration::from_millis(100)).await,
            None
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    fn fixture(root: &std::path::Path, name: &str, body: &str, exit: i32) -> std::path::PathBuf {
        let path = root.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\nexit {exit}\n")).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }
}
