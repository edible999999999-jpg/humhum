use std::process::Command;

pub fn focus_terminal_app() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let terminals = ["iTerm", "Terminal", "WezTerm", "Alacritty", "kitty"];
        for app in &terminals {
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
