//! Setup for the whole process, before the UI starts. Nothing on Windows.

/// Returns a note for the log when it changed anything.
pub fn prepare() -> Option<String> {
    None
}

/// fork: whether this is the only meter running. A second start brings the
/// running one forward and gets false. It waits up to `wait_ms` first: a
/// restart (Npcap install, update) starts the new process before the old one
/// has quit.
pub fn ensure_single_instance(mutex_name: &str, window_title: &str, wait_ms: u32) -> bool {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::{WAIT_ABANDONED, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{CreateMutexW, WaitForSingleObject};
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, SetForegroundWindow};

    let Ok(mutex) = (unsafe { CreateMutexW(None, false, &HSTRING::from(mutex_name)) }) else {
        return true; // no mutex, no guard; better two meters than none
    };
    let wait = unsafe { WaitForSingleObject(mutex, wait_ms) };
    if wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED {
        // The handle stays open (HANDLE has no Drop): held until this process exits.
        return true;
    }
    if let Ok(window) = unsafe { FindWindowW(None, &HSTRING::from(window_title)) } {
        let _ = unsafe { SetForegroundWindow(window) };
    }
    false
}
