//! Private temporary files and DACL preservation without a destructive replace.

use std::fs::{File, OpenOptions};
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::FromRawHandle;
use std::path::Path;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{LocalFree, GENERIC_WRITE, HLOCAL};
use windows::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows::Win32::Security::{
    GetFileSecurityW, GetSecurityDescriptorControl, SetFileSecurityW, DACL_SECURITY_INFORMATION,
    OBJECT_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    SECURITY_ATTRIBUTES, SE_DACL_PROTECTED, UNPROTECTED_DACL_SECURITY_INFORMATION,
};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE,
};

pub struct ReplacementPermissions {
    // u64 keeps the self-relative SECURITY_DESCRIPTOR suitably aligned.
    descriptor: Vec<u64>,
    information: OBJECT_SECURITY_INFORMATION,
}

fn wide_path(path: &Path) -> io::Result<Vec<u16>> {
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no file name"))?;
    // canonicalize supplies the extended Windows prefix for long paths.
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut wide: Vec<_> = parent
        .canonicalize()?
        .join(name)
        .as_os_str()
        .encode_wide()
        .collect();
    if wide.contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "nul in file name",
        ));
    }
    wide.push(0);
    Ok(wide)
}

pub fn replacement_permissions(path: &Path) -> io::Result<Option<ReplacementPermissions>> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "target is not a regular file",
        ));
    }
    if metadata.permissions().readonly() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "target is read-only",
        ));
    }
    let wide = wide_path(path)?;
    let mut needed = 0;
    let _ = unsafe {
        GetFileSecurityW(
            PCWSTR(wide.as_ptr()),
            DACL_SECURITY_INFORMATION.0,
            None,
            0,
            &mut needed,
        )
    };
    if needed == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut descriptor = vec![0u64; (needed as usize).div_ceil(8)];
    let pointer = PSECURITY_DESCRIPTOR(descriptor.as_mut_ptr().cast());
    if !unsafe {
        GetFileSecurityW(
            PCWSTR(wide.as_ptr()),
            DACL_SECURITY_INFORMATION.0,
            Some(pointer),
            needed,
            &mut needed,
        )
    }
    .as_bool()
    {
        return Err(io::Error::last_os_error());
    }
    let (mut control, mut revision) = (0, 0);
    unsafe { GetSecurityDescriptorControl(pointer, &mut control, &mut revision) }
        .map_err(io::Error::from)?;
    let protection = if control & SE_DACL_PROTECTED.0 != 0 {
        PROTECTED_DACL_SECURITY_INFORMATION
    } else {
        UNPROTECTED_DACL_SECURITY_INFORMATION
    };
    Ok(Some(ReplacementPermissions {
        descriptor,
        information: DACL_SECURITY_INFORMATION | protection,
    }))
}

struct AllocatedDescriptor(PSECURITY_DESCRIPTOR);

impl Drop for AllocatedDescriptor {
    fn drop(&mut self) {
        unsafe { LocalFree(Some(HLOCAL(self.0 .0))) };
    }
}

pub fn create_new_private(path: &Path) -> io::Result<File> {
    let wide = wide_path(path)?;
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    // No inherited Users/Everyone ACE can expose a temporary's payload.
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            w!("D:P(A;;FA;;;SY)(A;;FA;;;OW)"),
            SDDL_REVISION_1,
            &mut descriptor,
            None,
        )
    }
    .map_err(io::Error::from)?;
    let descriptor = AllocatedDescriptor(descriptor);
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0 .0,
        bInheritHandle: false.into(),
    };
    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            GENERIC_WRITE.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            Some(&attributes),
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
    }
    .map_err(io::Error::from)?;
    // Ownership moves to File; the security descriptor is no longer needed.
    Ok(unsafe { File::from_raw_handle(handle.0) })
}

pub fn apply_permissions(
    path: &Path,
    _file: &File,
    permissions: &Option<ReplacementPermissions>,
) -> io::Result<()> {
    if let Some(permissions) = permissions {
        let wide = wide_path(path)?;
        let pointer = PSECURITY_DESCRIPTOR(permissions.descriptor.as_ptr().cast_mut().cast());
        if !unsafe { SetFileSecurityW(PCWSTR(wide.as_ptr()), permissions.information, pointer) }
            .as_bool()
        {
            return Err(io::Error::last_os_error());
        }
    }
    // Keep std::fs::rename: ReplaceFileW can remove the old target on a failed
    // replacement (ERROR_UNABLE_TO_MOVE_REPLACEMENT), unlike this contract.
    Ok(())
}

pub fn rename_retryable(error: &io::Error, target: &Path) -> bool {
    match error.raw_os_error() {
        Some(32 | 33) => true, // sharing/lock violation
        Some(5) => {
            // Some rename implementations report ACCESS_DENIED for a held
            // destination. Retry it only when opening for DELETE proves that
            // it is a sharing violation, not a persistent ACL denial.
            matches!(OpenOptions::new().access_mode(0x0001_0000)
                .share_mode(0x1 | 0x2 | 0x4).open(target),
                Err(error) if matches!(error.raw_os_error(), Some(32 | 33)))
        }
        _ => matches!(
            error.kind(),
            io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::PWSTR;
    use windows::Win32::Security::Authorization::ConvertSecurityDescriptorToStringSecurityDescriptorW;

    fn dacl_string(path: &Path) -> String {
        let permissions = replacement_permissions(path).unwrap().unwrap();
        let descriptor = PSECURITY_DESCRIPTOR(permissions.descriptor.as_ptr().cast_mut().cast());
        let mut string = PWSTR::null();
        unsafe {
            ConvertSecurityDescriptorToStringSecurityDescriptorW(
                descriptor,
                SDDL_REVISION_1,
                DACL_SECURITY_INFORMATION,
                &mut string,
                None,
            )
            .unwrap();
        }
        let result = unsafe { string.to_string().unwrap() };
        unsafe { LocalFree(Some(HLOCAL(string.0.cast()))) };
        result
    }

    #[test]
    fn temporary_has_no_broad_reader_and_an_existing_protected_dacl_survives() {
        let dir = std::env::temp_dir().join(format!("a2t-private-dacl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let file = create_new_private(&path).unwrap();
        assert_eq!(file.metadata().unwrap().len(), 0);
        let private = dacl_string(&path);
        assert!(
            private.starts_with("D:P"),
            "the DACL must not inherit broad reader ACEs: {private}"
        );
        assert!(private.contains(";;;SY)") && private.contains(";;;OW)"));
        for broad in [";;;WD)", ";;;AU)", ";;;BU)"] {
            assert!(
                !private.contains(broad),
                "a broad SID can read the temporary: {private}"
            );
        }
        drop(file);
        // A stricter existing DACL differs from the new-file default.
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                w!("D:P(A;;FA;;;OW)"),
                SDDL_REVISION_1,
                &mut descriptor,
                None,
            )
            .unwrap();
        }
        let descriptor = AllocatedDescriptor(descriptor);
        let wide = wide_path(&path).unwrap();
        assert!(unsafe {
            SetFileSecurityW(
                PCWSTR(wide.as_ptr()),
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                descriptor.0,
            )
        }
        .as_bool());
        let before = dacl_string(&path);
        crate::atomic_file::write(&path, b"private settings").unwrap();
        assert_eq!(dacl_string(&path), before);
        assert_eq!(std::fs::read(&path).unwrap(), b"private settings");
        let _ = std::fs::remove_dir_all(dir);
    }
}
