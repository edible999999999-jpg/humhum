use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

/// Manages the QoderWork auto-allow Python daemon as a sidecar process.
pub struct QoderAutoAllow {
    child: Arc<Mutex<Option<Child>>>,
    script_path: PathBuf,
    venv_python: PathBuf,
}

impl QoderAutoAllow {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

        let script_path = Self::find_script();

        let venv_python = home
            .join(".qoderwork-auto-allow")
            .join("venv")
            .join("bin")
            .join("python3");

        Self {
            child: Arc::new(Mutex::new(None)),
            script_path,
            venv_python,
        }
    }

    fn find_script() -> PathBuf {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

        let candidates = vec![
            // Tauri dev mode: relative to project root
            PathBuf::from("src-tauri/scripts/qw-auto-allow.py"),
            // Tauri prod mode: inside app bundle Resources
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.join("../Resources/scripts/qw-auto-allow.py")))
                .unwrap_or_default(),
            // Fallback: user's home directory
            home.join(".qoderwork-auto-allow/qw-auto-allow.py"),
        ];

        for path in candidates {
            if path.exists() {
                log::info!("Found qw-auto-allow.py at: {:?}", path);
                return path;
            }
        }

        let fallback = home.join(".qoderwork-auto-allow/qw-auto-allow.py");
        log::warn!("qw-auto-allow.py not found, fallback to: {:?}", fallback);
        fallback
    }

    /// Start the Python daemon as a sidecar process.
    pub fn start(&self) -> Result<(), String> {
        // Check if already running
        {
            let guard = self.child.lock().map_err(|e| e.to_string())?;
            if let Some(ref child) = *guard {
                let id = child.id();
                if is_process_alive(id) {
                    log::info!("QoderWork auto-allow already running (PID: {})", id);
                    return Ok(());
                }
            }
        }

        if !self.script_path.exists() {
            return Err(format!(
                "Script not found: {:?}",
                self.script_path
            ));
        }

        let python = if self.venv_python.exists() {
            self.venv_python.clone()
        } else {
            PathBuf::from("python3")
        };

        log::info!(
            "Starting QoderWork auto-allow: {:?} {:?}",
            python,
            self.script_path
        );

        let child = Command::new(&python)
            .arg(&self.script_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start daemon: {}", e))?;

        let pid = child.id();
        log::info!("QoderWork auto-allow started (PID: {})", pid);

        let mut guard = self.child.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);

        Ok(())
    }

    /// Stop the Python daemon.
    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|e| e.to_string())?;

        if let Some(child) = guard.take() {
            let pid = child.id();
            log::info!("Stopping QoderWork auto-allow (PID: {})", pid);

            #[cfg(unix)]
            {
                let _ = Command::new("kill")
                    .arg(pid.to_string())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn();
            }

            #[cfg(windows)]
            {
                let _ = child.kill();
            }

            log::info!("QoderWork auto-allow stopped");
        } else {
            log::debug!("QoderWork auto-allow not running");
        }

        Ok(())
    }

    /// Check if the daemon is currently running.
    pub fn is_running(&self) -> bool {
        if let Ok(guard) = self.child.lock() {
            if let Some(ref child) = *guard {
                return is_process_alive(child.id());
            }
        }
        false
    }
}

impl Drop for QoderAutoAllow {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    #[cfg(windows)]
    {
        false
    }
}
