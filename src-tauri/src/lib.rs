mod agent_kernel;
mod anywhere_crypto;
mod claude_followup;
mod client_registry;
pub mod codex_bridge;
mod commands;
mod config;
mod cursor_focus_extension;
mod dws_hush_bridge;
mod event_bus;
mod git_changes;
mod hermes_plugin;
mod hexa_connector;
mod hexa_goal_store;
mod hexa_protocol;
mod hexa_watch_store;
mod hook_server;
#[allow(dead_code)]
mod hush_signal_store;
mod hush_store;
mod intervention_queue;
mod knowledge_store;
mod local_api_auth;
#[cfg(target_os = "macos")]
mod mac_notification_watcher;
mod mobile_bridge;
mod mobile_relay;
mod native_audio;
mod openclaw_hook;
mod openclaw_transcript;
mod opencode_followup;
mod pi_sidecar;
mod qoder_log_watcher;
mod remote_bridge;
mod session_store;
mod skill_index;
mod sound_pack;
mod stats_store;
mod system_tts;
mod tailnet;
mod transcript_reader;
mod user_safe_text;
mod wake_crypto;
mod wake_guard;
mod window_focus;
mod wukong_watcher;

use std::sync::Arc;
use tauri::{Emitter, Manager};

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .on_window_event(|window, event| {
            #[cfg(target_os = "windows")]
            {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // HumHum is a tray companion. Alt+F4 should hide a window
                    // so it can be reopened from the tray; the explicit tray
                    // Quit action still terminates the application cleanly.
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = (window, event);
            }
        })
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Set up the main pet window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_skip_taskbar(true);
                let _ = window.set_shadow(false);
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));

                #[cfg(target_os = "windows")]
                apply_windows_window_behavior(&window);

                #[cfg(target_os = "macos")]
                apply_macos_transparency(&window);

                // Periodically re-assert window level to prevent Tauri/macOS from overriding
                #[cfg(target_os = "macos")]
                {
                    let win_clone = window.clone();
                    std::thread::spawn(move || loop {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        reassert_window_level(&win_clone);
                    });
                }
            }

            // Load configuration
            let config = config::AppConfig::load(&app_handle);
            #[cfg(not(target_os = "macos"))]
            let config = {
                let mut config = config;
                if config.ui.awake_mode {
                    config.ui.awake_mode = false;
                    if let Err(error) = config.save() {
                        log::warn!("Could not clear unsupported Awake Mode setting: {error}");
                    }
                }
                config
            };
            #[cfg(target_os = "macos")]
            let restore_awake_mode = config.ui.awake_mode;
            let analytics_enabled = config.ui.analytics_enabled;
            app.manage(Arc::new(std::sync::Mutex::new(config)));

            if let Some(home) = dirs::home_dir() {
                if let Err(error) = commands::ensure_hook_script_installed(&home) {
                    log::warn!("Could not refresh HUMHUM hook script: {error}");
                }
                match hexa_connector::ensure_installed(&home) {
                    Ok(report) => {
                        log::info!(
                            "Hexa global connector ready for {} detected Agent(s)",
                            report.installed_skills.len()
                        );
                        for warning in report.warnings {
                            log::warn!("Hexa connector capability warning: {warning}");
                        }
                    }
                    Err(error) => log::warn!("Could not install Hexa global connector: {error}"),
                }
                if let Err(error) = cursor_focus_extension::ensure_for_managed_hook(&home) {
                    log::warn!("Could not refresh HUMHUM Cursor focus extension: {error}");
                }
                let auth = local_api_auth::LocalApiAuth::load_or_create(&home.join(".humhum"))
                    .map_err(std::io::Error::other)?;
                app.manage(Arc::new(auth));
                let intervention_queue =
                    intervention_queue::InterventionQueue::load_or_create(&home.join(".humhum"))
                        .map_err(std::io::Error::other)?;
                app.manage(Arc::new(std::sync::Mutex::new(intervention_queue)));
                let hush_signal_store = hush_signal_store::HushSignalStore::load_or_create(
                    &home.join(".humhum"),
                )
                .map_err(std::io::Error::other)?;
                app.manage(Arc::new(std::sync::Mutex::new(hush_signal_store)));
                let mobile_bridge =
                    mobile_bridge::MobileBridgeState::load_or_create(&home.join(".humhum"))
                        .map_err(std::io::Error::other)?;
                app.manage(Arc::new(mobile_bridge));
                app.manage(Arc::new(remote_bridge::RemoteBridgeState::default()));

                // Hexa watched sessions are agent-declared high-confidence supervision targets.
                let hexa_watch_dir = home.join(".humhum");
                let hexa_watch_store = match hexa_watch_store::HexaWatchStore::load_or_create(
                    &hexa_watch_dir,
                ) {
                    Ok(store) => store,
                    Err(error) => {
                        log::warn!(
                            "Could not load Hexa watch store; reads and mutations remain unavailable until retry succeeds: {error}"
                        );
                        hexa_watch_store::HexaWatchStore::unavailable_at(&hexa_watch_dir)
                    }
                };
                app.manage(Arc::new(std::sync::Mutex::new(hexa_watch_store)));

                // Development goals are persisted independently so a goal-store
                // failure never prevents the existing watched-session monitor.
                let hexa_goal_store = match hexa_goal_store::HexaGoalStore::load_or_create(
                    &hexa_watch_dir,
                ) {
                    Ok(store) => store,
                    Err(error) => {
                        log::warn!(
                            "Could not load Hexa goal store; goal reads and mutations remain unavailable until retry succeeds: {error}"
                        );
                        hexa_goal_store::HexaGoalStore::unavailable_at(&hexa_watch_dir)
                    }
                };
                app.manage(Arc::new(std::sync::Mutex::new(hexa_goal_store)));
            } else {
                return Err(std::io::Error::other("Could not determine home directory").into());
            }

            let wake_guard = Arc::new(wake_guard::WakeGuardState::default());
            app.manage(wake_guard.clone());
            #[cfg(target_os = "macos")]
            {
                let wake_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if restore_awake_mode {
                        if let Err(error) = wake_guard.set_enabled(true).await {
                            log::warn!("Could not restore Awake Mode: {error}");
                        }
                    }
                    let mut pulse = tokio::time::interval(std::time::Duration::from_secs(120));
                    loop {
                        pulse.tick().await;
                        let desired_enabled = wake_handle
                            .state::<Arc<std::sync::Mutex<config::AppConfig>>>()
                            .lock()
                            .map(|config| config.ui.awake_mode)
                            .unwrap_or(false);
                        if let Err(error) =
                            wake_guard.reconcile_desired_state(desired_enabled).await
                        {
                            log::warn!("Could not reconcile Awake Mode: {error}");
                            continue;
                        }
                        match wake_guard.pulse_user_activity().await {
                            Ok(true) => {
                                let _ = wake_handle.emit("humhum://awake-mode-pulse", ());
                            }
                            Ok(false) => {}
                            Err(error) => log::warn!("Awake Mode activity pulse failed: {error}"),
                        }
                    }
                });
            }

            // Session store
            let session_store = session_store::SessionStore::new();
            app.manage(Arc::new(std::sync::Mutex::new(session_store)));

            // Stats store (persistent)
            let stats_path = dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join(".humhum")
                .join("stats.json");
            let stats_store =
                stats_store::StatsStore::new_with_backfill(stats_path, analytics_enabled);
            app.manage(Arc::new(std::sync::Mutex::new(stats_store)));

            // Knowledge store (persistent)
            let knowledge_store = knowledge_store::KnowledgeStore::new();
            app.manage(Arc::new(std::sync::Mutex::new(knowledge_store)));

            // Hush inbox store (persistent)
            let hush_store = Arc::new(std::sync::Mutex::new(hush_store::HushStore::new()));
            app.manage(hush_store.clone());

            // DingTalk DWS is a read-only, local-first Hush source.
            let dws_home = dirs::home_dir()
                .ok_or_else(|| std::io::Error::other("Could not determine home directory"))?;
            let dws_bridge = Arc::new(
                dws_hush_bridge::DwsHushBridge::load_or_create(&dws_home)
                    .map_err(std::io::Error::other)?,
            );
            app.manage(dws_bridge.clone());
            let dws_app = app_handle.clone();
            let dws_hush_store = hush_store.clone();
            tauri::async_runtime::spawn(async move {
                dws_hush_bridge::run_immediately_then_interval(
                    std::time::Duration::from_secs(5 * 60),
                    move || {
                        let dws_bridge = dws_bridge.clone();
                        let dws_hush_store = dws_hush_store.clone();
                        let dws_app = dws_app.clone();
                        async move {
                            let config = dws_bridge.config_snapshot().await;
                            if !config.auto_sync_enabled || dws_bridge.is_syncing() {
                                return;
                            }
                            match dws_bridge.sync(dws_hush_store).await {
                                Ok(report) => {
                                    let _ = dws_app.emit("humhum://hush-message", &report);
                                }
                                Err(error) => {
                                    log::warn!("DingTalk DWS background sync failed: {error}")
                                }
                            }
                        }
                    },
                )
                .await;
            });

            #[cfg(target_os = "macos")]
            app.manage(Arc::new(std::sync::Mutex::new(
                mac_notification_watcher::MacNotificationBridgeStatus::default(),
            )));

            // Pi sidecar process registry. Sessions are started only by explicit command.
            app.manage(Arc::new(pi_sidecar::PiSidecarState::default()));

            // Hexa's local Codex app-server bridge. It degrades to health state on failure.
            let codex_bridge = Arc::new(codex_bridge::CodexBridgeState::default());
            app.manage(codex_bridge.clone());
            codex_bridge::CodexBridgeState::start(app_handle.clone(), codex_bridge);

            // Start the hook event server
            let server_handle = app_handle.clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(hook_server::start_server(server_handle));
            });

            // Start QoderWork session log watcher
            qoder_log_watcher::start_watcher(app_handle.clone());

            // Start Wukong r2c database watcher
            wukong_watcher::start_watcher(app_handle.clone());

            // Backfill local OpenClaw conversations without copying their message bodies.
            openclaw_transcript::start_watcher(app_handle.clone());

            // Start the read-only Hush bridge for new local macOS notifications.
            #[cfg(target_os = "macos")]
            mac_notification_watcher::start_watcher(app_handle.clone());

            // Build system tray menu
            setup_tray(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::get_auto_confirm_sessions,
            commands::set_session_auto_confirm,
            commands::get_wake_guard_status,
            commands::get_launch_at_login,
            commands::set_launch_at_login,
            commands::get_mobile_bridge_status,
            commands::enable_mobile_bridge,
            commands::disable_mobile_bridge,
            commands::start_mobile_pairing,
            commands::revoke_mobile_devices,
            commands::revoke_mobile_device,
            commands::get_remote_bridge_status,
            commands::connect_remote_bridge,
            commands::disconnect_remote_bridge,
            commands::set_wake_guard_enabled,
            commands::get_hook_port,
            commands::get_codex_bridge_health,
            commands::get_codex_remote_control,
            commands::get_hexa_bridge_sessions,
            commands::get_hexa_watched_agents,
            commands::refresh_hexa_watched_agents,
            commands::get_hexa_watched_sessions,
            commands::get_hexa_development_goals,
            commands::link_hexa_goal_attempt,
            commands::update_hexa_attempt_result,
            commands::accept_hexa_goal_attempt,
            commands::delete_hexa_development_goal,
            commands::mutate_hexa_session_audit,
            commands::sync_hexa_session_plan,
            commands::delete_hexa_watched_session,
            commands::get_session_change_summary,
            commands::hexa_enable_codex_remote_control,
            commands::hexa_disable_codex_remote_control,
            commands::hexa_start_codex_remote_pairing,
            commands::hexa_start_codex_thread,
            commands::hexa_resume_codex_thread,
            commands::hexa_send_codex_message,
            commands::hexa_send_claude_message,
            commands::hexa_send_opencode_message,
            commands::get_intervention_queue,
            commands::hexa_retry_codex_message,
            commands::hexa_retry_claude_message,
            commands::hexa_retry_opencode_message,
            commands::discard_queued_intervention,
            commands::hexa_interrupt_codex_turn,
            commands::hexa_resolve_codex_approval,
            commands::hexa_answer_codex_question,
            commands::check_pi_installed,
            commands::start_pi_session,
            commands::send_pi_prompt,
            commands::get_pi_session_status,
            commands::abort_pi_session,
            commands::stop_pi_session,
            commands::check_qoder_acp_support,
            commands::get_agent_kernel_status,
            commands::run_local_agent_kernel,
            commands::get_hush_connectors,
            commands::open_hush_connector,
            commands::get_hush_inbox,
            commands::clear_hush_inbox,
            commands::get_hush_health_signals,
            commands::clear_hush_health_signals,
            commands::get_hush_dws_status,
            commands::sync_hush_dws,
            commands::set_hush_dws_auto_sync,
            commands::open_hush_dws_login,
            commands::get_hush_notification_bridge_status,
            commands::open_full_disk_access_settings,
            commands::diagnose_dingtalk_local_sources,
            commands::import_dingtalk_local_source,
            commands::install_hooks,
            commands::uninstall_hooks,
            commands::get_events,
            commands::get_active_sessions,
            commands::get_all_sessions_history,
            commands::get_session,
            commands::respond_to_permission,
            commands::get_supported_clients,
            commands::install_hooks_for_client,
            commands::uninstall_hooks_for_client,
            commands::focus_terminal,
            commands::focus_agent_session,
            commands::toggle_settings,
            commands::send_notification,
            commands::check_hooks_status,
            commands::get_hermes_observer_status,
            commands::webview_log,
            commands::proxy_post,
            commands::proxy_post_binary,
            commands::transcribe_audio,
            commands::play_audio,
            commands::stop_audio,
            commands::synthesize_system_speech,
            commands::get_sound_packs,
            commands::select_sound_pack,
            commands::clear_sound_pack,
            commands::get_sound_clip,
            commands::get_stats,
            commands::clear_stats,
            commands::get_agent_stats,
            commands::get_hexa_readouts,
            commands::type_in_terminal,
            commands::toggle_hub,
            commands::get_knowledge,
            commands::get_humi_context_tool,
            commands::save_humi_memory,
            commands::save_preference,
            commands::delete_preference,
            commands::scan_agent_rules,
            commands::scan_agent_assets,
            commands::diagnose_agent_asset_roots,
            commands::set_obsidian_vault_path,
            commands::scan_obsidian_vault,
            commands::query_knowledge,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HumHum");
}

