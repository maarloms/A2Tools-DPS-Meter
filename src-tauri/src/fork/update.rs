//! The fork's own update check and install (3.0.31, from upstream 2.0.80 on).
//!
//! Upstream checks in the backend now (`update_check.rs`: taengu's CDN, an
//! Ed25519-signed manifest, compared with upstream's Cargo version) and took
//! the page's `fetch_url` away. The fork never offers that update: its
//! `check_for_update` in app.rs stops at `upstream_check()` (`// fork:`).
//! Instead the meter reads the fork's own `latest.json` from its GitHub
//! release (fork-release.ps1: version, msiUrl, msiSha256, notes), compares it
//! with this install's version (`package_info()`, tauri.conf.json's 3.0.x)
//! and keeps it. The patch-notes popup (public/fork/patchnotes.js) only says
//! "install": the package and its SHA-256 come from the kept manifest, never
//! from the page, and only from the fork's release downloads. The download
//! is installed only when its SHA-256 matches (`download_and_install_update`
//! in app.rs, which reports `download-progress` 0–100 for the popup's bar).
//! No signature of our own (Marlon, 27.10.2026): the manifest comes over
//! https from the fork's GitHub release.

use serde::Deserialize;
use std::sync::Mutex;

/// The fork's manifest, written by fork-release.ps1 into every release.
pub const MANIFEST_URL: &str = "https://github.com/maarloms/A2Tools-DPS-Meter/releases/latest/download/latest.json";
/// Where the fork's packages are; nothing else is downloaded as an update.
pub const DOWNLOAD_PREFIX: &str = "https://github.com/maarloms/A2Tools-DPS-Meter/releases/download/";
/// The fork's releases with their notes, for the patch-notes popup.
pub const RELEASES_API: &str = "https://api.github.com/repos/maarloms/A2Tools-DPS-Meter/releases?per_page=100";

/// latest.json is a few KB (the notes); anything far bigger isn't it.
const MAX_MANIFEST: usize = 256 * 1024;
/// A hundred releases with their notes.
#[cfg_attr(not(feature = "online"), allow(dead_code))]
const MAX_RELEASE_LIST: usize = 8 * 1024 * 1024;

/// latest.json. fork-release.ps1 writes version, msiUrl, msiSha256 and notes;
/// the other packages are upstream's names, read the same way.
#[derive(Debug, Default, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateManifest {
    pub version: String,
    pub notes: String,
    pub msi_url: String,
    pub arch_url: String,
    pub deb_url: String,
    pub rpm_url: String,
    pub msi_sha256: String,
    pub arch_sha256: String,
    pub deb_sha256: String,
    pub rpm_sha256: String,
}

/// The update the last check found (newer than this install), for the popup's
/// "Jetzt installieren". None when there is none.
static FOUND: Mutex<Option<UpdateManifest>> = Mutex::new(None);

fn found() -> std::sync::MutexGuard<'static, Option<UpdateManifest>> {
    FOUND.lock().unwrap_or_else(|e| e.into_inner())
}

/// Upstream's `check_for_update` (app.rs) would offer taengu's package from
/// cdn.a2tools.app, compared with upstream's Cargo version: never in the fork.
pub fn upstream_check() -> Result<(), String> {
    Err("this build checks the fork's own releases (fork_check_update)".into())
}

/// A package of the fork's releases, over https, with a plain path.
pub fn allowed_package_url(url: &str) -> bool {
    url.strip_prefix(DOWNLOAD_PREFIX).is_some_and(|path| {
        !path.is_empty()
            && !path.contains("..")
            && !path.starts_with('/')
            && path.contains('/')
            && path.chars().all(|c| c.is_ascii_alphanumeric() || "/._-+".contains(c))
    })
}

