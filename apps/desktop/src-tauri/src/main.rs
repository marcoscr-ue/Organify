#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

#[derive(Default)]
struct WindowCreation(tauri::async_runtime::Mutex<()>);

fn background_preference(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("minimize-on-close"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn minimize_on_close(app: tauri::AppHandle, enabled: Option<bool>) -> Result<bool, String> {
    let path = background_preference(&app)?;
    match enabled {
        Some(true) => {
            std::fs::create_dir_all(path.parent().ok_or("Ruta de ajustes no válida.")?)
                .and_then(|()| std::fs::write(&path, []))
                .map_err(|error| error.to_string())?;
        }
        Some(false) => match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        },
        None => {}
    }
    path.try_exists().map_err(|error| error.to_string())
}

#[tauri::command]
fn quit_organify(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn minimize_to_tray(window: tauri::Window) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Solo se puede ocultar la ventana principal en la bandeja.".into());
    }
    window.hide().map_err(|error| error.to_string())
}

fn restore_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        if window.is_minimized()? {
            window.unminimize()?;
        }
        window.set_focus()?;
    }
    Ok(())
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir Organify", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir de Organify", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("Organify")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Err(error) = restore_main_window(app) {
                    eprintln!("No se pudo abrir Organify: {error}");
                }
            }
            "quit" => quit_organify(app.clone()),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(error) = restore_main_window(tray.app_handle()) {
                    eprintln!("No se pudo abrir Organify: {error}");
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[tauri::command]
async fn open_floating_window(
    app: tauri::AppHandle,
    creation: tauri::State<'_, WindowCreation>,
    kind: String,
    task_id: Option<String>,
    title: Option<String>,
    context: String,
) -> Result<(), String> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT_VIEW: AtomicUsize = AtomicUsize::new(1);

    let (label, title, width, height) = match kind.as_str() {
        "task" => {
            let id = task_id
                .filter(|id| {
                    !id.is_empty()
                        && id.len() <= 64
                        && id
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                })
                .ok_or("Identificador de tarea no válido.")?;
            (
                format!("task-{id}"),
                title.unwrap_or_else(|| "Tarea".into()),
                500,
                650,
            )
        }
        "board" | "calendar" => {
            let id = NEXT_VIEW.fetch_add(1, Ordering::Relaxed);
            let title = if kind == "board" {
                "Tablero"
            } else {
                "Calendario"
            };
            (format!("view-{id}"), title.into(), 1120, 760)
        }
        _ => return Err("Vista de Organify no válida.".into()),
    };
    let _creation = creation.0.lock().await;
    if let Some(window) = app.get_webview_window(&label) {
        window.unminimize().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }

    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("Falta la configuración de la ventana principal.")?
        .clone();
    config.label = label;
    config.title = title;
    config.url = tauri::WebviewUrl::App(format!("index.html#floating={kind}&{context}").into());
    config.width = f64::from(width);
    config.height = f64::from(height);
    config.decorations = true;
    config.always_on_top = kind == "task";

    // Creating another WebView2 window from a synchronous command can deadlock.
    tauri::WebviewWindowBuilder::from_config(&app, &config)
        .and_then(|builder| builder.build())
        .map(|_| ())
        .map_err(|error| error.to_string())
}

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
        .manage(WindowCreation::default())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if background_preference(window.app_handle()).is_ok_and(|path| path.is_file()) {
                    if let Err(error) = window.hide() {
                        eprintln!("No se pudo ocultar Organify en la bandeja: {error}");
                    }
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
            setup_tray(app)?;
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
            pending_release_notes,
            minimize_on_close,
            minimize_to_tray,
            quit_organify,
            open_floating_window
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Organify");
}
