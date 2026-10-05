//! WebView2 must load a window visible: a hidden one may never load its
//! content. So windows load visible and Settings is rebuilt on every open,
//! since a hidden WebView2 window came back blank when shown again.

pub fn loads_hidden() -> bool {
    false
}

pub fn reuses_settings() -> bool {
    false
}

pub fn main_ready(_window: &tauri::WebviewWindow) {}

pub fn arm_main_fallback(_window: tauri::WebviewWindow) {}

pub fn request_settings_open() -> bool {
    true
}

pub fn settings_ready() -> bool {
    true
}

pub fn begin_settings_load() {}

pub fn hide_settings(_window: &tauri::WebviewWindow) {}

pub fn prepare_settings(_window: &tauri::WebviewWindow) {}

pub fn center_before_show(
    _app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    _size: tauri::LogicalSize<f64>,
) {
    let _ = window.center();
}
