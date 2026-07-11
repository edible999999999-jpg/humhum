use crate::session_store::SessionRoute;
use serde::Serialize;
use std::process::Command;

const TERMINALS: &[&str] = &[
    "iTerm2",
    "iTerm",
    "Terminal",
    "Ghostty",
    "Warp",
    "WezTerm",
    "Alacritty",
    "kitty",
    "Cursor",
    "Code",
];

#[derive(Debug, Clone, PartialEq, Eq)]
enum FocusStrategy {
    TmuxPane(String),
    ITermSession(String),
    Application(String),
    GenericTerminal,
}

#[derive(Debug, Clone, Serialize)]
pub struct FocusResult {
    pub strategy: String,
    pub application: Option<String>,
    pub exact: bool,
}

fn normalize_terminal_application(program: &str) -> Option<&'static str> {
    let normalized = program
        .trim()
        .trim_end_matches(".app")
        .to_ascii_lowercase()
        .replace(['_', '-', ' '], "");
    match normalized.as_str() {
        "iterm" | "iterm2" => Some("iTerm2"),
        "appleterminal" | "terminal" => Some("Terminal"),
        "ghostty" => Some("Ghostty"),
        "warp" | "warpterminal" => Some("Warp"),
        "wezterm" => Some("WezTerm"),
        "alacritty" => Some("Alacritty"),
        "kitty" => Some("kitty"),
        "cursor" => Some("Cursor"),
        "code" | "vscode" | "visualstudiocode" => Some("Code"),
        _ => None,
    }
}

fn is_valid_tmux_pane(value: &str) -> bool {
    value
        .strip_prefix('%')
        .is_some_and(|digits| !digits.is_empty() && digits.chars().all(|ch| ch.is_ascii_digit()))
}

fn choose_focus_strategy(route: &SessionRoute) -> FocusStrategy {
    if let Some(pane) = route
        .tmux_pane
        .as_deref()
        .filter(|pane| is_valid_tmux_pane(pane))
    {
        return FocusStrategy::TmuxPane(pane.to_string());
    }
    if let Some(session) = route
        .iterm_session_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        return FocusStrategy::ITermSession(session.to_string());
    }
    if let Some(application) = route
        .term_program
        .as_deref()
        .and_then(normalize_terminal_application)
    {
        return FocusStrategy::Application(application.to_string());
    }
    FocusStrategy::GenericTerminal
}

pub fn focus_agent_route(route: Option<&SessionRoute>) -> Result<FocusResult, String> {
    let strategy = route
        .map(choose_focus_strategy)
        .unwrap_or(FocusStrategy::GenericTerminal);
    match strategy {
        FocusStrategy::TmuxPane(pane) => {
            focus_tmux_pane(&pane)?;
            let application = route
                .and_then(|item| item.term_program.as_deref())
                .and_then(normalize_terminal_application)
                .map(str::to_string);
            if let Some(app) = application.as_deref() {
                activate_application(app)?;
            } else {
                focus_terminal_app()?;
            }
            Ok(FocusResult {
                strategy: "tmux_pane".into(),
                application,
                exact: true,
            })
        }
        FocusStrategy::ITermSession(session_id) => {
            focus_iterm_session(&session_id)?;
            Ok(FocusResult {
                strategy: "iterm_session".into(),
                application: Some("iTerm2".into()),
                exact: true,
            })
        }
        FocusStrategy::Application(application) => {
            activate_application(&application)?;
            Ok(FocusResult {
                strategy: "application".into(),
                application: Some(application),
                exact: false,
            })
        }
        FocusStrategy::GenericTerminal => {
            focus_terminal_app()?;
            Ok(FocusResult {
                strategy: "generic_terminal".into(),
                application: None,
                exact: false,
            })
        }
    }
}

pub fn focus_codex_thread(thread_id: &str) -> Result<FocusResult, String> {
    let url =
        codex_thread_url(thread_id).ok_or_else(|| "Invalid Codex thread identifier".to_string())?;
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .args(["-b", "com.openai.codex", &url])
            .output()
            .map_err(|error| format!("Could not open Codex thread: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Could not open Codex thread: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(FocusResult {
            strategy: "codex_thread".into(),
            application: Some("Codex".into()),
            exact: true,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = url;
        Err("Codex thread focus only supported on macOS".into())
    }
}

fn codex_thread_url(thread_id: &str) -> Option<String> {
    let valid = !thread_id.is_empty()
        && thread_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':')
        });
    valid.then(|| format!("codex://threads/{thread_id}"))
}