#[cfg(target_os = "windows")]
fn apply_windows_window_behavior(window: &tauri::WebviewWindow) {
    if let Err(error) = window.set_always_on_top(true) {
        log::warn!("[Window] Failed to keep the pet above Windows apps: {error}");
    }

    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => monitor,
        Ok(None) => {
            log::warn!("[Window] No Windows monitor found for pet positioning");
            return;
        }
        Err(error) => {
            log::warn!("[Window] Failed to query the Windows monitor: {error}");
            return;
        }
    };
    let window_size = match window.outer_size() {
        Ok(size) => size,
        Err(error) => {
            log::warn!("[Window] Failed to query pet window size: {error}");
            return;
        }
    };

    // Use the work area rather than the full monitor so the pet stays clear of
    // taskbars on every edge and on secondary monitors with negative origins.
    let work_area = monitor.work_area();
    let left = i64::from(work_area.position.x);
    let top = i64::from(work_area.position.y);
    let x = (left + i64::from(work_area.size.width) - i64::from(window_size.width) - 20).max(left);
    let y = (top + i64::from(work_area.size.height) - i64::from(window_size.height) - 40).max(top);
    let position = tauri::PhysicalPosition::new(
        x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
    );
    if let Err(error) = window.set_position(position) {
        log::warn!("[Window] Failed to position the pet on Windows: {error}");
    }
}

