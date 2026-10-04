//! "Diagnose an Gruppe senden": packs the logs, the settings (secrets blanked)
//! and the last fights into one gzip JSON and uploads it to the group's room
//! (app/cloud, POST /api/rooms/:code/diagnostics). Lets a friend's meter be
//! looked at without walking them through AppData.

use std::path::Path;
use std::time::{Duration, SystemTime};

use tauri::Manager;

use crate::app::AppState;

/// Newest log text per file; meter.log rotates at 2 MB anyway.
const LOG_TAIL_BYTES: u64 = 2 * 1024 * 1024;
/// Fights from this far back, newest first, at most this many and this much raw JSON.
/// Fight JSON packs about 10:1, so this stays well under the server's 8 MB.
const FIGHTS_MAX_AGE: Duration = Duration::from_secs(12 * 3600);
const FIGHTS_MAX: usize = 8;
const FIGHTS_MAX_BYTES: u64 = 40 * 1024 * 1024;

/// Settings whose key looks like a credential are sent blanked.
fn is_secret(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    ["secret", "token", "password", "passwort", "session", "cookie", "auth"].iter().any(|s| k.contains(s))
}

fn tail(path: &Path, max: u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(max);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    let mut text = String::from_utf8_lossy(&buf).into_owned();
    if start > 0 {
        // begin at a whole line
        if let Some(i) = text.find('\n') {
            text.drain(..=i);
        }
    }
    Some(text)
}

/// Newest saved fights (raw file contents), see the FIGHTS_* limits.
fn recent_fights(dir: &Path) -> Vec<String> {
    let now = SystemTime::now();
    let mut files: Vec<(SystemTime, u64, std::path::PathBuf)> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
                .filter_map(|e| {
                    let meta = e.metadata().ok()?;
                    Some((meta.modified().ok()?, meta.len(), e.path()))
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out = Vec::new();
    let mut total = 0;
    for (modified, len, path) in files {
        if out.len() >= FIGHTS_MAX || now.duration_since(modified).unwrap_or_default() > FIGHTS_MAX_AGE {
            break;
        }
        if total + len > FIGHTS_MAX_BYTES {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&path) {
            if serde_json::from_str::<serde::de::IgnoredAny>(&text).is_ok() {
                total += len;
                out.push(text);
            }
        }
    }
    out
}

/// The whole bundle as JSON text. Fights are spliced in verbatim.
fn bundle(state: &AppState, version: &str, uploader: &str, note: &str) -> String {
    let dir = &state.app_data_dir;
    let settings: serde_json::Map<String, serde_json::Value> = state
        .settings
        .get_all()
        .into_iter()
        .map(|(k, v)| {
            let v = if is_secret(&k) && !v.is_empty() { "***".to_string() } else { v };
            (k, serde_json::Value::String(v))
        })
        .collect();
    let mut logs = serde_json::Map::new();
    for name in ["meter.log", "meter.old.log", "debug.log"] {
        if let Some(text) = tail(&dir.join(name), LOG_TAIL_BYTES) {
            logs.insert(name.to_string(), serde_json::Value::String(text));
        }
    }
    let head = serde_json::json!({
        "kind": "a2dps-diagnostics",
        "appVersion": version,
        "os": std::env::consts::OS,
        "sentAtMs": crate::clock::now_ms(),
        "uploader": uploader,
        "note": note,
        "settings": settings,
        "logs": logs,
    });
    let mut text = head.to_string();
    text.pop(); // the closing brace; fights follow
    text.push_str(",\"fights\":[");
    text.push_str(&recent_fights(&dir.join("history")).join(","));
    text.push_str("]}");
    text
}

/// Sends the bundle; returns how big it was (KB, compressed).
#[tauri::command]
pub async fn fork_send_diagnostics(app: tauri::AppHandle, note: Option<String>) -> Result<u64, String> {
    let state = app.try_state::<AppState>().ok_or("App nicht bereit")?;
    let get = |k: &str| state.settings.get(k).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let (Some(base), Some(room), Some(secret)) = (get(super::cloud::URL), get(super::cloud::ROOM), get(super::cloud::SECRET)) else {
        return Err("Erst Server, Raum-Code und Passwort eintragen".into());
    };
    let uploader = state
        .data_storage
        .local_character_name()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "unbekannt".into());
    let note: String = note.unwrap_or_default().trim().chars().take(300).collect();

    let json = bundle(&state, &app.package_info().version.to_string(), &uploader, &note);
    let body = crate::share::gzip(json.as_bytes())?;
    let size = body.len() as u64;
    let res = state
        .http
        .post(format!("{}/api/rooms/{}/diagnostics", base.trim_end_matches('/'), room.to_lowercase()))
        .query(&[("uploader", uploader.as_str()), ("note", note.as_str())])
        .bearer_auth(&secret)
        .header("content-type", "application/gzip")
        .body(body)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(match res.status().as_u16() {
            401 => "Passwort falsch".into(),
            413 => "Zu groß für den Server".into(),
            s => format!("HTTP {s}"),
        });
    }
    tracing::info!("Diagnostics sent ({} KB)", size / 1024);
    Ok(size / 1024)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_are_blanked() {
        assert!(is_secret("fork.cloud.secret"));
        assert!(is_secret("account.accessToken"));
        assert!(!is_secret("fork.cloud.room"));
        assert!(!is_secret("fork.cloud.url"));
    }

    #[test]
    fn tail_starts_at_a_whole_line() {
        let dir = std::env::temp_dir().join(format!("a2diag-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.log");
        std::fs::write(&path, "erste zeile\nzweite zeile\ndritte\n").unwrap();
        assert_eq!(tail(&path, 16).unwrap(), "dritte\n");
        assert_eq!(tail(&path, 1000).unwrap(), "erste zeile\nzweite zeile\ndritte\n");
        std::fs::remove_dir_all(&dir).ok();
    }
}