fn valid_cursor_workspace(path: &std::path::Path) -> bool {
    path.is_absolute() && path.is_dir()
}

pub fn focus_cursor_workspace(workspace: &str) -> Result<FocusResult, String> {
    let path = std::path::Path::new(workspace);
    if !valid_cursor_workspace(path) {
        return Err("Cursor workspace must be an existing absolute directory".into());
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .args(["-b", "com.todesktop.230313mzl4w4u92"])
            .arg(path)
            .output()
            .map_err(|error| format!("Could not open Cursor workspace: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Could not open Cursor workspace: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(FocusResult {
            strategy: "cursor_workspace".into(),
            application: Some("Cursor".into()),
            exact: true,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Cursor workspace focus only supported on macOS".into())
    }
}

fn focus_tmux_pane(pane: &str) -> Result<(), String> {
    if !is_valid_tmux_pane(pane) {
        return Err("Invalid tmux pane identifier".into());
    }
    let window = Command::new("tmux")
        .args(["select-window", "-t", pane])
        .output()
        .map_err(|error| format!("Could not run tmux: {error}"))?;
    if !window.status.success() {
        return Err(format!(
            "Could not select tmux window: {}",
            String::from_utf8_lossy(&window.stderr).trim()
        ));
    }
    let selected = Command::new("tmux")
        .args(["select-pane", "-t", pane])
        .output()
        .map_err(|error| format!("Could not run tmux: {error}"))?;
    if !selected.status.success() {
        return Err(format!(
            "Could not select tmux pane: {}",
            String::from_utf8_lossy(&selected.stderr).trim()
        ));
    }
    Ok(())
}

fn activate_application(application: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let escaped = application.replace('"', "\\\"");
        let output = Command::new("osascript")
            .args(["-e", &format!("tell application \"{escaped}\" to activate")])
            .output()
            .map_err(|error| format!("Could not activate {application}: {error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "Could not activate {application}: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = application;
        Err("Window focus only supported on macOS".into())
    }
}

fn focus_iterm_session(session_id: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let escaped = session_id.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            r#"tell application "iTerm2"
activate
repeat with aWindow in windows
repeat with aTab in tabs of aWindow
repeat with aSession in sessions of aTab
if (unique ID of aSession as text) is in "{escaped}" then
select aTab
select aSession
return
end if
end repeat
end repeat
end repeat
error "iTerm session not found"
end tell"#
        );
        let output = Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|error| format!("Could not focus iTerm session: {error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = session_id;
        Err("Window focus only supported on macOS".into())
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::SessionRoute;

    #[test]
    fn normalizes_terminal_programs_to_macos_process_names() {
        assert_eq!(normalize_terminal_application("iTerm.app"), Some("iTerm2"));
        assert_eq!(
            normalize_terminal_application("Apple_Terminal"),
            Some("Terminal")
        );
        assert_eq!(normalize_terminal_application("ghostty"), Some("Ghostty"));
        assert_eq!(normalize_terminal_application("unknown-shell"), None);
    }

    #[test]
    fn accepts_only_tmux_pane_identifiers() {
        assert!(is_valid_tmux_pane("%12"));
        assert!(!is_valid_tmux_pane("demo:1.2"));
        assert!(!is_valid_tmux_pane("%1; open -a Calculator"));
    }

    #[test]
    fn exact_tmux_route_has_priority_over_terminal_fallback() {
        let route = SessionRoute {
            term_program: Some("Ghostty".into()),
            tmux_pane: Some("%7".into()),
            ..SessionRoute::default()
        };
        assert_eq!(
            choose_focus_strategy(&route),
            FocusStrategy::TmuxPane("%7".into())
        );
    }

    #[test]
    fn codex_thread_urls_accept_only_stable_thread_identifiers() {
        assert_eq!(
            codex_thread_url("019f26d2-b29e-7b50-a232-520d8a1a9d49"),
            Some("codex://threads/019f26d2-b29e-7b50-a232-520d8a1a9d49".into())
        );
        assert_eq!(codex_thread_url("thread/../../bad"), None);
        assert_eq!(codex_thread_url(""), None);
    }

    #[test]
    fn cursor_workspace_requires_an_existing_absolute_directory() {
        let temp = tempfile::tempdir().unwrap();

        assert!(valid_cursor_workspace(temp.path()));
        assert!(!valid_cursor_workspace(std::path::Path::new("relative/project")));
        assert!(!valid_cursor_workspace(&temp.path().join("missing")));
    }
}