#[cfg(target_os = "macos")]
#[allow(deprecated, unexpected_cfgs)]
pub(crate) fn reassert_window_level(window: &tauri::WebviewWindow) {
    use cocoa::base::id;
    use objc::{msg_send, sel, sel_impl};

    let ns_window = match window.ns_window() {
        Ok(w) => w as id,
        Err(_) => return,
    };

    let ns_win_ptr = ns_window as usize;
    dispatch::Queue::main().exec_async(move || unsafe {
        let ns_window = ns_win_ptr as id;
        // CGAssistiveTechHighWindowLevel — above fullscreen apps
        let _: () = msg_send![ns_window, setLevel: 1500_i64];
        // canJoinAllSpaces(1) | stationary(16) | ignoresCycle(64) | fullScreenAuxiliary(256) | fullScreenDisallowsTiling(4096)
        let _: () = msg_send![ns_window, setCollectionBehavior: 4433_u64];
        let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
        let _: () = msg_send![ns_window, setCanHide: false];
    });
}

#[cfg(target_os = "macos")]
#[allow(deprecated, unexpected_cfgs)]
fn apply_macos_transparency(window: &tauri::WebviewWindow) {
    use cocoa::appkit::{NSColor, NSWindow, NSWindowStyleMask};
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSAutoreleasePool;
    use objc::{msg_send, sel, sel_impl};

    let ns_window = match window.ns_window() {
        Ok(w) => w as id,
        Err(_) => return,
    };

    unsafe {
        let pool = NSAutoreleasePool::new(nil);

        let clear_color: id = NSColor::clearColor(nil);
        ns_window.setBackgroundColor_(clear_color);
        ns_window.setOpaque_(false);
        ns_window.setHasShadow_(false);
        ns_window.setStyleMask_(NSWindowStyleMask::NSBorderlessWindowMask);

        // canJoinAllSpaces(1) | stationary(16) | ignoresCycle(64) | fullScreenAuxiliary(256) | fullScreenDisallowsTiling(4096)
        let _: () = msg_send![ns_window, setCollectionBehavior: 4433_u64];
        // CGAssistiveTechHighWindowLevel — above fullscreen apps
        let _: () = msg_send![ns_window, setLevel: 1500_i64];
        let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
        let _: () = msg_send![ns_window, setCanHide: false];
        // No animations during Space transitions
        let _: () = msg_send![ns_window, setAnimationBehavior: 2_i64];

        // Position at bottom-right of the main screen
        let screen: id = msg_send![ns_window, screen];
        if screen != nil {
            let frame: cocoa::foundation::NSRect = msg_send![screen, visibleFrame];
            let win_frame: cocoa::foundation::NSRect = msg_send![ns_window, frame];
            let x = frame.origin.x + frame.size.width - win_frame.size.width - 20.0;
            let y = frame.origin.y + 40.0; // near bottom in macOS coords
            let origin = cocoa::foundation::NSPoint::new(x, y);
            let _: () = msg_send![ns_window, setFrameOrigin: origin];
        } else {
            let _: () = msg_send![ns_window, center];
        }

        let content_view: id = ns_window.contentView();
        let _: () = msg_send![content_view, setWantsLayer: true];

        fn make_webview_transparent(view: id) {
            unsafe {
                let class_name: id = msg_send![view, className];
                let bytes: *const std::os::raw::c_char = msg_send![class_name, UTF8String];
                let class_str = std::ffi::CStr::from_ptr(bytes).to_str().unwrap_or("");
                if class_str.contains("WKWebView") || class_str.contains("WebViewer") {
                    let _: () = msg_send![view, setValue: false forKey: "drawsBackground"];
                    let _: () = msg_send![view, setValue: false forKey: "opaque"];
                }
                let subviews: id = msg_send![view, subviews];
                let count: usize = msg_send![subviews, count];
                for i in 0..count {
                    let subview: id = msg_send![subviews, objectAtIndex: i];
                    make_webview_transparent(subview);
                }
            }
        }
        make_webview_transparent(content_view);

        // Move window to a SkyLight stationary space (floats above fullscreen apps)
        move_to_skylight_space(ns_window);

        let _: () = msg_send![pool, drain];
    }
}

