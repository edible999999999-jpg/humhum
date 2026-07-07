mod client_registry;
mod commands;
mod config;
mod event_bus;
mod hook_server;
mod qoder_auto_allow;
mod qoder_log_watcher;
mod session_store;
mod stats_store;
mod window_focus;

use std::sync::Arc;
use tauri::{Emitter, Manager};

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Set up the main pet window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_skip_taskbar(true);
                let _ = window.set_shadow(false);
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));

                #[cfg(target_os = "macos")]
                apply_macos_transparency(&window);

                // Periodically re-assert window level to prevent Tauri/macOS from overriding
                #[cfg(target_os = "macos")]
                {
                    let win_clone = window.clone();
                    std::thread::spawn(move || {
                        loop {
                            std::thread::sleep(std::time::Duration::from_secs(3));
                            reassert_window_level(&win_clone);
                        }
                    });
                }
            }

            // Load configuration
            let config = config::AppConfig::load(&app_handle);
            let qoderwork_auto_allow_enabled = config.ui.qoderwork_auto_allow;
            app.manage(Arc::new(std::sync::Mutex::new(config)));

            // QoderWork auto-allow sidecar
            let auto_allow = qoder_auto_allow::QoderAutoAllow::new();
            if qoderwork_auto_allow_enabled {
                if let Err(e) = auto_allow.start() {
                    log::warn!("Failed to start QoderWork auto-allow: {}", e);
                }
            }
            app.manage(Arc::new(std::sync::Mutex::new(auto_allow)));

            // Session store
            let session_store = session_store::SessionStore::new();
            app.manage(Arc::new(std::sync::Mutex::new(session_store)));

            // Stats store (persistent)
            let stats_path = dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join(".humhum")
                .join("stats.json");
            let stats_store = stats_store::StatsStore::new(stats_path);
            app.manage(Arc::new(std::sync::Mutex::new(stats_store)));

            // Start the hook event server
            let server_handle = app_handle.clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(hook_server::start_server(server_handle));
            });

            // Start QoderWork session log watcher
            // Emits informational log events only — no confirmation dialogs.
            // QoderWork handles its own permission UI; humhum auto-allow sidecar clicks via CDP.
            qoder_log_watcher::start_watcher(app_handle.clone());

            // Build system tray menu
            setup_tray(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::get_hook_port,
            commands::install_hooks,
            commands::uninstall_hooks,
            commands::get_events,
            commands::get_active_sessions,
            commands::get_session,
            commands::respond_to_permission,
            commands::get_supported_clients,
            commands::install_hooks_for_client,
            commands::uninstall_hooks_for_client,
            commands::focus_terminal,
            commands::toggle_settings,
            commands::send_notification,
            commands::check_hooks_status,
            commands::webview_log,
            commands::proxy_post,
            commands::proxy_post_binary,
            commands::play_audio,
            commands::stop_audio,
            commands::get_stats,
            commands::type_in_terminal,
            commands::toggle_qoderwork_auto_allow,
            commands::get_qoderwork_auto_allow_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HumHum");
}

#[cfg(target_os = "macos")]
fn reassert_window_level(window: &tauri::WebviewWindow) {
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
fn move_to_skylight_space(ns_window: cocoa::base::id) {
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
        let sls_space_create: SLSSpaceCreateFn =
            load_fn!("SLSSpaceCreate", SLSSpaceCreateFn);
        let sls_space_set_absolute_level: SLSSpaceSetAbsoluteLevelFn =
            load_fn!("SLSSpaceSetAbsoluteLevel", SLSSpaceSetAbsoluteLevelFn);
        let sls_show_spaces: SLSShowSpacesFn =
            load_fn!("SLSShowSpaces", SLSShowSpacesFn);
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
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };

    let show = MenuItem::with_id(app, "show", "Show HumHum", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide HumHum", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &settings, &quit])?;

    TrayIconBuilder::with_id("humhum-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("HumHum - AI Coding Companion")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => {
                app.exit(0);
            }
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "hide" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            "settings" => {
                if let Some(win) = app.get_webview_window("settings") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
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
