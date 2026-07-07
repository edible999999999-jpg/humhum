use std::fs;
use std::path::PathBuf;

/// Manages the QoderWork PermissionRequest hook in settings.json.
///
/// Instead of a CDP-injected sidecar daemon, we now use QoderWork's native
/// hook system: add a PermissionRequest hook that returns `{"decision":{"behavior":"allow"}}`.
/// This is the same protocol-level approach used by Claude Code / Codex / etc.
pub struct QoderAutoAllow {
    settings_path: PathBuf,
}

impl QoderAutoAllow {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let settings_path = home.join(".qoderwork").join("settings.json");

        Self { settings_path }
    }

    /// Enable the auto-allow hook by adding a PermissionRequest entry to settings.json.
    pub fn enable(&self) -> Result<(), String> {
        let raw = fs::read_to_string(&self.settings_path)
            .map_err(|e| format!("Failed to read settings.json: {}", e))?;

        let mut json: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse settings.json: {}", e))?;

        let hooks = json
            .as_object_mut()
            .and_then(|o| o.get_mut("hooks"))
            .and_then(|h| h.as_object_mut())
            .ok_or("No hooks section in settings.json")?;

        // Only add if not already present
        if !hooks.contains_key("PermissionRequest") {
            let entry = serde_json::json!([{
                "hooks": [{
                    "command": "~/.qoderwork/hooks/auto-allow-permission.sh",
                    "timeout": 5,
                    "type": "command"
                }],
                "matcher": "*"
            }]);

            hooks.insert("PermissionRequest".to_string(), entry);

            // Write back with preserved formatting (pretty print)
            let output = serde_json::to_string_pretty(&json)
                .map_err(|e| format!("Failed to serialize settings.json: {}", e))?;

            fs::write(&self.settings_path, output)
                .map_err(|e| format!("Failed to write settings.json: {}", e))?;

            log::info!("QoderWork PermissionRequest hook enabled");
        } else {
            log::info!("QoderWork PermissionRequest hook already enabled");
        }

        Ok(())
    }

    /// Disable the auto-allow hook by removing the PermissionRequest entry from settings.json.
    pub fn disable(&self) -> Result<(), String> {
        let raw = fs::read_to_string(&self.settings_path)
            .map_err(|e| format!("Failed to read settings.json: {}", e))?;

        let mut json: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse settings.json: {}", e))?;

        let hooks = json
            .as_object_mut()
            .and_then(|o| o.get_mut("hooks"))
            .and_then(|h| h.as_object_mut());

        if let Some(hooks) = hooks {
            if hooks.remove("PermissionRequest").is_some() {
                let output = serde_json::to_string_pretty(&json)
                    .map_err(|e| format!("Failed to serialize settings.json: {}", e))?;

                fs::write(&self.settings_path, output)
                    .map_err(|e| format!("Failed to write settings.json: {}", e))?;

                log::info!("QoderWork PermissionRequest hook disabled");
            }
        }

        Ok(())
    }

    /// Check if the auto-allow hook is currently active.
    pub fn is_enabled(&self) -> bool {
        match fs::read_to_string(&self.settings_path) {
            Ok(raw) => {
                match serde_json::from_str::<serde_json::Value>(&raw) {
                    Ok(json) => json
                        .get("hooks")
                        .and_then(|h| h.get("PermissionRequest"))
                        .is_some(),
                    Err(_) => false,
                }
            }
            Err(_) => false,
        }
    }
}
