pub mod cloud;

use crate::app::AppState;
use crate::platform::hotkeys::HotkeyManager;
use tauri::{Manager, WindowEvent};

const VISIBLE: &str = "fork.timer.visible";

static TIMER_COMPACT_SIZE: std::sync::Mutex<Option<tauri::PhysicalSize<u32>>> =
    std::sync::Mutex::new(None);

#[tauri::command]
pub async fn resize_timer_settings(app: tauri::AppHandle, open: bool) -> Result<(), String> {
    resize_settings(&app, open)
}

fn resize_settings(app: &tauri::AppHandle, open: bool) -> Result<(), String> {
    let window = app.get_webview_window("timer").ok_or("Timer window is not open")?;
    let mut saved = TIMER_COMPACT_SIZE.lock().map_err(|e| e.to_string())?;
    if open && saved.is_none() {
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let expanded = tauri::PhysicalSize::new(size.width.max((320.0 * scale) as u32),
            size.height.max((440.0 * scale) as u32));
        window.set_size(expanded).map_err(|e| e.to_string())?;
        *saved = Some(size);
    } else if !open {
        if let Some(size) = saved.take() {
            window.set_size(size).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
/// Keep WebView2 creation off the main thread so its controller callback can run.
#[tauri::command]
pub async fn toggle_timer(app: tauri::AppHandle) -> Result<(), String> {
    toggle(&app)
}

pub fn toggle(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if let Some(window) = app.get_webview_window("timer") {
        if window.is_visible().map_err(|e| e.to_string())? {
            resize_settings(app, false)?;
            let _ = window.eval("document.getElementById('settings').hidden=true; document.getElementById('events').hidden=false; document.getElementById('filters').setAttribute('aria-expanded','false')");
            window.hide().map_err(|e| e.to_string())?;
            state.settings.set(VISIBLE, "false");
        } else {
            // Reopening always unlocks: the global hotkey is also the escape
            // route from click-through without needing to click the window.
            window.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
            let _ = window.eval("window.dispatchEvent(new Event('timer-unlocked'))");
            state.settings.set(VISIBLE, "true");
        }
        return Ok(());
    }
    let window = tauri::WebviewWindowBuilder::new(
        app, "timer", tauri::WebviewUrl::App("timer.html".into()),
    ).title("AION 2 Event-Timer")
        .decorations(false).transparent(true).always_on_top(true)
        .shadow(false).resizable(true).skip_taskbar(true)
        .inner_size(320.0, 260.0).min_inner_size(280.0, 180.0)
        .build().map_err(|e| e.to_string())?;

    if let Some(saved) = state.settings.get("fork.timer.position") {
        if let Ok(pos) = serde_json::from_str::<[i32; 2]>(&saved) {
            // Restore only if some monitor still contains the saved position.
            if window.available_monitors().unwrap_or_default().iter().any(|m| {
                let p = m.position(); let s = m.size();
                pos[0] >= p.x && pos[0] < p.x + s.width as i32 - 60 &&
                pos[1] >= p.y && pos[1] < p.y + s.height as i32 - 40
            }) {
                let _ = window.set_position(tauri::PhysicalPosition::new(pos[0], pos[1]));
            }
        }
    }
    if let Some(saved) = state.settings.get("fork.timer.size") {
        if let Ok(size) = serde_json::from_str::<[u32; 2]>(&saved) {
            if (280..=1200).contains(&size[0]) && (180..=1600).contains(&size[1]) {
                let _ = window.set_size(tauri::PhysicalSize::new(size[0], size[1]));
            }
        }
    }
    let handle = app.clone();
    window.on_window_event(move |event| {
        let state = handle.state::<AppState>();
        match event {
            WindowEvent::Moved(p) => {
                state.settings.set("fork.timer.position", &format!("[{},{}]", p.x, p.y));
            }
            WindowEvent::Resized(s) => {
                if s.width > 0 && s.height > 0 {
                    state.settings.set("fork.timer.size", &format!("[{},{}]", s.width, s.height));
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if let Some(w) = handle.get_webview_window("timer") { let _ = w.hide(); }
                state.settings.set(VISIBLE, "false");
            }
            _ => {}
        }
    });
    state.settings.set(VISIBLE, "true");
    Ok(())
}

#[tauri::command]
pub async fn set_timer_locked(app: tauri::AppHandle, locked: bool) -> Result<(), String> {
    app.get_webview_window("timer").ok_or("Timer window is not open")?
        .set_ignore_cursor_events(locked).map_err(|e| e.to_string())
}

fn spawn_toggle(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = toggle_timer(app).await {
            tracing::error!("Timer window: {e}");
        }
    });
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("fork")
        .on_event(|app, event| {
            if matches!(event, tauri::RunEvent::Ready) {
                let manager = HotkeyManager::new();
                let handle = app.clone();
                manager.start(0, 0, 3, 0x54, 0, 0, || {}, move || {
                    spawn_toggle(handle.clone());
                }, || {});
                app.manage(manager);
                if app.state::<AppState>().settings.get(VISIBLE).as_deref() == Some("true") {
                    spawn_toggle(app.clone());
                }
            } else if matches!(event, tauri::RunEvent::Exit) {
                if let Some(manager) = app.try_state::<HotkeyManager>() { manager.stop(); }
            }
        }).build()
}
/// The fork installs under its own identifier (tauri.conf.json), so its data
/// lives in a new folder. On the first start copy settings, history and the
/// WebView storage over from A2Tools' folders; the originals stay untouched.
pub fn migrate_legacy_data() {
    const OLD: &str = "com.a2tools.dps-meter";
    const NEW: &str = "de.maarloms.aion2-dps-meter";
    for var in ["APPDATA", "LOCALAPPDATA"] {
        let Some(base) = std::env::var_os(var).map(std::path::PathBuf::from) else { continue };
        let (old, new) = (base.join(OLD), base.join(NEW));
        if !old.is_dir() || new.exists() {
            continue;
        }
        match copy_dir(&old, &new) {
            Ok(()) => tracing::info!("Copied A2Tools data from {} to {}", old.display(), new.display()),
            Err(e) => tracing::warn!("Copying A2Tools data from {} failed: {e}", old.display()),
        }
    }
}

fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    // Logs, capture slices and browser caches are not worth carrying over.
    const SKIP: [&str; 5] = ["debug.log", "slices", "Cache", "Code Cache", "GPUCache"];
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if SKIP.iter().any(|s| name == *s) {
            continue;
        }
        let target = to.join(&name);
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
