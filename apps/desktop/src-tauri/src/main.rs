#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod updates;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_notification::NotificationExt;

#[derive(Default)]
struct WindowCreation(tauri::async_runtime::Mutex<()>);

fn flag_preference(
    app: &tauri::AppHandle,
    name: &str,
    enabled: Option<bool>,
) -> Result<bool, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join(name);
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
fn minimize_on_close(app: tauri::AppHandle, enabled: Option<bool>) -> Result<bool, String> {
    flag_preference(&app, "minimize-on-close", enabled)
}

#[tauri::command]
fn maximize_on_startup(app: tauri::AppHandle, enabled: Option<bool>) -> Result<bool, String> {
    flag_preference(&app, "maximize-on-startup", enabled)
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
    edit: bool,
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
        if kind == "task" && edit {
            window
                .emit_to(label.as_str(), "edit-task", ())
                .map_err(|error| error.to_string())?;
        }
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
    config.visible = true;
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

#[tauri::command]
fn show_reminder(app: tauri::AppHandle, event: Option<bool>) -> Result<(), String> {
    let body = if event.unwrap_or(false) {
        "Tienes un recordatorio de Organify."
    } else {
        "Tienes una tarea pendiente."
    };
    app.notification()
        .builder()
        .title("Organify")
        .body(body)
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
                if minimize_on_close(window.app_handle().clone(), None).unwrap_or_default() {
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
            if let Some(window) = app.get_webview_window("main") {
                if maximize_on_startup(app.handle().clone(), None).unwrap_or_default() {
                    if let Err(error) = window.maximize() {
                        eprintln!("No se pudo maximizar Organify: {error}");
                    }
                }
                window.show()?;
            }
            updates::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_reminder,
            pending_release_notes,
            minimize_on_close,
            maximize_on_startup,
            minimize_to_tray,
            updates::experimental_updates,
            updates::check_experimental_update,
            open_floating_window
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Organify");
}
