//! Setup for the whole process, before the UI starts. Nothing here.

/// Returns a note for the log when it changed anything.
pub fn prepare() -> Option<String> {
    None
}

/// fork: whether this is the only meter running. Not guarded here.
pub fn ensure_single_instance(_mutex_name: &str, _window_title: &str, _wait_ms: u32) -> bool {
    true
}
