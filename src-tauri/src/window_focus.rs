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
    TerminalTty(String),
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

fn normalize_tty(value: &str) -> Option<String> {
    let value = value.trim();
    let suffix = value.strip_prefix("/dev/").unwrap_or(value);
    let digits = suffix.strip_prefix("ttys")?;
    (!digits.is_empty() && digits.chars().all(|character| character.is_ascii_digit()))
        .then(|| format!("/dev/{suffix}"))
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
    if route
        .term_program
        .as_deref()
        .and_then(normalize_terminal_application)
        == Some("Terminal")
    {
        if let Some(tty) = route.tty.as_deref().and_then(normalize_tty) {
            return FocusStrategy::TerminalTty(tty);
        }
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
        FocusStrategy::TerminalTty(tty) => {
            focus_terminal_tty(&tty)?;
            Ok(FocusResult {
                strategy: "terminal_tty".into(),
                application: Some("Terminal".into()),
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

fn ghostty_workspace_target(
    route: &SessionRoute,
    workspace: &str,
) -> Option<std::path::PathBuf> {
    let application = route
        .term_program
        .as_deref()
        .and_then(normalize_terminal_application)?;
    if application != "Ghostty" {
        return None;
    }
    let path = std::path::Path::new(workspace);
    (path.is_absolute() && path.is_dir())
        .then(|| path.canonicalize().ok())
        .flatten()
}

pub fn focus_ghostty_workspace(
    route: &SessionRoute,
    workspace: &str,
) -> Result<FocusResult, String> {
    let path = ghostty_workspace_target(route, workspace)
        .ok_or("Ghostty focus requires an existing absolute workspace")?;
    #[cfg(target_os = "macos")]
    {
        const SCRIPT: &str = r#"set targetPath to system attribute "HUMHUM_GHOSTTY_WORKSPACE"
tell application id "com.mitchellh.ghostty"
set matchingTerminalIDs to {}
repeat with aTerminal in terminals
try
set terminalPath to (working directory of aTerminal as text)
if terminalPath is targetPath or terminalPath starts with (targetPath & "/") then
copy (id of aTerminal as text) to end of matchingTerminalIDs
end if
end try
end repeat
if (count of matchingTerminalIDs) is not 1 then
error "Ghostty workspace is not unique"
end if
set targetTerminalID to item 1 of matchingTerminalIDs
set targetTerminal to first terminal whose id is targetTerminalID
focus targetTerminal
activate
return "ok"
end tell"#;
        let output = Command::new("osascript")
            .env("HUMHUM_GHOSTTY_WORKSPACE", &path)
            .args(["-e", SCRIPT])
            .output()
            .map_err(|error| format!("Could not focus Ghostty workspace: {error}"))?;
        if !output.status.success() || String::from_utf8_lossy(&output.stdout).trim() != "ok" {
            return Err(format!(
                "Could not uniquely focus Ghostty workspace: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(FocusResult {
            strategy: "ghostty_workspace".into(),
            application: Some("Ghostty".into()),
            exact: true,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Ghostty workspace focus only supported on macOS".into())
    }
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
            exact: false,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Cursor workspace focus only supported on macOS".into())
    }
}

pub fn focus_cursor_terminal(
    route: &SessionRoute,
    workspace: &str,
) -> Result<FocusResult, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    if !crate::cursor_focus_extension::is_installed_at(&home) {
        return Err("HUMHUM Cursor focus extension is not installed".into());
    }
    let path = std::path::Path::new(workspace);
    if !valid_cursor_workspace(path) {
        return Err("Cursor workspace must be an existing absolute directory".into());
    }
    #[cfg(target_os = "macos")]
    {
        let nonce = uuid::Uuid::new_v4().to_string();
        let receipt = crate::cursor_focus_extension::receipt_path(&home, &nonce)?;
        if let Some(parent) = receipt.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not prepare Cursor focus receipt: {error}"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                    .map_err(|error| format!("Could not protect Cursor focus receipts: {error}"))?;
            }
        }
        let url = crate::cursor_focus_extension::focus_request_url(path, route, &nonce)?;
        let activated = Command::new("open")
            .args(["-b", "com.todesktop.230313mzl4w4u92"])
            .arg(path)
            .output()
            .map_err(|error| format!("Could not open Cursor workspace: {error}"))?;
        if !activated.status.success() {
            return Err(format!(
                "Could not open Cursor workspace: {}",
                String::from_utf8_lossy(&activated.stderr).trim()
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
        let requested = Command::new("open")
            .args(["-b", "com.todesktop.230313mzl4w4u92", &url])
            .output()
            .map_err(|error| format!("Could not request Cursor terminal focus: {error}"))?;
        if !requested.status.success() {
            return Err(format!(
                "Could not request Cursor terminal focus: {}",
                String::from_utf8_lossy(&requested.stderr).trim()
            ));
        }
        for _ in 0..40 {
            if receipt.is_file() {
                let acknowledged = std::fs::read_to_string(&receipt)
                    .is_ok_and(|value| value.trim() == "focused");
                let _ = std::fs::remove_file(&receipt);
                if acknowledged {
                    return Ok(FocusResult {
                        strategy: "cursor_terminal".into(),
                        application: Some("Cursor".into()),
                        exact: true,
                    });
                }
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let _ = std::fs::remove_file(receipt);
        Err("Cursor did not confirm an exact terminal match".into())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = route;
        Err("Cursor terminal focus only supported on macOS".into())
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

fn focus_terminal_tty(tty: &str) -> Result<(), String> {
    let tty = normalize_tty(tty).ok_or("Invalid Terminal TTY identifier")?;
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            r#"tell application "Terminal"
repeat with aWindow in windows
repeat with aTab in tabs of aWindow
if (tty of aTab as text) is "{tty}" then
set selected tab of aWindow to aTab
set index of aWindow to 1
activate
return
end if
end repeat
end repeat
error "Terminal TTY not found"
end tell"#
        );
        let output = Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|error| format!("Could not focus Terminal TTY: {error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = tty;
        Err("Terminal TTY focus only supported on macOS".into())
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
    fn terminal_tty_is_exact_and_rejects_script_input() {
        let route = SessionRoute {
            term_program: Some("Terminal.app".into()),
            tty: Some("ttys007".into()),
            ..SessionRoute::default()
        };
        assert_eq!(
            choose_focus_strategy(&route),
            FocusStrategy::TerminalTty("/dev/ttys007".into())
        );
        assert_eq!(normalize_tty("/dev/ttys12"), Some("/dev/ttys12".into()));
        assert_eq!(normalize_tty("ttys12\"; do shell script \"bad"), None);
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
        assert!(!valid_cursor_workspace(std::path::Path::new(
            "relative/project"
        )));
        assert!(!valid_cursor_workspace(&temp.path().join("missing")));
    }

    #[test]
    fn ghostty_workspace_target_requires_a_real_directory_and_ghostty_route() {
        let temp = tempfile::tempdir().unwrap();
        let route = SessionRoute {
            term_program: Some("Ghostty".into()),
            ..SessionRoute::default()
        };

        assert_eq!(
            ghostty_workspace_target(&route, temp.path().to_str().unwrap()),
            Some(temp.path().canonicalize().unwrap())
        );
        assert_eq!(ghostty_workspace_target(&route, "relative/project"), None);
        assert_eq!(
            ghostty_workspace_target(
                &SessionRoute {
                    term_program: Some("Terminal".into()),
                    ..SessionRoute::default()
                },
                temp.path().to_str().unwrap()
            ),
            None
        );
    }
}
