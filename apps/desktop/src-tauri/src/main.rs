#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_notification::NotificationExt;

#[tauri::command]
fn show_reminder(app: tauri::AppHandle) -> Result<(), String> {
    app.notification()
        .builder()
        .title("Organify")
        .body("Tienes una tarea pendiente.")
        .show()
        .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![show_reminder])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Organify");
}
