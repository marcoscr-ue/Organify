#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
fn pending_release_notes(app: tauri::AppHandle, dismiss: bool) -> Result<bool, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("pending-release-notes");
    let installed_version = match std::fs::read_to_string(&path) {
        Ok(version) => version,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.to_string()),
    };
    if installed_version.trim() != app.package_info().version.to_string() {
        return Ok(false);
    }
    if dismiss {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(true)
}

async fn install_update(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    let updater = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    if let Some(update) = updater.check().await? {
        // The Windows installer closes and relaunches Organify.
        update.download_and_install(|_, _| {}, || {}).await?;
    }
    Ok(())
}

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
        .setup(|app| {
            if !cfg!(debug_assertions) && app.config().plugins.0.contains_key("updater") {
                let handle = app.handle().clone();
                handle.plugin(tauri_plugin_updater::Builder::new().build())?;
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = install_update(handle).await {
                        eprintln!("No se pudo actualizar Organify: {error}");
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_reminder,
            pending_release_notes
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Organify");
}
