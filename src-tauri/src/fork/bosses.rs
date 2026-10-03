//! Field boss respawn timers ("Feldbosse" in the event timer). Field bosses
//! have no schedule: they come back a while after they die. The meter sees a
//! boss die or spawn in range (`MOB_LIFE_HOOK`), the timer window adds what
//! the in-game map shows ("spawnt in 10:45"), and the group's room shares
//! both (public/fork/cloud.js). The respawn interval is learnt from a kill
//! followed by a map countdown.
//!
//! Best of all, the open in-game map streams every field boss of that map
//! with its next spawn (packet `01 91`, `parse_map_bosses`), so opening the
//! map once fills in all timers without anyone having seen a kill.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::app::AppState;

const KEY: &str = "fork.bosses";
const EVENT: &str = "fork-boss-update";
/// Which mob codes are field bosses, and their known respawn, come from the
/// timer's own event list so the two never disagree.
const EVENTS: &str = include_str!("../../../public/fork/events.json");
/// A death packet repeated after a combat reset is still the same kill.
const SAME_KILL_MS: i64 = 2 * 60_000;
/// Walking past a living boss refreshes the sighting at most this often.
const SEEN_EVERY_MS: i64 = 5 * 60_000;
/// The corpse stays a while; seeing it is not a respawn.
const CORPSE_MS: i64 = 10 * 60_000;
/// A map countdown only teaches the interval when the kill is this recent.
const LEARN_WITHIN_MS: i64 = 12 * 3_600_000;
/// Another client's clock may run ahead, but not by hours.
const FUTURE_SLACK_MS: i64 = 10 * 60_000;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BossTimer {
    pub code: i32,
    pub killed_at: Option<i64>,
    pub respawn_at: Option<i64>,
    pub seen_at: Option<i64>,
    pub interval_min: Option<u32>,
    /// Character that reported it; empty for this app.
    pub by: String,
    pub updated: i64,
}

#[derive(Clone, Serialize)]
struct Update<'a> {
    origin: &'a str,
    timers: Vec<BossTimer>,
}

/// mob code -> respawn minutes from events.json (None = not known yet).
fn tracked() -> &'static HashMap<i32, Option<u32>> {
    static TRACKED: OnceLock<HashMap<i32, Option<u32>>> = OnceLock::new();
    TRACKED.get_or_init(|| parse_tracked(EVENTS))
}

fn parse_tracked(json: &str) -> HashMap<i32, Option<u32>> {
    let mut out = HashMap::new();
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else { return out };
    for event in value["events"].as_array().into_iter().flatten() {
        if event["kind"] != "respawn" {
            continue;
        }
        let minutes = event["respawnMinutes"].as_u64().map(|m| m as u32);
        for code in event["mobCodes"].as_array().into_iter().flatten().filter_map(|c| c.as_i64()) {
            out.insert(code as i32, minutes);
        }
    }
    out
}

/// Spawn ids the in-game map uses -> mob code (events.json `spawnIds`).
fn spawn_ids() -> &'static HashMap<i32, i32> {
    static IDS: OnceLock<HashMap<i32, i32>> = OnceLock::new();
    IDS.get_or_init(|| parse_spawn_ids(EVENTS))
}

