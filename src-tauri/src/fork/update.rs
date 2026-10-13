//! Installing an update from the patch-notes popup (public/fork/patchnotes.js).
//!
//! Upstream asks with a native yes/no dialog (`show_update_window` in app.rs).
//! The popup shows the release notes instead and installs from here, with the
//! same download, SHA-256 check and installer (`download_and_install_update`),
//! which reports `download-progress` events (0–100) for the popup's bar.

/// The manifest's packages and their SHA-256s, as checkRelease.js passes them.
#[derive(Debug, Default, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateManifest {
    pub msi_url: String,
    pub arch_url: String,
    pub deb_url: String,
    pub rpm_url: String,
    pub msi_sha256: String,
    pub arch_sha256: String,
    pub deb_sha256: String,
    pub rpm_sha256: String,
}

/// The package this install can update itself with, and its SHA-256: picked by
/// `platform::updater::package_url` like the upstream dialog does. `None` where
/// the install updates through a package manager, or the manifest names no
/// package or no checksum for it (nothing unverified is ever installed).
pub fn pick_package(m: &UpdateManifest) -> Option<(String, String)> {
    use crate::platform::{updater, UpdatePackages};
    if !updater::supported() {
        return None;
    }
    let url = updater::package_url(&UpdatePackages { msi: &m.msi_url, arch: &m.arch_url, deb: &m.deb_url, rpm: &m.rpm_url });
    let sha = updater::package_url(&UpdatePackages { msi: &m.msi_sha256, arch: &m.arch_sha256, deb: &m.deb_sha256, rpm: &m.rpm_sha256 });
    let (url, sha) = (url.trim(), sha.trim());
    if !url.starts_with("https://") || sha.is_empty() {
        return None;
    }
    Some((url.to_string(), sha.to_string()))
}

/// Whether "Jetzt installieren" can work here; otherwise the popup offers the
/// release page.
#[tauri::command]
pub fn fork_update_can_install(update: UpdateManifest) -> bool {
    cfg!(feature = "online") && pick_package(&update).is_some()
}

/// Downloads, checks and starts the installer; the app then exits. Returns
/// only on failure (or never, once the installer runs).
#[cfg(feature = "online")]
#[tauri::command]
pub async fn fork_install_update(app: tauri::AppHandle, update: UpdateManifest) -> Result<(), String> {
    let (url, sha) = pick_package(&update).ok_or("Dieses Update lässt sich hier nicht automatisch installieren")?;
    tracing::info!("Update from the patch-notes popup: {url}");
    crate::app::download_and_install_update(&app, &url, &sha).await.inspect_err(|e| {
        tracing::error!("Update download failed: {e}");
    })
}

#[cfg(not(feature = "online"))]
#[tauri::command]
pub async fn fork_install_update(update: UpdateManifest) -> Result<(), String> {
    let _ = update;
    Err("Updates gibt es in dieser Version nicht".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> UpdateManifest {
        UpdateManifest {
            msi_url: "https://github.com/x/y/releases/download/v3.0.20/a.msi".into(),
            msi_sha256: "ab".repeat(32),
            ..Default::default()
        }
    }

    #[test]
    fn manifest_reads_the_names_check_release_sends() {
        let m: UpdateManifest = serde_json::from_value(serde_json::json!({
            "msiUrl": "https://a/b.msi", "msiSha256": "cd", "debUrl": "https://a/b.deb", "extra": 1
        }))
        .unwrap();
        assert_eq!(m.msi_url, "https://a/b.msi");
        assert_eq!(m.msi_sha256, "cd");
        assert_eq!(m.deb_url, "https://a/b.deb");
        assert_eq!(m.arch_url, "");
    }

    /// Whichever package this platform takes, the hash is that package's.
    #[test]
    fn the_hash_belongs_to_the_picked_package() {
        let m = UpdateManifest {
            msi_url: "https://a/msi".into(),
            arch_url: "https://a/arch".into(),
            deb_url: "https://a/deb".into(),
            rpm_url: "https://a/rpm".into(),
            msi_sha256: "msi-hash".into(),
            arch_sha256: "arch-hash".into(),
            deb_sha256: "deb-hash".into(),
            rpm_sha256: "rpm-hash".into(),
        };
        match pick_package(&m) {
            Some((url, sha)) => assert_eq!(format!("{}-hash", url.trim_start_matches("https://a/")), sha),
            None => assert!(!crate::platform::updater::supported() || crate::platform::updater::package_url(
                &crate::platform::UpdatePackages { msi: "m", arch: "a", deb: "d", rpm: "r" }).is_empty()),
        }
        if crate::platform::updater::supported() && pick_package(&manifest()).is_some() {
            assert_eq!(pick_package(&manifest()).unwrap().1, "ab".repeat(32));
        }
    }

    #[test]
    fn nothing_without_a_checksum_or_over_plain_http() {
        let mut m = manifest();
        m.msi_sha256 = "  ".into();
        assert_eq!(pick_package(&m), None);
        let mut m = manifest();
        m.msi_url = "http://github.com/a.msi".into();
        assert_eq!(pick_package(&m), None);
        assert_eq!(pick_package(&UpdateManifest::default()), None);
    }
}
