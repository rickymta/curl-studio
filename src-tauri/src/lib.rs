//! Tauri shell: one `call` command that forwards to `curlstudio_core::dispatch`.

use serde_json::Value;

#[tauri::command]
async fn call(cmd: String, args: Value) -> Result<Value, curlstudio_core::Error> {
    curlstudio_core::dispatch(&cmd, args).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    curlstudio_core::http::init_tls();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![call])
        .run(tauri::generate_context!())
        .expect("error while running CurlStudio");
}
