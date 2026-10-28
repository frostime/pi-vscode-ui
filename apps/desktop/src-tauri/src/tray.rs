use crate::{publish_window_state, Backend};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[derive(Default)]
struct TrayState {
    // Serialize the first-hide notice and Exit confirmation instead of opening overlapping dialogs.
    busy: AtomicBool,
    notice_shown: AtomicBool,
}

pub fn install(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "&Show FrostPi", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "&Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &exit])?;
    app.manage(Arc::new(TrayState::default()));
    TrayIconBuilder::with_id("frostpi")
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or("Desktop tray icon is missing")?,
        )
        .tooltip("FrostPi Desktop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                let _ = restore(app);
            }
            "exit" => request_exit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = restore(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn restore(app: &tauri::AppHandle) -> tauri::Result<()> {
    if app.state::<Backend>().0.closing.load(Ordering::Acquire) {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize()?;
        window.show()?;
        let focus = window.set_focus();
        publish_window_state(app);
        focus?;
    }
    Ok(())
}

pub fn hide(app: &tauri::AppHandle) {
    let state = app.state::<Arc<TrayState>>().inner().clone();
    if app.state::<Backend>().0.closing.load(Ordering::Acquire)
        || state.busy.swap(true, Ordering::AcqRel)
    {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if let Some(window) = app.get_webview_window("main") {
            // Once per launch: explain where the window went before removing it from the taskbar.
            if !state.notice_shown.swap(true, Ordering::AcqRel) {
                rfd::MessageDialog::new()
                    .set_parent(&window)
                    .set_title("FrostPi is still running")
                    .set_description("Closing this window keeps FrostPi and its tasks running in the system tray. Click the tray icon to restore the window, or choose Exit from its menu to quit.")
                    .show();
            }
            if window.hide().is_err() {
                rfd::MessageDialog::new()
                    .set_parent(&window)
                    .set_title("FrostPi Desktop")
                    .set_description("Could not hide the window. FrostPi is still running.")
                    .set_level(rfd::MessageLevel::Error)
                    .show();
            }
            publish_window_state(&app);
        }
        state.busy.store(false, Ordering::Release);
    });
}

pub fn request_exit(app: &tauri::AppHandle) {
    let state = app.state::<Arc<TrayState>>().inner().clone();
    let backend = app.state::<Backend>().inner().clone();
    if backend.0.closing.load(Ordering::Acquire) || state.busy.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Only the Node backend knows activity across all Projects. The renderer cannot approve exit.
        let check = backend.exit_confirmation_required().await;
        tauri::async_runtime::spawn_blocking(move || {
            if backend.0.closing.load(Ordering::Acquire) {
                state.busy.store(false, Ordering::Release);
                return;
            }
            let approved = match check {
                Ok(false) => true,
                Ok(true) => {
                    let _ = restore(&app);
                    let mut dialog = rfd::MessageDialog::new()
                        .set_title("Exit FrostPi?")
                        .set_description("Tasks are still running or waiting for input. Exiting will stop all Pi processes. Unsent drafts and temporary conversations will be discarded.")
                        .set_level(rfd::MessageLevel::Warning)
                        .set_buttons(rfd::MessageButtons::OkCancelCustom("Exit".into(), "Keep running".into()));
                    if let Some(window) = app.get_webview_window("main") {
                        dialog = dialog.set_parent(&window);
                    }
                    dialog.show() == rfd::MessageDialogResult::Custom("Exit".into())
                }
                Err(_) => {
                    let _ = restore(&app);
                    rfd::MessageDialog::new()
                        .set_title("FrostPi Desktop")
                        .set_description("Could not check running tasks. FrostPi has not exited. Try again after the backend responds.")
                        .set_level(rfd::MessageLevel::Error)
                        .show();
                    false
                }
            };
            if approved {
                backend.close(app);
            }
            state.busy.store(false, Ordering::Release);
        }).await.ok();
    });
}
