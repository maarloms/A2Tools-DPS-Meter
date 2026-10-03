//! Uploads finished boss fights to the group's room on the fork's Cloudflare
//! worker (app/cloud, see app/cloud/PROTOCOL.md). Live sharing runs in the
//! page (public/fork/cloud.js); this side only does the uploads, which want
//! the full FightRecord and gzip.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager};

use crate::app::AppState;
use crate::entity::fight_record::FightRecord;

pub const ENABLED: &str = "fork.cloud.enabled";
pub const URL: &str = "fork.cloud.url";
pub const ROOM: &str = "fork.cloud.room";
pub const SECRET: &str = "fork.cloud.secret";

/// A boss being fought is re-saved every 30 s; only a fight that has been
/// over this long is final.
const ENDED_AFTER_MS: i64 = 10_000;
const RETRY_DELAYS: [u64; 3] = [10, 60, 300];

static UPLOADED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

struct Room {
    base: String,
    code: String,
    secret: String,
}

fn room(state: &AppState) -> Option<Room> {
    if state.settings.get(ENABLED).as_deref() != Some("true") {
        return None;
    }
    let get = |k| state.settings.get(k).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    Some(Room {
        base: get(URL)?.trim_end_matches('/').to_string(),
        code: get(ROOM)?.to_lowercase(),
        secret: get(SECRET)?,
    })
}

/// Called after the auto-save wrote `records`. Uploads each finished fight
/// once per session; the server replaces a repeat, so a restart re-sending
/// one is harmless.
pub fn on_fights_saved(app: &tauri::AppHandle, records: &[FightRecord]) {
    let Some(state) = app.try_state::<AppState>() else { return };
    if room(&state).is_none() {
        return;
    }
    let now = crate::clock::now_ms();
    for record in records {
        if record.is_train || now - (record.start_time_ms + record.duration_ms) < ENDED_AFTER_MS {
            continue;
        }
        {
            let mut uploaded = UPLOADED.lock().unwrap_or_else(|e| e.into_inner());
            if !uploaded.get_or_insert_with(HashSet::new).insert(record.id.clone()) {
                continue;
            }
        }
        let app = app.clone();
        let record = record.clone();
        tauri::async_runtime::spawn(async move { upload_with_retry(app, record).await });
    }
}

async fn upload_with_retry(app: tauri::AppHandle, record: FightRecord) {
    for (attempt, delay) in std::iter::once(0).chain(RETRY_DELAYS).enumerate() {
        tokio::time::sleep(Duration::from_secs(delay)).await;
        match upload(&app, &record).await {
            Ok(Some(url)) => {
                tracing::info!("Cloud: fight {} uploaded", record.id);
                let _ = app.emit("fork-cloud-uploaded", serde_json::json!({ "id": record.id, "url": url }));
                return;
            }
            Ok(None) => return, // sharing switched off meanwhile
            Err((e, retry)) => {
                tracing::warn!("Cloud: upload of {} failed (try {}): {e}", record.id, attempt + 1);
                let _ = app.emit("fork-cloud-error", e.clone());
                if !retry {
                    break;
                }
            }
        }
    }
    if let Ok(mut uploaded) = UPLOADED.lock() {
        uploaded.get_or_insert_with(HashSet::new).remove(&record.id);
    }
}

/// `Err((message, worth retrying))`.
async fn upload(app: &tauri::AppHandle, record: &FightRecord) -> Result<Option<String>, (String, bool)> {
    let Some(state) = app.try_state::<AppState>() else { return Ok(None) };
    let Some(room) = room(&state) else { return Ok(None) };
    let uploader = state.data_storage.local_character_name()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| ("Charaktername noch unbekannt".to_string(), true))?;
    let json = serde_json::to_vec(record).map_err(|e| (e.to_string(), false))?;
    let body = crate::share::gzip(&json).map_err(|e| (e, false))?;
    let res = state.http
        .post(format!("{}/api/rooms/{}/fights", room.base, room.code))
        .query(&[("uploader", uploader.as_str())])
        .bearer_auth(&room.secret)
        .header("content-type", "application/json")
        .header("content-encoding", "gzip")
        .body(body)
        .send()
        .await
        .map_err(|e| (e.to_string(), true))?;
    let status = res.status();
    if status.is_success() {
        let text = res.text().await.unwrap_or_default();
        let reply: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let path = reply.get("url").and_then(|u| u.as_str()).unwrap_or("/");
        return Ok(Some(format!("{}{}", room.base, path)));
    }
    let retry = status.as_u16() == 429 || status.is_server_error();
    Err((format!("HTTP {status}"), retry))
}
