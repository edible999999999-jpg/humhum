mod client_registry;
mod commands;
mod config;
mod event_bus;
mod hook_server;
mod qoder_log_watcher;
mod session_store;
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
                let _ = window.set_always_on_top(true);
                let _ = window.set_skip_taskbar(true);
                let _ = window.set_shadow(false);
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));

                #[cfg(target_os = "macos")]
                apply_macos_transparency(&window);
            }

            // Load configuration
            let config = config::AppConfig::load(&app_handle);
            app.manage(Arc::new(std::sync::Mutex::new(config)));

            // Session store
            let session_store = session_store::SessionStore::new();
            app.manage(Arc::new(std::sync::Mutex::new(session_store)));

            // Start the hook event server
            let server_handle = app_handle.clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(hook_server::start_server(server_handle));
            });

            // Start QoderWork session log watcher
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running DevPod");
}

#[cfg(target_os = "macos")]
fn apply_macos_transparency(window: &tauri::WebviewWindow) {
    use cocoa::appkit::{NSColor, NSWindow, NSWindowStyleMask};
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSAutoreleasePool;
    use objc::{msg_send, sel, sel_impl};

    let _ = window.set_visible_on_all_workspaces(true);

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

        let _: () = msg_send![pool, drain];
    }
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };

    let show = MenuItem::with_id(app, "show", "Show DevPod", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide DevPod", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &settings, &quit])?;

    TrayIconBuilder::with_id("devpod-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("DevPod - Developer Podcast Pet")
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
