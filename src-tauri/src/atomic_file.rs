//! Replace a file so that a crash, a kill or an exit mid-write leaves either
//! the old content or the new one, never a truncated file.

use std::io;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

// Each target has one fixed temporary name, so writers take turns.
static WRITING: Mutex<()> = Mutex::new(());

pub fn write(path: &Path, contents: &[u8]) -> io::Result<()> {
    let _writing = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let mut name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no file name"))?
        .to_owned();
    name.push(".tmp");
    let temporary = path.with_file_name(name);
    if let Err(error) = std::fs::write(&temporary, contents) {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    let mut result = std::fs::rename(&temporary, path);
    // An antivirus or indexer on Windows can hold the target for a moment.
    for delay_ms in [20, 50] {
        if result.is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(delay_ms));
        result = std::fs::rename(&temporary, path);
    }
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("a2t-atomic-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn replaces_the_file_and_leaves_no_temporary() {
        let dir = directory("replace");
        let path = dir.join("fight.json");
        write(&path, b"old").unwrap();
        write(&path, b"new").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_write_keeps_the_previous_file() {
        let dir = directory("failed");
        let path = dir.join("settings.json");
        write(&path, b"previous").unwrap();
        // A directory where the temporary file goes makes the write fail.
        std::fs::create_dir(dir.join("settings.json.tmp")).unwrap();
        assert!(write(&path, b"lost").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"previous");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
