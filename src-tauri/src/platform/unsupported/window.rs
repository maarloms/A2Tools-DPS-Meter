//! Tauri's own cross-platform equivalents, which is the best available here.

/// Not available: on Wayland an app cannot read the pointer outside its own
/// windows, so the click-through lock (which needs it) is not offered.
pub fn cursor_position() -> Option<(i32, i32)> {
    None
}

pub fn start_drag(window: &tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

pub fn show_on_top_without_focus(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.set_always_on_top(true);
}

pub fn minimize_off_top(window: &tauri::WebviewWindow) {
    let _ = window.set_always_on_top(false);
    let _ = window.minimize();
}

/// Fall back to the framework's focus information on other platforms.
pub fn is_foreground(window: &tauri::WebviewWindow) -> bool {
    window.is_focused().unwrap_or(false)
}