#[cfg(target_os = "macos")]
#[allow(deprecated, unexpected_cfgs)]
pub(crate) fn move_to_skylight_space(ns_window: cocoa::base::id) {
    use cocoa::base::id;
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int, c_void};

    type SLSMainConnectionIDFn = unsafe extern "C" fn() -> c_int;
    type SLSSpaceCreateFn = unsafe extern "C" fn(c_int, c_int, c_int) -> c_int;
    type SLSSpaceSetAbsoluteLevelFn = unsafe extern "C" fn(c_int, c_int, c_int) -> c_int;
    type SLSShowSpacesFn = unsafe extern "C" fn(c_int, id) -> c_int;
    type SLSAddWindowsToSpacesFn = unsafe extern "C" fn(c_int, c_int, id, c_int) -> c_int;

    extern "C" {
        fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    unsafe {
        let path = CString::new(
            "/System/Library/PrivateFrameworks/SkyLight.framework/Versions/A/SkyLight",
        )
        .unwrap();
        let handle = dlopen(path.as_ptr(), 1); // RTLD_LAZY = 1
        if handle.is_null() {
            log::warn!("[SkyLight] Failed to load framework");
            return;
        }

        macro_rules! load_fn {
            ($name:expr, $ty:ty) => {{
                let sym = CString::new($name).unwrap();
                let ptr = dlsym(handle, sym.as_ptr());
                if ptr.is_null() {
                    log::warn!("[SkyLight] Missing symbol: {}", $name);
                    return;
                }
                std::mem::transmute::<*mut c_void, $ty>(ptr)
            }};
        }

        let sls_main_connection_id: SLSMainConnectionIDFn =
            load_fn!("SLSMainConnectionID", SLSMainConnectionIDFn);
        let sls_space_create: SLSSpaceCreateFn = load_fn!("SLSSpaceCreate", SLSSpaceCreateFn);
        let sls_space_set_absolute_level: SLSSpaceSetAbsoluteLevelFn =
            load_fn!("SLSSpaceSetAbsoluteLevel", SLSSpaceSetAbsoluteLevelFn);
        let sls_show_spaces: SLSShowSpacesFn = load_fn!("SLSShowSpaces", SLSShowSpacesFn);
        let sls_add_windows: SLSAddWindowsToSpacesFn = load_fn!(
            "SLSSpaceAddWindowsAndRemoveFromSpaces",
            SLSAddWindowsToSpacesFn
        );

        let conn = sls_main_connection_id();
        let space = sls_space_create(conn, 1, 0);
        if space == 0 {
            log::warn!("[SkyLight] Failed to create space");
            return;
        }

        sls_space_set_absolute_level(conn, space, 100);

        // Create NSArray with space ID for SLSShowSpaces
        let ns_number: id = msg_send![class!(NSNumber), numberWithInt: space];
        let space_array: id = msg_send![class!(NSArray), arrayWithObject: ns_number];
        sls_show_spaces(conn, space_array);

        // Get window number and move it to the stationary space
        let window_number: i64 = msg_send![ns_window, windowNumber];
        let win_number: id = msg_send![class!(NSNumber), numberWithInt: window_number as i32];
        let win_array: id = msg_send![class!(NSArray), arrayWithObject: win_number];
        sls_add_windows(conn, space, win_array, 7);

        log::info!(
            "[SkyLight] Window {} moved to stationary space {}",
            window_number,
            space
        );
    }
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };

    let show = MenuItem::with_id(app, "show", "Show HumHum", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let hub = MenuItem::with_id(app, "hub", "Hub", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit HumHum", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &settings, &hub, &separator, &quit])?;

    // Keep this as the single tray creation site. Adding app.trayIcon to
    // tauri.conf.json would create a second native icon before setup runs.
    TrayIconBuilder::with_id("humhum-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .icon_as_template(true)
        .menu(&menu)
        .tooltip("HumHum - AI Coding Companion")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "settings" => {
                let _ = tauri::async_runtime::block_on(commands::toggle_settings(app.clone()));
            }
            "hub" => {
                let _ = tauri::async_runtime::block_on(commands::toggle_hub(app.clone()));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
