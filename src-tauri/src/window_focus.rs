use std::process::Command;

const TERMINALS: &[&str] = &["iTerm", "Terminal", "WezTerm", "Alacritty", "kitty"];

pub fn focus_terminal_app() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        for app in TERMINALS {
            let status = Command::new("osascript")
                .arg("-e")
                .arg(format!(
                    "tell application \"System Events\" to set frontmost of process \"{}\" to true",
                    app
                ))
                .output();

            if let Ok(output) = status {
                if output.status.success() {
                    return Ok(());
                }
            }
        }
        Err("No known terminal app found".to_string())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Window focus only supported on macOS".to_string())
    }
}

pub async fn type_in_terminal_async(text: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let escaped = text.replace('\\', "\\\\").replace('"', "\\\"");

        // Single osascript: find a terminal, activate it, wait, type, press Enter
        let script = format!(
            r#"
set termApps to {{"iTerm2", "iTerm", "Terminal", "WezTerm", "Alacritty", "kitty", "Cursor", "Code", "Warp"}}
set foundApp to ""
tell application "System Events"
    repeat with appName in termApps
        if exists (process appName) then
            set foundApp to appName as text
            set frontmost of process foundApp to true
            exit repeat
        end if
    end repeat
end tell
if foundApp is "" then
    error "No terminal found"
end if
delay 0.3
tell application "System Events"
    keystroke "{}"
    delay 0.05
    key code 36
end tell
"#,
            escaped
        );

        let output = tokio::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .await
            .map_err(|e| format!("osascript failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("osascript error: {}", stderr));
        }

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Err("type_in_terminal only supported on macOS".to_string())
    }
}
