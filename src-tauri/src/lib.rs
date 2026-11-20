//! Tauri shell: one `call` command that forwards to `curlstudio_core::dispatch`.

use serde_json::Value;
use tauri::{Manager, PhysicalPosition, PhysicalSize};

/// Share of the screen the main window covers when the app starts.
const START_FRACTION: f64 = 0.85;

#[tauri::command]
async fn call(cmd: String, args: Value) -> Result<Value, curlstudio_core::Error> {
    curlstudio_core::dispatch(&cmd, args).await
}

/// Size the main window to 85% of the monitor's work area, centred, then show it
/// (it starts hidden so it never flashes at the configured size).
fn fit_to_screen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let area = monitor.work_area();
        let w = (area.size.width as f64 * START_FRACTION).round() as u32;
        let h = (area.size.height as f64 * START_FRACTION).round() as u32;
        window.set_size(PhysicalSize::new(w, h))?;
        window.set_position(PhysicalPosition::new(
            area.position.x + ((area.size.width - w) / 2) as i32,
            area.position.y + ((area.size.height - h) / 2) as i32,
        ))?;
    }
    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// Bring the already-running main window to the front (a second launch lands here
/// instead of opening another window).
#[cfg(all(desktop, not(debug_assertions)))]
fn focus_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    curlstudio_core::http::init_tls();
    let builder = tauri::Builder::default();
    // One CurlStudio per user: two instances would write the same workspace folder (collections,
    // history, activity.jsonl) over each other. Release builds only: a dev build (same
    // identifier) would otherwise hand off to an installed CurlStudio that is running and quit.
    // Must be the first plugin, so a second launch exits before anything else starts.
    #[cfg(all(desktop, not(debug_assertions)))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        focus_main(app)
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if fit_to_screen(&window).is_err() {
                    let _ = window.show();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![call])
        .run(tauri::generate_context!())
        .expect("error while running CurlStudio");
}
