use serde::Serialize;
use std::process::Stdio;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct WakeGuardStatus {
    pub available: bool,
    pub enabled: bool,
    pub process_id: Option<u32>,
    pub started_at: Option<String>,
    pub message: String,
}

struct WakeGuardInner {
    child: Option<Child>,
    started_at: Option<String>,
}

pub struct WakeGuardState {
    inner: Mutex<WakeGuardInner>,
    program: String,
    fixed_args: Option<Vec<String>>,
}

impl Default for WakeGuardState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(WakeGuardInner {
                child: None,
                started_at: None,
            }),
            program: default_wake_program().to_string(),
            fixed_args: None,
        }
    }
}

impl WakeGuardState {
    #[cfg(all(test, unix))]
    fn with_program(program: &str, args: Vec<String>) -> Self {
        Self {
            inner: Mutex::new(WakeGuardInner {
                child: None,
                started_at: None,
            }),
            program: program.to_string(),
            fixed_args: Some(args),
        }
    }

    pub async fn status(&self) -> WakeGuardStatus {
        let mut inner = self.inner.lock().await;
        if let Some(child) = inner.child.as_mut() {
            if child.try_wait().ok().flatten().is_some() {
                inner.child = None;
                inner.started_at = None;
            }
        }
        status_from_inner(&inner, self.is_available())
    }

    pub async fn set_enabled(&self, enabled: bool) -> Result<WakeGuardStatus, String> {
        let mut inner = self.inner.lock().await;
        if let Some(child) = inner.child.as_mut() {
            if child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_some()
            {
                inner.child = None;
                inner.started_at = None;
            }
        }

        if enabled && inner.child.is_none() {
            if !self.is_available() {
                return Err("Awake Mode requires macOS caffeinate".to_string());
            }
            let args = self
                .fixed_args
                .clone()
                .unwrap_or_else(|| build_caffeinate_args(std::process::id()));
            let child = Command::new(&self.program)
                .args(args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .spawn()
                .map_err(|error| format!("Could not start Awake Mode: {error}"))?;
            inner.child = Some(child);
            inner.started_at = Some(chrono::Utc::now().to_rfc3339());
        } else if !enabled {
            if let Some(mut child) = inner.child.take() {
                child
                    .kill()
                    .await
                    .map_err(|error| format!("Could not stop Awake Mode: {error}"))?;
                let _ = child.wait().await;
            }
            inner.started_at = None;
        }

        Ok(status_from_inner(&inner, self.is_available()))
    }

    #[cfg(any(target_os = "macos", test))]
    pub async fn pulse_user_activity(&self) -> Result<bool, String> {
        if !self.status().await.enabled {
            return Ok(false);
        }

        #[cfg(target_os = "macos")]
        {
            let status = Command::new(&self.program)
                .args(build_user_activity_args())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .map_err(|error| format!("Could not pulse user activity: {error}"))?;
            if status.success() {
                Ok(true)
            } else {
                Err(format!("User activity pulse exited with {status}"))
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            Err("Awake Mode user-activity pulses are available on macOS only".to_string())
        }
    }

    #[cfg(any(target_os = "macos", all(test, unix)))]
    pub async fn reconcile_desired_state(
        &self,
        desired_enabled: bool,
    ) -> Result<WakeGuardStatus, String> {
        self.set_enabled(desired_enabled).await
    }

    fn is_available(&self) -> bool {
        if self.fixed_args.is_some() {
            return true;
        }
        #[cfg(target_os = "macos")]
        {
            std::path::Path::new(&self.program).is_file()
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }
}

#[cfg(target_os = "macos")]
fn default_wake_program() -> &'static str {
    "/usr/bin/caffeinate"
}

#[cfg(not(target_os = "macos"))]
fn default_wake_program() -> &'static str {
    ""
}

fn status_from_inner(inner: &WakeGuardInner, available: bool) -> WakeGuardStatus {
    let process_id = inner.child.as_ref().and_then(Child::id);
    WakeGuardStatus {
        available,
        enabled: process_id.is_some(),
        process_id,
        started_at: inner.started_at.clone(),
        message: if process_id.is_some() {
            "HumHum is keeping this Mac awake".to_string()
        } else if available {
            "Awake Mode is off".to_string()
        } else {
            "Awake Mode is unavailable on this device".to_string()
        },
    }
}

fn build_caffeinate_args(pid: u32) -> Vec<String> {
    vec![
        "-d".to_string(),
        "-i".to_string(),
        "-w".to_string(),
        pid.to_string(),
    ]
}

#[cfg(any(target_os = "macos", test))]
fn build_user_activity_args() -> Vec<String> {
    vec!["-u".to_string(), "-t".to_string(), "5".to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wake_guard_builds_display_idle_and_parent_watch_assertions() {
        assert_eq!(build_caffeinate_args(4242), vec!["-d", "-i", "-w", "4242"]);
        assert_eq!(build_user_activity_args(), vec!["-u", "-t", "5"]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn wake_guard_enable_is_idempotent_and_disable_releases_child() {
        let guard = WakeGuardState::with_program("/bin/sleep", vec!["30".to_string()]);
        guard.set_enabled(true).await.unwrap();
        let first = guard.status().await;
        guard.set_enabled(true).await.unwrap();
        let second = guard.status().await;

        assert!(first.enabled);
        assert_eq!(first.process_id, second.process_id);

        guard.set_enabled(false).await.unwrap();
        assert!(!guard.status().await.enabled);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn enabled_guard_restarts_after_its_child_exits() {
        let guard = WakeGuardState::with_program("/bin/sleep", vec!["0.05".to_string()]);
        let first = guard.set_enabled(true).await.unwrap().process_id.unwrap();

        let second = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                let status = guard.reconcile_desired_state(true).await.unwrap();
                if let Some(process_id) =
                    status.process_id.filter(|process_id| *process_id != first)
                {
                    break process_id;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("wake guard did not restart its exited child within 2 seconds");

        assert_ne!(first, second);
        guard.set_enabled(false).await.unwrap();
    }

    #[cfg(not(target_os = "macos"))]
    #[tokio::test]
    async fn default_guard_reports_macos_only_on_other_platforms() {
        let guard = WakeGuardState::default();

        let status = guard.status().await;
        assert!(!status.available);
        assert!(!status.enabled);
        assert!(guard.set_enabled(true).await.is_err());
        assert!(!guard.pulse_user_activity().await.unwrap());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "temporarily creates real macOS power assertions"]
    async fn real_wake_guard_registers_and_releases_power_assertions() {
        let guard = WakeGuardState::default();
        let enabled = guard.set_enabled(true).await.unwrap();
        let pid = enabled.process_id.unwrap().to_string();
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;

        let active = Command::new("/usr/bin/pmset")
            .args(["-g", "assertions"])
            .output()
            .await
            .unwrap();
        let active_text = String::from_utf8_lossy(&active.stdout);
        assert!(active_text.contains(&pid), "assertion owner {pid} missing");
        assert!(active_text.contains("PreventUserIdleDisplaySleep"));
        assert!(active_text.contains("PreventUserIdleSystemSleep"));

        guard.set_enabled(false).await.unwrap();
        let released = Command::new("/usr/bin/pmset")
            .args(["-g", "assertions"])
            .output()
            .await
            .unwrap();
        assert!(!String::from_utf8_lossy(&released.stdout).contains(&pid));
    }
}
