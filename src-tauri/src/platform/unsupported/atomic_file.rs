//! File creation and permissions, shared by Linux and other Unix desktops.

use std::fs::{File, OpenOptions, Permissions};
use std::io;
use std::path::Path;

#[cfg(target_os = "linux")]
#[path = "../linux/file_permissions.rs"]
mod linux;

#[derive(Clone)]
pub struct ReplacementPermissions {
    permissions: Permissions,
    #[cfg(target_os = "linux")]
    security: linux::SecuritySnapshot,
}

pub fn replacement_permissions(path: &Path) -> io::Result<Option<ReplacementPermissions>> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(Some(ReplacementPermissions {
            permissions: metadata.permissions(),
            #[cfg(target_os = "linux")]
            security: linux::snapshot(path, &metadata)?,
        })),
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "target is not a regular file",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn create_new_private(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // Set at creation, before either a name or any payload is exposed.
        options.mode(0o600);
    }
    options.open(path)
}

pub fn apply_permissions(
    _path: &Path,
    file: &File,
    permissions: &Option<ReplacementPermissions>,
) -> io::Result<()> {
    if let Some(permissions) = permissions {
        #[cfg(target_os = "linux")]
        linux::restore(_path, file, &permissions.security)?;
        // On Linux the group mode bits are an ACL mask, not necessarily the
        // owning group's rights. Restore the ACL before widening that mask.
        file.set_permissions(permissions.permissions.clone())?;
    }
    Ok(())
}

pub fn rename_retryable(error: &io::Error, _target: &Path) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
    )
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn temporary_is_private_before_any_payload_and_replacement_preserves_mode() {
        let dir = std::env::temp_dir().join(format!("a2t-private-temp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let mut file = create_new_private(&path).unwrap();
        assert_eq!(file.metadata().unwrap().len(), 0);
        assert_eq!(file.metadata().unwrap().permissions().mode() & 0o077, 0);
        file.write_all(b"old").unwrap();
        drop(file);
        for mode in [0o600, 0o640] {
            std::fs::set_permissions(&path, Permissions::from_mode(mode)).unwrap();
            crate::atomic_file::write(&path, b"new").unwrap();
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                mode
            );
            assert_eq!(std::fs::read(&path).unwrap(), b"new");
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