fn parse_spawn_ids(json: &str) -> HashMap<i32, i32> {
    let mut out = HashMap::new();
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else { return out };
    for event in value["events"].as_array().into_iter().flatten() {
        let Some(code) = event["mobCodes"][0].as_i64() else { continue };
        for id in event["spawnIds"].as_array().into_iter().flatten().filter_map(|c| c.as_i64()) {
            out.insert(id as i32, code as i32);
        }
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MapBoss {
    pub spawn_id: i32,
    pub alive: bool,
    /// Alive: when it spawned. Dead: when it will.
    pub at_ms: i64,
}

fn plausible_ms(v: u64) -> bool {
    (1_600_000_000_000..2_500_000_000_000).contains(&v)
}

/// `<len> 01 91 <u16> <map u32> <count varint>`, then per boss
/// `<alive u8> <spawn id varint> [alive: x y z f32] [sometimes a byte] <u64 ms>`.
/// Read off a capture of the Altgard map (map 1110, spawn ids 111001-111024)
/// against the countdowns the map showed. All or nothing: one record that
/// does not fit and the packet is ignored.
pub fn parse_map_bosses(packet: &[u8]) -> Option<(u32, Vec<MapBoss>)> {
    use crate::capture::stream_processor::read_varint;
    let len = read_varint(packet, 0);
    let mut pos = usize::try_from(len.length).ok().filter(|l| *l > 0)?;
    if packet.get(pos..pos + 2)? != [0x01, 0x91] {
        return None;
    }
    pos += 4;
    let map = u32::from_le_bytes(packet.get(pos..pos + 4)?.try_into().ok()?);
    pos += 4;
    let count = read_varint(packet, pos);
    if count.length <= 0 || !(1..=64).contains(&count.value) {
        return None;
    }
    pos += count.length as usize;
    let u64_at = |p: usize| packet.get(p..p + 8).map(|b| u64::from_le_bytes(b.try_into().unwrap()));
    let mut out = Vec::with_capacity(count.value as usize);
    for _ in 0..count.value {
        let alive = match *packet.get(pos)? { 0 => false, 1 => true, _ => return None };
        let id = read_varint(packet, pos + 1);
        if id.length <= 0 || id.value <= 0 {
            return None;
        }
        pos += 1 + id.length as usize + if alive { 12 } else { 0 };
        // Some records, alive or dead, carry an extra byte before the time.
        // A shifted read is ~256 times too large, so the first plausible
        // time within reach is the right one.
        pos += (0..3).find(|d| u64_at(pos + d).is_some_and(plausible_ms))?;
        let at = u64_at(pos)?;
        pos += 8;
        out.push(MapBoss { spawn_id: id.value, alive, at_ms: at as i64 });
    }
    Some((map, out))
}

/// The map showed a boss alive this recently, then dead: it died in
/// between, close enough to learn its respawn interval.
const DEATH_WINDOW_MS: i64 = 15 * 60_000;

/// What the map says about one boss. `alive_checked`: when the map last
/// showed it alive (this session). Returns whether anything changed.
fn apply_map(t: &mut BossTimer, m: &MapBoss, now: i64, alive_checked: Option<i64>) -> bool {
    let before = t.clone();
    // Alive on the map a little while ago, dead now with a new spawn time:
    // it died in between. Take the middle as the kill and learn the interval
    // from it, unless a real kill was seen.
    let died_unseen = !m.alive
        && t.respawn_at != Some(m.at_ms)
        && t.killed_at.is_none_or(|k| now - k > DEATH_WINDOW_MS)
        && alive_checked.is_some_and(|a| now - a <= DEATH_WINDOW_MS);
    if let (true, Some(alive)) = (died_unseen, alive_checked) {
        t.killed_at = Some((alive + now) / 2);
    }
    // Only a kill nobody has seen it respawn from yet belongs to this spawn.
    let fresh_kill = t.killed_at.filter(|k| {
        now - k < LEARN_WITHIN_MS && m.at_ms > *k && t.seen_at.is_none_or(|s| s < *k)
    });
    if let Some(killed) = fresh_kill {
        t.interval_min = Some(((m.at_ms - killed) as f64 / 60_000.0).round() as u32);
    }
    if m.alive {
        if t.killed_at.is_some_and(|k| k > m.at_ms) {
            t.killed_at = None;
        }
        t.seen_at = Some(t.seen_at.map_or(m.at_ms, |s| s.max(m.at_ms)));
        t.respawn_at = None;
    } else {
        // Dead: whatever we saw of it is from before this death.
        if t.seen_at.is_some_and(|s| t.killed_at.is_none_or(|k| s > k)) {
            t.seen_at = None;
        }
        t.respawn_at = Some(m.at_ms);
    }
    if *t == before {
        return false;
    }
    t.by.clear();
    t.updated = now;
    true
}

fn interval(t: &BossTimer) -> Option<u32> {
    t.interval_min.or_else(|| tracked().get(&t.code).copied().flatten())
}

fn apply_kill(t: &mut BossTimer, now: i64) -> bool {
    if t.killed_at.is_some_and(|k| now - k < SAME_KILL_MS) {
        return false;
    }
    t.killed_at = Some(now);
    t.respawn_at = interval(t).map(|m| now + m as i64 * 60_000);
    t.by.clear();
    t.updated = now;
    true
}

fn apply_seen(t: &mut BossTimer, now: i64) -> bool {
    let dead = t.killed_at.is_some_and(|k| t.seen_at.is_none_or(|s| s < k));
    if dead {
        if t.killed_at.is_some_and(|k| now - k < CORPSE_MS) || t.respawn_at.is_some_and(|r| now < r - 60_000) {
            return false;
        }
    } else if t.seen_at.is_some_and(|s| now - s < SEEN_EVERY_MS) {
        return false;
    }
    t.seen_at = Some(now);
    t.by.clear();
    t.updated = now;
    true
}

/// "Spawns in `ms`" as read off the in-game map.
fn apply_spawn_in(t: &mut BossTimer, now: i64, ms: i64) -> bool {
    let at = now + ms.clamp(0, 48 * 3_600_000);
    t.respawn_at = Some(at);
    if let Some(killed) = t.killed_at.filter(|k| now - k < LEARN_WITHIN_MS && at > *k) {
        t.interval_min = Some(((at - killed) as f64 / 60_000.0).round() as u32);
    }
    t.by.clear();
    t.updated = now;
    true
}

fn apply_clear(t: &mut BossTimer, now: i64) -> bool {
    t.killed_at = None;
    t.respawn_at = None;
    t.interval_min = None;
    t.by.clear();
    t.updated = now;
    true
}

/// Newer reports win; returns what changed here.
fn merge(timers: &mut HashMap<i32, BossTimer>, incoming: Vec<BossTimer>, now: i64) -> Vec<BossTimer> {
    let mut changed = Vec::new();
    for t in incoming {
        if !tracked().contains_key(&t.code) || t.updated > now + FUTURE_SLACK_MS {
            continue;
        }
        if timers.get(&t.code).is_some_and(|local| local.updated >= t.updated) {
            continue;
        }
        timers.insert(t.code, t.clone());
        changed.push(t);
    }
    changed
}

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
/// Mob code -> when the map last showed it alive. Not persisted: only a
/// death between two looks at the map in one session teaches anything.
static ALIVE_CHECKED: std::sync::LazyLock<Mutex<HashMap<i32, i64>>> = std::sync::LazyLock::new(Default::default);
static TIMERS: Mutex<Option<HashMap<i32, BossTimer>>> = Mutex::new(None);

fn with_timers<R>(app: &tauri::AppHandle, f: impl FnOnce(&mut HashMap<i32, BossTimer>) -> R) -> R {
    let mut guard = TIMERS.lock().unwrap_or_else(|e| e.into_inner());
    let timers = guard.get_or_insert_with(|| {
        app.state::<AppState>().settings.get(KEY)
            .and_then(|v| serde_json::from_str::<Vec<BossTimer>>(&v).ok())
            .unwrap_or_default().into_iter()
            .filter(|t| tracked().contains_key(&t.code))
            .map(|t| (t.code, t)).collect()
    });
    f(timers)
}

fn publish(app: &tauri::AppHandle, origin: &str, changed: Vec<BossTimer>) {
    if changed.is_empty() {
        return;
    }
    let all: Vec<BossTimer> = with_timers(app, |t| t.values().cloned().collect());
    if let Ok(json) = serde_json::to_string(&all) {
        app.state::<AppState>().settings.set(KEY, &json);
    }
    let _ = app.emit(EVENT, Update { origin, timers: changed });
}

fn change(app: &tauri::AppHandle, code: i32, f: impl FnOnce(&mut BossTimer, i64) -> bool) {
    let now = crate::clock::now_ms();
    let changed = with_timers(app, |timers| {
        let t = timers.entry(code).or_insert_with(|| BossTimer { code, ..Default::default() });
        f(t, now).then(|| t.clone())
    });
    publish(app, "local", changed.into_iter().collect());
}

/// `MOB_LIFE_HOOK`: runs on the capture thread for every mob spawn and death.
fn on_mob(code: i32, died: bool) {
    if !tracked().contains_key(&code) {
        return;
    }
    let Some(app) = APP.get() else { return };
    tracing::info!("Field boss {code} {}", if died { "killed" } else { "seen" });
    change(app, code, if died { apply_kill } else { apply_seen });
}

/// `FORK_PACKET_HOOK`: every decoded packet, so bail out fast.
pub(super) fn on_packet(packet: &[u8]) {
    // Opcode right after a 1-3 byte length varint.
    if packet.len() < 20 || !packet[1..5].windows(2).any(|w| w == [0x01, 0x91]) {
        return;
    }
    let Some((map, bosses)) = parse_map_bosses(packet) else { return };
    let Some(app) = APP.get() else { return };
    let now = crate::clock::now_ms();
    log_map(map, &bosses, now);
    let changed: Vec<BossTimer> = with_timers(app, |timers| {
        bosses.iter().filter_map(|m| {
            let code = *spawn_ids().get(&m.spawn_id)?;
            let t = timers.entry(code).or_insert_with(|| BossTimer { code, ..Default::default() });
            let mut checked = ALIVE_CHECKED.lock().unwrap_or_else(|e| e.into_inner());
            let alive_checked = checked.get(&code).copied();
            if m.alive {
                checked.insert(code, now);
            }
            apply_map(t, m, now, alive_checked).then(|| t.clone())
        }).collect()
    });
    if !changed.is_empty() {
        tracing::info!("Field boss map {map}: {} timers updated", changed.len());
    }
    publish(app, "local", changed);
}

/// Every boss of an opened map into meter.log, once a minute per map: which
/// spawn id is which boss is matched against the map's countdowns by hand.
fn log_map(map: u32, bosses: &[MapBoss], now: i64) {
    static LOGGED: Mutex<Option<HashMap<u32, i64>>> = Mutex::new(None);
    {
        let mut logged = LOGGED.lock().unwrap_or_else(|e| e.into_inner());
        let last = logged.get_or_insert_with(HashMap::new).entry(map).or_insert(0);
        if now - *last < 60_000 {
            return;
        }
        *last = now;
    }
    let local = |ms: i64| chrono::DateTime::from_timestamp_millis(ms)
        .map(|t| t.with_timezone(&chrono::Local).format("%a %H:%M:%S").to_string())
        .unwrap_or_default();
    tracing::info!("Field boss map {map}: {} bosses", bosses.len());
    for b in bosses {
        tracing::info!("  spawn {}{}{} {}", b.spawn_id,
            spawn_ids().get(&b.spawn_id).map(|c| format!(" (mob {c})")).unwrap_or_default(),
            if b.alive { " lebt seit" } else { " spawnt" }, local(b.at_ms));
    }
}

pub fn start(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    let _ = crate::combat::data_storage::MOB_LIFE_HOOK.set(on_mob);
}

#[tauri::command]
pub fn get_field_bosses(app: tauri::AppHandle) -> Vec<BossTimer> {
    with_timers(&app, |t| t.values().cloned().collect())
}

/// From the timer window: `kill` (now), `spawnIn` (ms from now) or `clear`.
#[tauri::command]
pub fn set_field_boss(app: tauri::AppHandle, code: i32, action: String, ms: Option<i64>) -> Result<(), String> {
    if !tracked().contains_key(&code) {
        return Err(format!("{code} is not a tracked field boss"));
    }
    match action.as_str() {
        "kill" => change(&app, code, |t, now| { t.killed_at = None; apply_kill(t, now) }),
        "spawnIn" => change(&app, code, |t, now| apply_spawn_in(t, now, ms.unwrap_or(0))),
        "clear" => change(&app, code, apply_clear),
        _ => return Err(format!("unknown action {action}")),
    }
    Ok(())
}

/// Timers the group's room sent (cloud.js).
#[tauri::command]
pub fn merge_field_bosses(app: tauri::AppHandle, timers: Vec<BossTimer>) {
    let now = crate::clock::now_ms();
    let changed = with_timers(&app, |local| merge(local, timers, now));
    publish(&app, "cloud", changed);
}

#[cfg(test)]
mod tests {
    use super::*;

    const GARTUA: i32 = 2400800;
    const MIN: i64 = 60_000;

    #[test]
    fn events_json_lists_the_field_bosses() {
        assert!(tracked().contains_key(&GARTUA));
        assert!(tracked().len() >= 8);
        // Scheduled events never count as field bosses.
        assert!(parse_tracked(r#"{"events":[{"mobCodes":[1]},{"kind":"respawn","mobCodes":[2],"respawnMinutes":90}]}"#)
            == HashMap::from([(2, Some(90))]));
    }

    #[test]
    fn a_kill_then_the_map_countdown_teaches_the_interval() {
        let mut t = BossTimer { code: GARTUA, ..Default::default() };
        assert!(apply_kill(&mut t, 1_000 * MIN));
        assert_eq!(t.respawn_at, None);
        assert!(!apply_kill(&mut t, 1_001 * MIN), "same kill after a combat reset");
        apply_spawn_in(&mut t, 1_010 * MIN, 110 * MIN + 20_000);
        assert_eq!(t.interval_min, Some(120));
        assert!(apply_kill(&mut t, 2_000 * MIN));
        assert_eq!(t.respawn_at, Some(2_120 * MIN), "next kill uses the learnt interval");
    }

    #[test]
    fn a_stale_kill_teaches_nothing() {
        let mut t = BossTimer { code: GARTUA, killed_at: Some(0), ..Default::default() };
        apply_spawn_in(&mut t, 13 * 60 * MIN, 5 * MIN);
        assert_eq!(t.interval_min, None);
        assert_eq!(t.respawn_at, Some(13 * 60 * MIN + 5 * MIN));
    }

    #[test]
    fn sightings_ignore_the_corpse_and_are_throttled() {
        let mut t = BossTimer { code: GARTUA, ..Default::default() };
        apply_kill(&mut t, 100 * MIN);
        assert!(!apply_seen(&mut t, 102 * MIN), "corpse");
        assert!(apply_seen(&mut t, 130 * MIN), "respawned");
        assert!(!apply_seen(&mut t, 132 * MIN), "throttled");
        assert!(apply_seen(&mut t, 136 * MIN));
        // With a known respawn, a sighting well before it is the corpse too.
        apply_kill(&mut t, 200 * MIN);
        t.respawn_at = Some(320 * MIN);
        assert!(!apply_seen(&mut t, 250 * MIN));
        assert!(apply_seen(&mut t, 319 * MIN + 30_000));
    }

    /// Altgard map, 03.10.2026 17:03:45 (CEST). The map showed Gartua in
    /// 10 h 5 min and Kashapa in 5 h 10 min at 17:05.
    const ALTGARD_MAP: &str = "E103019100005604000018019EE30600D004C7005A204700207E46A925B7A8FEA00100000099E30609515F02A1010000009AE306ABE96402A1010000019BE306544326C84E308AC600F4BC469CC0BCFEA001000000AAE30609BD6602A1010000019CE3061DBC2FC8D56A96C50002C5462342D3FEA001000000B0E306C5675E03A101000001A0E30600D8AE4600A28AC700C869469AFBD5FEA0010000019DE306DA1467C51152204700FC64460F4CE9EFFEA0010000019FE3069C2A94466B3F02C7001C3146A95BE7FEA001000001A1E30600A57447800A0DC800F0DB452B24CAFEA001000001A2E306000C7E47005230C80058BD459120FCFFA001000000ABE306B96A0C03A101000000A3E306F4A36F02A101000000A4E306E9F3D802A101000000A5E306F6E3D202A101000001A6E306AFE0F7471D71FB460040E4440145D5BBFEA001000000A7E306EF3ACD02A101000000A8E306EF303403A101000000A9E3069D10E002A101000000ACE306E2642903A101000000ADE306AC057704A101000000AEE30625F69804A101000000AFE306EC066903A10100000002E4B423EAC810004E4B4C00C0761648760AC1C7C1247E46B40104764702A1010000E2B423E8C810004C4B4C000F0AC64779719BC780AA4946B00103764702A1010000";

    fn unhex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn reads_the_altgard_map() {
        let (map, bosses) = parse_map_bosses(&unhex(ALTGARD_MAP)).unwrap();
        assert_eq!(map, 1110);
        assert_eq!(bosses.len(), 24);
        let mut ids: Vec<i32> = bosses.iter().map(|b| b.spawn_id).collect();
        ids.sort();
        assert_eq!(ids, (111001..=111024).collect::<Vec<_>>());
        let get = |id| *bosses.iter().find(|b| b.spawn_id == id).unwrap();
        // Gartua 04.10. 03:11:11, Kashapa 03.10. 22:16:17 (CEST).
        assert_eq!(get(111021), MapBoss { spawn_id: 111021, alive: false, at_ms: 1791076271532 });
        assert_eq!(get(111023), MapBoss { spawn_id: 111023, alive: false, at_ms: 1791058577132 });
        // Alive ones carry a position, some with an extra byte before the time.
        assert_eq!(get(111006), MapBoss { spawn_id: 111006, alive: true, at_ms: 1790978864933 });
        assert_eq!(get(111005).at_ms, 1790983530828);
        assert_eq!(bosses.iter().filter(|b| b.alive).count(), 9);
        assert_eq!(spawn_ids().get(&111021), Some(&GARTUA));
        assert!(parse_map_bosses(&unhex("0C0036157B4102A101000000")).is_none());
        // The quick filter in front of the parser lets it through.
        let p = unhex(ALTGARD_MAP);
        assert!(p[1..5].windows(2).any(|w| w == [0x01, 0x91]));
    }

    /// Altgard map, 21:29:52 the same day: a dead record with the extra byte.
    /// 111008 and 111011-111024 matched against a screenshot of the map.
    const ALTGARD_MAP_2: &str = "AB03019100005604000018019EE30600D004C7005A204700207E462FC98FFD02A10100000199E30691939BC7645092C700ECDD4600C6F102A1010000019AE306325C15C89ED7DCC700F90947C20DF702A1010000019BE306544326C84E308AC600F4BC4614D1F002A101000000AAE3069A2A8103A1010000019CE3061DBC2FC8D56A96C50002C5466791E502A101000000B0E306C5675E03A101000000A0E30663995703A1010000019DE306DA1467C51152204700FC64460D93B11603A1010000009FE306B9325103A101000001A1E30600A57447800A0DC800F0DB45FCD6C902A101000001A2E306000C7E47005230C80058BD4524D7F702A101000000ABE3060CC15C04A101000000A3E30604EA4103A101000000A4E3061592E803A101000000A5E3068DDDE203A101000000A6E3060C41F44603A101000000A7E3066EFBDB03A101000001A8E306B38D3048612DE54700EC5546EF303403A101000001A9E306E0D4D34713801D4800C8D1459D10E002A101000000ACE3061D2F7F04A101000000ADE306AC057704A101000000AEE30625F69804A101000000AFE306EC066903A10100000000";

    #[test]
    fn reads_dead_records_with_an_extra_byte() {
        let (map, bosses) = parse_map_bosses(&unhex(ALTGARD_MAP_2)).unwrap();
        assert_eq!((map, bosses.len()), (1110, 24));
        let at = |id| bosses.iter().find(|b| b.spawn_id == id).unwrap().at_ms / 1000;
        assert_eq!(at(111020), 1791076806, "Shylak, So 03:20:06");
        assert_eq!(at(111011), 1791056013, "Linx, Sa 21:33:33");
    }

    #[test]
    fn the_map_sets_and_teaches_respawns() {
        let mut t = BossTimer { code: GARTUA, ..Default::default() };
        let dead = MapBoss { spawn_id: 111021, alive: false, at_ms: 500 * MIN };
        assert!(apply_map(&mut t, &dead, 100 * MIN, None));
        assert_eq!((t.respawn_at, t.interval_min), (Some(500 * MIN), None));
        assert!(!apply_map(&mut t, &dead, 101 * MIN, None), "the map repeats every second");
        // Seen alive, then a kill we saw: the next map read teaches the interval.
        assert!(apply_map(&mut t, &MapBoss { alive: true, ..dead }, 501 * MIN, None));
        assert_eq!((t.seen_at, t.respawn_at), (Some(500 * MIN), None));
        apply_kill(&mut t, 600 * MIN);
        assert!(apply_map(&mut t, &MapBoss { at_ms: 1_200 * MIN, ..dead }, 601 * MIN, None));
        assert_eq!(t.interval_min, Some(600));
        assert!(t.seen_at < t.killed_at, "still dead");
        // Dead on the map though we last saw it alive: that sighting is stale.
        let mut u = BossTimer { code: GARTUA, seen_at: Some(50 * MIN), ..Default::default() };
        apply_map(&mut u, &dead, 100 * MIN, None);
        assert_eq!((u.seen_at, u.interval_min), (None, None));
    }

    /// Map open at 20:00 shows it alive, at 20:10 dead until 02:05: it died
    /// around 20:05, so the interval is about 6 h.
    #[test]
    fn a_death_between_two_looks_at_the_map_teaches_the_interval() {
        let mut t = BossTimer { code: GARTUA, ..Default::default() };
        let alive = MapBoss { spawn_id: 111021, alive: true, at_ms: 1_000 * MIN };
        apply_map(&mut t, &alive, 1_200 * MIN, None);
        let dead = MapBoss { alive: false, at_ms: 1_565 * MIN, ..alive };
        assert!(apply_map(&mut t, &dead, 1_210 * MIN, Some(1_200 * MIN)));
        assert_eq!(t.killed_at, Some(1_205 * MIN));
        assert_eq!(t.interval_min, Some(360));
        // Too long since the last look: nothing learnt.
        let mut u = BossTimer { code: GARTUA, ..Default::default() };
        apply_map(&mut u, &dead, 1_300 * MIN, Some(1_200 * MIN));
        assert_eq!((u.killed_at, u.interval_min), (None, None));
    }

    #[test]
    fn newer_reports_win() {
        let mut local = HashMap::from([(GARTUA, BossTimer { code: GARTUA, killed_at: Some(5), updated: 5, ..Default::default() })]);
        let old = BossTimer { code: GARTUA, killed_at: Some(1), updated: 1, by: "A".into(), ..Default::default() };
        let new = BossTimer { code: GARTUA, killed_at: Some(9), updated: 9, by: "B".into(), ..Default::default() };
        let foreign = BossTimer { code: 1, updated: 9, ..Default::default() };
        let future = BossTimer { code: GARTUA, updated: 100 * MIN, ..Default::default() };
        assert!(merge(&mut local, vec![old, foreign, future], 10).is_empty());
        assert_eq!(merge(&mut local, vec![new.clone()], 10), vec![new]);
        assert_eq!(local[&GARTUA].by, "B");
    }
}
