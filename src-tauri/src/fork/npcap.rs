//! First-run setup of Npcap. Its free licence does not allow shipping the
//! installer inside ours, so the meter fetches the current one from
//! npcap.com and starts it; the player clicks through Npcap's own setup.
//! Capture only starts at launch, so the page offers a restart once the
//! driver loads.

use std::time::Duration;

use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;

const SITE: &str = "https://npcap.com/";

#[tauri::command]
pub async fn fork_install_npcap(app: tauri::AppHandle) -> Result<(), String> {
    let installer = download().await?;
    app.opener()
        .open_path(installer.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(async move {
        // Ten minutes is plenty to click through the installer.
        for _ in 0..200 {
            tokio::time::sleep(Duration::from_secs(3)).await;
            if crate::platform::pcap::library_available() {
                let _ = app.emit("fork-npcap-ready", ());
                return;
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn fork_restart(app: tauri::AppHandle) {
    app.restart();
}

/// The installer linked from npcap.com's front page ("dist/npcap-1.83.exe").
async fn download() -> Result<std::path::PathBuf, String> {
    let http = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AION2-DPS-Meter")
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let page = http.get(SITE).send().await.map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())?;
    let file = installer_name(&page).ok_or("Npcap-Download auf npcap.com nicht gefunden")?;
    let res = http.get(format!("{SITE}dist/{file}")).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Npcap-Download: HTTP {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let path = std::env::temp_dir().join(&file);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    tracing::info!("Npcap installer downloaded: {} ({} bytes)", path.display(), bytes.len());
    Ok(path)
}

fn installer_name(page: &str) -> Option<String> {
    let start = page.find("dist/npcap-")? + "dist/".len();
    let rest = &page[start..];
    let end = rest.find(".exe")? + ".exe".len();
    let name = &rest[..end];
    name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.').then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn finds_the_installer_link() {
        let page = r#"<a href="dist/npcap-1.83.exe">Npcap 1.83 installer</a>"#;
        assert_eq!(super::installer_name(page).as_deref(), Some("npcap-1.83.exe"));
        assert_eq!(super::installer_name("no link"), None);
    }
}