/// A SHA-256 in hex.
fn sha256_shaped(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The package this install can update itself with, and its SHA-256: picked by
/// `platform::updater::package_url` like upstream does. `None` where the
/// install updates through a package manager, or the manifest names no
/// package of the fork's releases or no checksum for it (nothing unverified
/// is ever installed).
pub fn pick_package(m: &UpdateManifest) -> Option<(String, String)> {
    use crate::platform::{updater, UpdatePackages};
    if !updater::supported() {
        return None;
    }
    let url = updater::package_url(&UpdatePackages { msi: &m.msi_url, arch: &m.arch_url, deb: &m.deb_url, rpm: &m.rpm_url });
    let sha = updater::package_url(&UpdatePackages { msi: &m.msi_sha256, arch: &m.arch_sha256, deb: &m.deb_sha256, rpm: &m.rpm_sha256 });
    let (url, sha) = (url.trim(), sha.trim());
    if !allowed_package_url(url) || !sha256_shaped(sha) {
        return None;
    }
    Some((url.to_string(), sha.to_lowercase()))
}

/// Reads latest.json (a BOM in front is allowed).
#[cfg_attr(not(feature = "online"), allow(dead_code))]
pub fn parse_manifest(body: &[u8]) -> Result<UpdateManifest, String> {
    if body.len() > MAX_MANIFEST {
        return Err("the update manifest is too big".into());
    }
    let body = body.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(body);
    serde_json::from_slice(body).map_err(|e| format!("update manifest: {e}"))
}

/// The check's answer for the page, keeping the manifest in `slot` when it is
/// newer than `current` (and forgetting an older find otherwise):
/// { state: "update" | "current", current, latest, notes, canInstall }.
#[cfg(feature = "online")]
fn remember(slot: &Mutex<Option<UpdateManifest>>, m: UpdateManifest, current: &str) -> serde_json::Value {
    let mut slot = slot.lock().unwrap_or_else(|e| e.into_inner());
    let latest = m.version.trim().trim_start_matches(['v', 'V']).to_string();
    if !crate::update_check::newer(&latest, current) {
        *slot = None;
        let latest = if crate::update_check::newer(&latest, "0") { latest } else { String::new() };
        return serde_json::json!({ "state": "current", "current": current, "latest": latest });
    }
    let can_install = pick_package(&m).is_some();
    let notes = m.notes.clone();
    *slot = Some(m);
    serde_json::json!({ "state": "update", "current": current, "latest": latest, "notes": notes, "canInstall": can_install })
}

/// One check (at start, every 6 hours, Settings' button): the fork's
/// latest.json against this install's version.
#[cfg(feature = "online")]
#[tauri::command]
pub async fn fork_check_update(app: tauri::AppHandle, state: tauri::State<'_, crate::app::AppState>) -> Result<serde_json::Value, String> {
    let response = state
        .http
        .get(MANIFEST_URL)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let body = response.bytes().await.map_err(|e| e.to_string())?;
    let manifest = parse_manifest(&body)?;
    let current = app.package_info().version.to_string();
    Ok(remember(&FOUND, manifest, &current))
}

#[cfg(not(feature = "online"))]
#[tauri::command]
pub async fn fork_check_update() -> Result<serde_json::Value, String> {
    Err("Updates gibt es in dieser Version nicht".into())
}

/// Whether "Jetzt installieren" can work here for the update the last check
/// found; otherwise the popup offers the release page.
#[tauri::command]
pub fn fork_update_can_install() -> bool {
    cfg!(feature = "online") && found().as_ref().is_some_and(|m| pick_package(m).is_some())
}

/// Downloads the update the last check found, checks its SHA-256 and starts
/// the installer; the app then exits. Returns only on failure (or never, once
/// the installer runs). Takes nothing from the page.
#[cfg(feature = "online")]
#[tauri::command]
pub async fn fork_install_update(app: tauri::AppHandle) -> Result<(), String> {
    let picked = found().as_ref().and_then(pick_package);
    let (url, sha) = picked.ok_or("Dieses Update lässt sich hier nicht automatisch installieren")?;
    tracing::info!("Update from the patch-notes popup: {url}");
    crate::app::download_and_install_update(&app, &url, &sha).await.inspect_err(|e| {
        tracing::error!("Update download failed: {e}");
    })
}

#[cfg(not(feature = "online"))]
#[tauri::command]
pub async fn fork_install_update() -> Result<(), String> {
    Err("Updates gibt es in dieser Version nicht".into())
}

/// The fork's releases (GitHub API, JSON text) for the patch-notes popup.
#[cfg(feature = "online")]
#[tauri::command]
pub async fn fork_release_list(state: tauri::State<'_, crate::app::AppState>) -> Result<String, String> {
    let response = state
        .http
        .get(RELEASES_API)
        .header("accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let body = response.bytes().await.map_err(|e| e.to_string())?;
    if body.len() > MAX_RELEASE_LIST {
        return Err("the release list is too big".into());
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

#[cfg(not(feature = "online"))]
#[tauri::command]
pub async fn fork_release_list() -> Result<String, String> {
    Err("Updates gibt es in dieser Version nicht".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA: &str = "abababababababababababababababababababababababababababababababab";

    fn manifest(version: &str) -> UpdateManifest {
        UpdateManifest {
            version: version.into(),
            notes: "**Neu**\n- x".into(),
            msi_url: format!("{DOWNLOAD_PREFIX}v{version}/AION2-DPS-Meter_{version}_x64.msi"),
            msi_sha256: SHA.into(),
            ..Default::default()
        }
    }

    #[test]
    fn only_the_forks_release_downloads_are_allowed() {
        assert!(allowed_package_url("https://github.com/maarloms/A2Tools-DPS-Meter/releases/download/v3.0.31/AION2-DPS-Meter_3.0.31_x64.msi"));
        for bad in [
            // taengu's CDN and repository, never.
            "https://cdn.a2tools.app/A2Tools.DPS.Meter_2.0.83_x64_en-US.msi",
            "https://github.com/taengu/A2Tools-DPS-Meter/releases/download/v2.0.83/a.msi",
            // Plain http, another host, a look-alike, a path out of the prefix.
            "http://github.com/maarloms/A2Tools-DPS-Meter/releases/download/v3.0.31/a.msi",
            "https://github.com.evil.example/maarloms/A2Tools-DPS-Meter/releases/download/v3.0.31/a.msi",
            "https://github.com/maarloms/A2Tools-DPS-Meter/releases/download.evil/v3.0.31/a.msi",
            "https://github.com/maarloms/A2Tools-DPS-Meter/releases/download/../../../taengu/x/a.msi",
            "https://github.com/maarloms/A2Tools-DPS-Meter/releases/download//evil.example/a.msi",
            "https://github.com/maarloms/A2Tools-DPS-Meter/releases/download/v3.0.31/a.msi?x=https://cdn.a2tools.app",
            "https://github.com/maarloms/A2Tools-DPS-Meter/releases/download/a.msi",
            "https://github.com/maarloms/A2Tools-DPS-Meter/releases/latest/download/a.msi",
            "https://github.com/maarloms/A2Tools-DPS-Meter/releases/download/",
            "",
        ] {
            assert!(!allowed_package_url(bad), "{bad}");
        }
    }

    #[test]
    fn the_forks_addresses_are_its_own() {
        for url in [MANIFEST_URL, DOWNLOAD_PREFIX, RELEASES_API] {
            assert!(url.starts_with("https://"), "{url}");
            assert!(url.contains("maarloms/A2Tools-DPS-Meter"), "{url}");
            assert!(!url.contains("a2tools.app") && !url.contains("taengu"), "{url}");
        }
        assert!(upstream_check().is_err());
    }

    #[test]
    fn latest_json_as_fork_release_ps1_writes_it() {
        let body = "\u{feff}{\r\n  \"version\": \"3.0.31\",\r\n  \"msiUrl\": \"https://github.com/maarloms/A2Tools-DPS-Meter/releases/download/v3.0.31/AION2-DPS-Meter_3.0.31_x64.msi\",\r\n  \"msiSha256\": \"ABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABAB\",\r\n  \"notes\": \"**Neu**\\r\\n- Umlaute: äöü\"\r\n}";
        let m = parse_manifest(body.as_bytes()).unwrap();
        assert_eq!(m.version, "3.0.31");
        assert_eq!(m.notes, "**Neu**\r\n- Umlaute: äöü");
        assert_eq!(m.arch_url, "");
        if crate::platform::updater::supported() && cfg!(windows) {
            assert_eq!(pick_package(&m), Some((m.msi_url.clone(), SHA.to_string())));
        }
        assert!(parse_manifest(b"<html>").is_err());
        assert!(parse_manifest(&vec![b' '; MAX_MANIFEST + 1]).is_err());
    }

    #[test]
    fn nothing_without_a_proper_checksum_or_from_elsewhere() {
        for sha in ["".to_string(), "  ".into(), "ab".into(), "zz".repeat(32), "ab".repeat(33)] {
            let mut m = manifest("3.0.31");
            m.msi_sha256 = sha.clone();
            assert_eq!(pick_package(&m), None, "{sha:?}");
        }
        let mut m = manifest("3.0.31");
        m.msi_url = "https://cdn.a2tools.app/a.msi".into();
        assert_eq!(pick_package(&m), None);
        assert_eq!(pick_package(&UpdateManifest::default()), None);
    }

    /// Whichever package this platform takes, the hash is that package's.
    #[test]
    fn the_hash_belongs_to_the_picked_package() {
        let pkg = |name: &str| format!("{DOWNLOAD_PREFIX}v3.0.31/{name}");
        let hash = |c: char| c.to_string().repeat(64);
        let m = UpdateManifest {
            msi_url: pkg("a.msi"),
            arch_url: pkg("a.pkg.tar.zst"),
            deb_url: pkg("a.deb"),
            rpm_url: pkg("a.rpm"),
            msi_sha256: hash('1'),
            arch_sha256: hash('2'),
            deb_sha256: hash('3'),
            rpm_sha256: hash('4'),
            ..Default::default()
        };
        if let Some((url, sha)) = pick_package(&m) {
            let want = match url.rsplit('.').next().unwrap() {
                "msi" => hash('1'),
                "zst" => hash('2'),
                "deb" => hash('3'),
                _ => hash('4'),
            };
            assert_eq!(sha, want);
        }
    }

    #[test]
    #[cfg(feature = "online")]
    fn only_a_newer_fork_version_is_kept_and_offered() {
        let slot = Mutex::new(None);
        let found = remember(&slot, manifest("3.0.31"), "3.0.30");
        assert_eq!(found["state"], "update");
        assert_eq!(found["current"], "3.0.30");
        assert_eq!(found["latest"], "3.0.31");
        assert_eq!(found["notes"], "**Neu**\n- x");
        assert_eq!(slot.lock().unwrap().as_ref(), Some(&manifest("3.0.31")));
        // The same version, an older one, upstream's 2.0.x: nothing, and an
        // earlier find is forgotten.
        for v in ["3.0.30", "v3.0.29", "2.0.83", "kaputt", ""] {
            remember(&slot, manifest("3.0.31"), "3.0.30");
            let found = remember(&slot, manifest(v), "3.0.30");
            assert_eq!(found["state"], "current", "{v}");
            assert!(slot.lock().unwrap().is_none(), "{v}");
        }
        assert_eq!(remember(&slot, manifest("kaputt"), "3.0.30")["latest"], "");
        // A find without an installable package is still an update (the
        // popup offers the release page then).
        let mut m = manifest("3.0.32");
        m.msi_url = "https://cdn.a2tools.app/a.msi".into();
        let found = remember(&slot, m, "3.0.31");
        assert_eq!(found["state"], "update");
        assert_eq!(found["canInstall"], false);
    }

    /// The check compares with this install's version (tauri.conf.json's
    /// 3.0.x), never upstream's Cargo version (2.0.x), and upstream's own
    /// check stops at the fork's guard before it fetches anything.
    #[test]
    fn the_running_version_is_the_forks_and_upstreams_check_is_off() {
        let src = include_str!("update.rs").replace("\r\n", "\n");
        let check = &src[src.find("pub async fn fork_check_update(app").unwrap()..];
        let check = &check[..check.find("\n}\n").unwrap()];
        assert!(check.contains("app.package_info().version.to_string()"), "{check}");
        assert!(!check.contains(&["CARGO", "PKG_VERSION"].join("_")), "{check}");
        assert!(check.contains(".get(MANIFEST_URL)"), "{check}");
        // The install takes nothing from the page.
        assert!(src.contains("pub async fn fork_install_update(app: tauri::AppHandle) -> Result<(), String> {"));

        let app = include_str!("../app.rs").replace("\r\n", "\n");
        let at = app.find("async fn check_for_update(app: tauri::AppHandle").expect("upstream's online check");
        let head: String = app[at..].lines().take(3).collect::<Vec<_>>().join("\n");
        assert!(head.contains("crate::fork::update::upstream_check()?;"), "{head}");
        let tauri_conf = include_str!("../../tauri.conf.json");
        assert!(tauri_conf.contains("\"version\": \"3."), "the fork's version line");
    }
}
