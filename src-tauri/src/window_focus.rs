use crate::session_store::SessionRoute;
use serde::Serialize;
use std::process::Command;

#[cfg(target_os = "macos")]
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

#[cfg(any(not(target_os = "windows"), test))]
#[derive(Debug, Clone, PartialEq, Eq)]
enum FocusStrategy {
    TmuxPane(String),
    ITermSession(String),
    GhosttyTerminal(String),
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

#[cfg(any(not(target_os = "windows"), test))]
fn is_valid_tmux_pane(value: &str) -> bool {
    value
        .strip_prefix('%')
        .is_some_and(|digits| !digits.is_empty() && digits.chars().all(|ch| ch.is_ascii_digit()))
}

#[cfg(any(not(target_os = "windows"), test))]
fn normalize_tty(value: &str) -> Option<String> {
    let value = value.trim();
    let suffix = value.strip_prefix("/dev/").unwrap_or(value);
    let digits = suffix.strip_prefix("ttys")?;
    (!digits.is_empty() && digits.chars().all(|character| character.is_ascii_digit()))
        .then(|| format!("/dev/{suffix}"))
}

#[cfg(any(not(target_os = "windows"), test))]
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
        == Some("Ghostty")
    {
        if let Some(terminal_id) = route
            .ghostty_terminal_id
            .as_deref()
            .filter(|value| !value.is_empty() && value.len() <= 256)
        {
            return FocusStrategy::GhosttyTerminal(terminal_id.to_string());
        }
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

#[cfg(target_os = "windows")]
pub fn focus_agent_route(route: Option<&SessionRoute>) -> Result<FocusResult, String> {
    let application = route
        .and_then(|item| item.term_program.as_deref())
        .and_then(normalize_terminal_application)
        .map(str::to_string);
    windows::focus_terminal_window()?;
    Ok(FocusResult {
        strategy: "windows_terminal".into(),
        application,
        exact: false,
    })
}

#[cfg(not(target_os = "windows"))]
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
        FocusStrategy::GhosttyTerminal(terminal_id) => focus_ghostty_terminal(&terminal_id),
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

pub fn capture_ghostty_terminal_id(workspace: &str) -> Option<String> {
    let path = std::path::Path::new(workspace);
    let path = (path.is_absolute() && path.is_dir())
        .then(|| path.canonicalize().ok())
        .flatten()?;
    #[cfg(target_os = "macos")]
    {
        const SCRIPT: &str = r#"set targetPath to system attribute "HUMHUM_GHOSTTY_WORKSPACE"
tell application id "com.mitchellh.ghostty"
set matchingTerminalIDs to {}
repeat with aTerminal in terminals
try
if (working directory of aTerminal as text) is targetPath then
copy (id of aTerminal as text) to end of matchingTerminalIDs
end if
end try
end repeat
if (count of matchingTerminalIDs) is not 1 then return ""
return item 1 of matchingTerminalIDs
end tell"#;
        let output = Command::new("osascript")
            .env("HUMHUM_GHOSTTY_WORKSPACE", &path)
            .args(["-e", SCRIPT])
            .output()
            .ok()?;
        let terminal_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
        (output.status.success() && !terminal_id.is_empty() && terminal_id.len() <= 256)
            .then_some(terminal_id)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn focus_ghostty_terminal(terminal_id: &str) -> Result<FocusResult, String> {
    if terminal_id.is_empty() || terminal_id.len() > 256 {
        return Err("Invalid Ghostty terminal identifier".into());
    }
    #[cfg(target_os = "macos")]
    {
        const SCRIPT: &str = r#"set targetID to system attribute "HUMHUM_GHOSTTY_TERMINAL_ID"
tell application id "com.mitchellh.ghostty"
set matches to every terminal whose id is targetID
if (count of matches) is not 1 then error "Ghostty terminal not found"
focus item 1 of matches
activate
return "ok"
end tell"#;
        let output = Command::new("osascript")
            .env("HUMHUM_GHOSTTY_TERMINAL_ID", terminal_id)
            .args(["-e", SCRIPT])
            .output()
            .map_err(|error| format!("Could not focus Ghostty terminal: {error}"))?;
        if !output.status.success() || String::from_utf8_lossy(&output.stdout).trim() != "ok" {
            return Err(format!(
                "Could not focus Ghostty terminal: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(FocusResult {
            strategy: "ghostty_terminal".into(),
            application: Some("Ghostty".into()),
            exact: true,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = terminal_id;
        Err("Ghostty terminal focus only supported on macOS".into())
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
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(&url)
            .spawn()
            .map_err(|error| format!("Could not open Codex thread: {error}"))?;
        Ok(FocusResult {
            strategy: "codex_thread".into(),
            application: Some("Codex".into()),
            exact: true,
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = url;
        Err("Codex thread focus is only supported on macOS and Windows".into())
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

fn ghostty_workspace_target(route: &SessionRoute, workspace: &str) -> Option<std::path::PathBuf> {
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
    #[cfg(target_os = "windows")]
    {
        let _ = path;
        windows::focus_terminal_window()?;
        Ok(FocusResult {
            strategy: "windows_terminal".into(),
            application: Some("Ghostty".into()),
            exact: false,
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = path;
        Err("Ghostty workspace focus is only supported on macOS and Windows".into())
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
    #[cfg(target_os = "windows")]
    {
        windows::open_cursor_workspace(path)?;
        Ok(FocusResult {
            strategy: "cursor_workspace".into(),
            application: Some("Cursor".into()),
            exact: false,
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = path;
        Err("Cursor workspace focus is only supported on macOS and Windows".into())
    }
}

pub fn focus_cursor_terminal(route: &SessionRoute, workspace: &str) -> Result<FocusResult, String> {
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
                let acknowledged =
                    std::fs::read_to_string(&receipt).is_ok_and(|value| value.trim() == "focused");
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
    #[cfg(target_os = "windows")]
    {
        let nonce = uuid::Uuid::new_v4().to_string();
        let receipt = crate::cursor_focus_extension::receipt_path(&home, &nonce)?;
        if let Some(parent) = receipt.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not prepare Cursor focus receipt: {error}"))?;
        }
        let url = crate::cursor_focus_extension::focus_request_url(path, route, &nonce)?;
        windows::open_cursor_workspace(path)?;
        std::thread::sleep(std::time::Duration::from_millis(250));
        windows::open_cursor_uri(&url)?;
        for _ in 0..40 {
            if receipt.is_file() {
                let acknowledged =
                    std::fs::read_to_string(&receipt).is_ok_and(|value| value.trim() == "focused");
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
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = route;
        Err("Cursor terminal focus is only supported on macOS and Windows".into())
    }
}

#[cfg(not(target_os = "windows"))]
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

#[cfg(not(target_os = "windows"))]
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

#[cfg(not(target_os = "windows"))]
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

#[cfg(not(target_os = "windows"))]
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
#[cfg(target_os = "macos")]
pub fn focus_terminal_app() -> Result<(), String> {
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

#[cfg(target_os = "windows")]
pub fn focus_terminal_app() -> Result<(), String> {
    windows::focus_terminal_window()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn focus_terminal_app() -> Result<(), String> {
    Err("Window focus is only supported on macOS and Windows".to_string())
}

#[cfg(target_os = "macos")]
pub async fn type_in_terminal_async(text: &str) -> Result<(), String> {
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

#[cfg(target_os = "windows")]
pub async fn type_in_terminal_async(text: &str) -> Result<(), String> {
    windows::focus_terminal_window()?;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    // Resolve and focus the terminal once more after the delay. This avoids
    // sending an answer if another application took focus in the meantime.
    windows::type_text_and_enter(text)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub async fn type_in_terminal_async(_text: &str) -> Result<(), String> {
    Err("Terminal input is only supported on macOS and Windows".to_string())
}

#[cfg(target_os = "windows")]
mod windows {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::os::windows::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::ptr::null_mut;

    type Bool = i32;
    type Dword = u32;
    type Handle = *mut c_void;
    type Hwnd = *mut c_void;
    type Lparam = isize;
    type Uint = u32;
    type Word = u16;

    const PROCESS_QUERY_LIMITED_INFORMATION: Dword = 0x1000;
    const SW_RESTORE: i32 = 9;
    const INPUT_KEYBOARD: Dword = 1;
    const KEYEVENTF_KEYUP: Dword = 0x0002;
    const KEYEVENTF_UNICODE: Dword = 0x0004;
    const VK_RETURN: Word = 0x0d;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    #[derive(Clone, Copy)]
    struct TerminalWindow {
        hwnd: Hwnd,
        priority: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MouseInput {
        dx: i32,
        dy: i32,
        mouse_data: Dword,
        flags: Dword,
        time: Dword,
        extra_info: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct KeyboardInput {
        virtual_key: Word,
        scan_code: Word,
        flags: Dword,
        time: Dword,
        extra_info: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct HardwareInput {
        message: Dword,
        parameter_low: Word,
        parameter_high: Word,
    }

    #[repr(C)]
    union InputData {
        mouse: MouseInput,
        keyboard: KeyboardInput,
        hardware: HardwareInput,
    }

    #[repr(C)]
    struct Input {
        input_type: Dword,
        data: InputData,
    }

    #[link(name = "user32")]
    extern "system" {
        fn AttachThreadInput(attach: Dword, attach_to: Dword, should_attach: Bool) -> Bool;
        fn BringWindowToTop(hwnd: Hwnd) -> Bool;
        fn EnumWindows(
            callback: Option<unsafe extern "system" fn(Hwnd, Lparam) -> Bool>,
            data: Lparam,
        ) -> Bool;
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowTextLengthW(hwnd: Hwnd) -> i32;
        fn GetWindowThreadProcessId(hwnd: Hwnd, process_id: *mut Dword) -> Dword;
        fn IsWindowVisible(hwnd: Hwnd) -> Bool;
        fn SendInput(count: Uint, inputs: *const Input, input_size: i32) -> Uint;
        fn SetFocus(hwnd: Hwnd) -> Hwnd;
        fn SetForegroundWindow(hwnd: Hwnd) -> Bool;
        fn ShowWindow(hwnd: Hwnd, command: i32) -> Bool;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CloseHandle(handle: Handle) -> Bool;
        fn GetCurrentThreadId() -> Dword;
        fn OpenProcess(access: Dword, inherit_handle: Bool, process_id: Dword) -> Handle;
        fn QueryFullProcessImageNameW(
            process: Handle,
            flags: Dword,
            executable_name: *mut u16,
            size: *mut Dword,
        ) -> Bool;
    }

    pub(super) fn focus_terminal_window() -> Result<(), String> {
        let window = find_terminal_window()?;
        focus_window(window.hwnd)
    }

    pub(super) fn open_cursor_workspace(path: &Path) -> Result<(), String> {
        let mut last_error = None;
        for executable in cursor_executable_candidates() {
            if executable.components().count() > 1 && !executable.is_file() {
                continue;
            }
            let mut command = Command::new(&executable);
            command.arg(path).creation_flags(CREATE_NO_WINDOW);
            match command.spawn() {
                Ok(_) => return Ok(()),
                Err(error) => last_error = Some(error),
            }
        }
        Err(format!(
            "Could not open Cursor workspace: {}",
            last_error
                .map(|error| error.to_string())
                .unwrap_or_else(|| "Cursor.exe was not found".to_string())
        ))
    }

    pub(super) fn open_cursor_uri(url: &str) -> Result<(), String> {
        Command::new("explorer.exe")
            .arg(url)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| format!("Could not request Cursor terminal focus: {error}"))?;
        Ok(())
    }

    fn cursor_executable_candidates() -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let programs = PathBuf::from(local_app_data).join("Programs");
            candidates.push(programs.join("cursor").join("Cursor.exe"));
            candidates.push(programs.join("Cursor").join("Cursor.exe"));
        }
        for variable in ["ProgramFiles", "ProgramW6432"] {
            if let Some(program_files) = std::env::var_os(variable) {
                candidates.push(
                    PathBuf::from(program_files)
                        .join("Cursor")
                        .join("Cursor.exe"),
                );
            }
        }
        candidates.push(PathBuf::from("cursor.exe"));
        candidates
    }

    pub(super) fn type_text_and_enter(text: &str) -> Result<(), String> {
        let window = find_terminal_window()?;
        focus_window(window.hwnd)?;

        let mut inputs = Vec::with_capacity(text.encode_utf16().count() * 2 + 2);
        for code_unit in text.encode_utf16() {
            inputs.push(keyboard_input(0, code_unit, KEYEVENTF_UNICODE));
            inputs.push(keyboard_input(
                0,
                code_unit,
                KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
            ));
        }
        inputs.push(keyboard_input(VK_RETURN, 0, 0));
        inputs.push(keyboard_input(VK_RETURN, 0, KEYEVENTF_KEYUP));

        let sent = unsafe {
            SendInput(
                inputs.len() as Uint,
                inputs.as_ptr(),
                size_of::<Input>() as i32,
            )
        };
        if sent != inputs.len() as Uint {
            return Err(format!(
                "Windows sent only {sent} of {} terminal keystrokes: {}",
                inputs.len(),
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }

    fn keyboard_input(virtual_key: Word, scan_code: Word, flags: Dword) -> Input {
        Input {
            input_type: INPUT_KEYBOARD,
            data: InputData {
                keyboard: KeyboardInput {
                    virtual_key,
                    scan_code,
                    flags,
                    time: 0,
                    extra_info: 0,
                },
            },
        }
    }

    fn find_terminal_window() -> Result<TerminalWindow, String> {
        let mut candidates = Vec::<TerminalWindow>::new();
        let enumerated = unsafe {
            EnumWindows(
                Some(collect_terminal_windows),
                (&mut candidates as *mut Vec<TerminalWindow>) as Lparam,
            )
        };
        if enumerated == 0 {
            return Err(format!(
                "Failed to enumerate Windows terminals: {}",
                std::io::Error::last_os_error()
            ));
        }

        // EnumWindows yields top-level windows in Z order. Preserve that
        // recency signal so an answer goes to the terminal the user most
        // recently worked in instead of an arbitrary preferred brand. IDE
        // windows remain a last resort because Win32 cannot prove that their
        // integrated terminal pane currently owns keyboard focus.
        candidates.sort_by_key(|candidate| candidate.priority >= 20);
        candidates
            .into_iter()
            .next()
            .ok_or_else(|| "No known Windows terminal window found".to_string())
    }

    unsafe extern "system" fn collect_terminal_windows(hwnd: Hwnd, data: Lparam) -> Bool {
        if IsWindowVisible(hwnd) == 0 || GetWindowTextLengthW(hwnd) == 0 {
            return 1;
        }

        if let Some(process_name) = process_name_for_window(hwnd) {
            if let Some(priority) = terminal_priority(&process_name) {
                let candidates = &mut *(data as *mut Vec<TerminalWindow>);
                candidates.push(TerminalWindow { hwnd, priority });
            }
        }
        1
    }

    unsafe fn process_name_for_window(hwnd: Hwnd) -> Option<String> {
        let mut process_id = 0;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if process_id == 0 {
            return None;
        }

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if process.is_null() {
            return None;
        }

        let mut buffer = vec![0_u16; 32_768];
        let mut length = buffer.len() as Dword;
        let queried = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length);
        CloseHandle(process);
        if queried == 0 || length == 0 {
            return None;
        }

        let executable_path = String::from_utf16_lossy(&buffer[..length as usize]);
        executable_path
            .rsplit(['\\', '/'])
            .next()
            .map(|name| name.to_ascii_lowercase())
    }

    fn terminal_priority(process_name: &str) -> Option<usize> {
        match process_name {
            "windowsterminal.exe" | "wt.exe" => Some(0),
            "wezterm-gui.exe" => Some(1),
            "alacritty.exe" => Some(2),
            "kitty.exe" => Some(3),
            "ghostty.exe" | "warp.exe" | "warp-terminal.exe" => Some(4),
            "tabby.exe" | "conemu.exe" | "conemu64.exe" => Some(5),
            "pwsh.exe" | "powershell.exe" => Some(6),
            "cmd.exe" | "conhost.exe" => Some(7),
            // Integrated terminals are a last resort because Win32 cannot
            // tell whether the editor or terminal pane currently has focus.
            "cursor.exe" | "code.exe" => Some(20),
            _ => None,
        }
    }

    fn focus_window(hwnd: Hwnd) -> Result<(), String> {
        unsafe {
            ShowWindow(hwnd, SW_RESTORE);

            let current_thread = GetCurrentThreadId();
            let target_thread = GetWindowThreadProcessId(hwnd, null_mut());
            let foreground_window = GetForegroundWindow();
            let foreground_thread = if foreground_window.is_null() {
                0
            } else {
                GetWindowThreadProcessId(foreground_window, null_mut())
            };

            let attached_target = target_thread != 0 && target_thread != current_thread;
            let attached_foreground = foreground_thread != 0
                && foreground_thread != current_thread
                && foreground_thread != target_thread;
            if attached_foreground {
                AttachThreadInput(current_thread, foreground_thread, 1);
            }
            if attached_target {
                AttachThreadInput(current_thread, target_thread, 1);
            }

            BringWindowToTop(hwnd);
            let foreground_set = SetForegroundWindow(hwnd) != 0;
            SetFocus(hwnd);

            if attached_target {
                AttachThreadInput(current_thread, target_thread, 0);
            }
            if attached_foreground {
                AttachThreadInput(current_thread, foreground_thread, 0);
            }

            if foreground_set || GetForegroundWindow() == hwnd {
                Ok(())
            } else {
                Err("Windows prevented HumHum from focusing the terminal".to_string())
            }
        }
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
    fn exact_ghostty_terminal_has_priority_over_application_fallback() {
        let route = SessionRoute {
            term_program: Some("Ghostty".into()),
            ghostty_terminal_id: Some("terminal-ABC".into()),
            ..SessionRoute::default()
        };
        assert_eq!(
            choose_focus_strategy(&route),
            FocusStrategy::GhosttyTerminal("terminal-ABC".into())
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
