//! What the stream overlay shows: the meter's rows, cut down to what a viewer
//! sees on the meter itself.
//!
//! Built from the same `DpsData` the meter window renders (`get_dps_snapshot`),
//! and shaped the way `core.js` / `meter.js` shape it: rows without an id are
//! dropped, duplicate names collapse to the best-known row, the list is the
//! top N by DPS plus the local player, and a row's share is of the damage the
//! displayed rows did. Nothing else from `DpsData` leaves the machine.

use serde::Serialize;

use crate::entity::dps_data::DpsData;
use crate::entity::job_class::JobClass;

/// The overlay's view of the meter, sent to OBS as JSON.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OverlaySnapshot {
    /// Shape version, so a page left open across an update can tell.
    pub v: u8,
    /// Boss or target name, as the meter's header shows it ("" for none).
    pub target: String,
    /// The meter's target mode (`bossTargets`, `allTargets`, `trainTargets`).
    pub mode: String,
    /// Fight length so far, in milliseconds.
    #[serde(rename = "timeMs")]
    pub time_ms: i64,
    /// Target HP left, in percent, when a single boss with known HP is tracked.
    pub hp: Option<f64>,
    pub rows: Vec<OverlayRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OverlayRow {
    pub name: String,
    /// Class key (`gladiator`, `cleric`, …) for the colour and icon; `None`
    /// while the class is not known yet.
    pub cls: Option<&'static str>,
    pub dps: i64,
    /// Total damage.
    pub dmg: i64,
    /// Share of the displayed rows' damage, in percent, one decimal.
    pub pct: f64,
    /// The local player.
    pub you: bool,
}

/// The meter settings the overlay follows, so it lists who the meter lists.
#[derive(Debug, Clone, Copy)]
pub struct ViewOptions {
    /// `dpsMeter.playerLimit`.
    pub limit: usize,
    /// `dpsMeter.pinMeToTop`.
    pub pin_you: bool,
}

impl Default for ViewOptions {
    fn default() -> Self {
        Self { limit: 6, pin_you: false }
    }
}

impl ViewOptions {
    pub fn from_settings(get: impl Fn(&str) -> Option<String>) -> Self {
        let limit = get("dpsMeter.playerLimit")
            .and_then(|v| v.trim().parse::<usize>().ok())
            .filter(|&n| n >= 1)
            .unwrap_or(6);
        let pin_you = get("dpsMeter.pinMeToTop").as_deref() == Some("true");
        Self { limit, pin_you }
    }
}

const ALL_CLASSES: [JobClass; 9] = [
    JobClass::Gladiator,
    JobClass::Templar,
    JobClass::Ranger,
    JobClass::Assassin,
    JobClass::Sorcerer,
    JobClass::Cleric,
    JobClass::Elementalist,
    JobClass::Chanter,
    JobClass::Fighter,
];

/// Class key as the overlay page and its icon route name it. The same keys
/// as the Discord activity's art.
pub fn class_key(class: JobClass) -> &'static str {
    match class {
        JobClass::Gladiator => "gladiator",
        JobClass::Templar => "templar",
        JobClass::Ranger => "ranger",
        JobClass::Assassin => "assassin",
        JobClass::Sorcerer => "sorcerer",
        JobClass::Cleric => "cleric",
        JobClass::Elementalist => "spiritmaster",
        JobClass::Chanter => "chanter",
        JobClass::Fighter => "brawler",
    }
}

/// A row's `job` is the Korean class name (`JobClass::class_name`), or
/// "Unknown"/"" before it is known.
fn class_of_job(job: &str) -> Option<JobClass> {
    let job = job.trim();
    ALL_CLASSES.into_iter().find(|c| c.class_name() == job)
}

/// The class icon the meter itself shows, by class key.
pub fn class_icon(key: &str) -> Option<&'static [u8]> {
    Some(match key {
        "gladiator" => include_bytes!("../../../public/assets/검성.png"),
        "templar" => include_bytes!("../../../public/assets/수호성.png"),
        "ranger" => include_bytes!("../../../public/assets/궁성.png"),
        "assassin" => include_bytes!("../../../public/assets/살성.png"),
        "sorcerer" => include_bytes!("../../../public/assets/마도성.png"),
        "cleric" => include_bytes!("../../../public/assets/치유성.png"),
        "spiritmaster" => include_bytes!("../../../public/assets/정령성.png"),
        "chanter" => include_bytes!("../../../public/assets/호법성.png"),
        "brawler" => include_bytes!("../../../public/assets/권성.png"),
        _ => return None,
    })
}

struct Candidate {
    id: i32,
    name: String,
    identified: bool,
    class: Option<JobClass>,
    dps: i64,
    dmg: i64,
}

pub fn build(dps: &DpsData, opts: ViewOptions) -> OverlaySnapshot {
    // Rows as core.js builds them (`buildRowsFromMapObject`).
    let mut by_name: Vec<Candidate> = Vec::new();
    for (&id, row) in &dps.map {
        if id <= 0 || !row.dps.is_finite() {
            continue;
        }
        let id_text = id.to_string();
        let identified = !row.nickname.is_empty() && row.nickname != id_text;
        let name = if identified { row.nickname.clone() } else { format!("#{id}") };
        let next = Candidate {
            id,
            name,
            identified,
            class: class_of_job(&row.job),
            dps: row.dps.trunc() as i64,
            dmg: row.amount.trunc() as i64,
        };
        // One row per name: the one with a class, then a name, then the
        // newer id — the meter's dedupe.
        let score = |c: &Candidate| (c.class.is_some() as u8) * 2 + c.identified as u8;
        match by_name.iter_mut().find(|c| c.name == next.name) {
            None => by_name.push(next),
            Some(existing) => {
                let (old, new) = (score(existing), score(&next));
                if new > old || (new == old && next.id > existing.id) {
                    *existing = next;
                }
            }
        }
    }
    // Highest DPS first; ties by id so the order does not flicker.
    by_name.sort_by(|a, b| b.dps.cmp(&a.dps).then(a.id.cmp(&b.id)));

    let local = dps.local_player_id.and_then(|id| i32::try_from(id).ok());
    let is_you = |c: &Candidate| local.is_some_and(|id| id == c.id);

    // Training: the meter shows only the local player.
    if dps.target_mode == "trainTargets" && by_name.iter().any(&is_you) {
        by_name.retain(|c| is_you(c));
    }

    // Top N, plus the local player when outside it (`getDisplayRows`).
    let limit = opts.limit.max(1);
    let you_index = by_name.iter().position(&is_you);
    let mut shown: Vec<&Candidate> = by_name.iter().take(limit).collect();
    if let Some(i) = you_index {
        if i >= limit {
            shown.push(&by_name[i]);
        }
        if opts.pin_you {
            let pos = shown.iter().position(|c| is_you(c)).unwrap_or(0);
            let you = shown.remove(pos);
            shown.insert(0, you);
        }
    }

    let total: i64 = shown.iter().map(|c| c.dmg.max(0)).sum();
    let rows = shown
        .into_iter()
        .map(|c| OverlayRow {
            name: c.name.clone(),
            cls: c.class.map(class_key),
            dps: c.dps,
            dmg: c.dmg,
            pct: if total > 0 { round1(c.dmg.max(0) as f64 * 100.0 / total as f64) } else { 0.0 },
            you: is_you(c),
        })
        .collect();

    let hp = (dps.target_max_hp > 0).then(|| {
        let left = if dps.target_current_hp >= 0 {
            dps.target_current_hp
        } else {
            dps.target_max_hp - dps.target_total_damage
        };
        round1((left as f64 * 100.0 / dps.target_max_hp as f64).clamp(0.0, 100.0))
    });

    OverlaySnapshot {
        v: 1,
        target: dps.target_name.trim().to_string(),
        mode: dps.target_mode.clone(),
        time_ms: dps.battle_time.max(0),
        hp,
        rows,
    }
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::personal_data::PersonalData;

    fn row(nick: &str, job: &str, dps: f64, amount: f64) -> PersonalData {
        let mut p = PersonalData::with_job(nick.to_string(), job.to_string());
        p.dps = dps;
        p.amount = amount;
        p.combat_power = 123_456;
        p
    }

    fn sample() -> DpsData {
        let mut d = DpsData::new();
        d.target_name = " Urugugu ".into();
        d.battle_time = 65_000;
        d.target_max_hp = 1000;
        d.target_total_damage = 250;
        d.local_player_id = Some(3);
        d.map.insert(1, row("Alpha", "검성", 3000.0, 300_000.0));
        d.map.insert(2, row("Bravo", "치유성", 1000.0, 100_000.0));
        d.map.insert(3, row("Me", "Unknown", 2000.0, 200_000.0));
        d.map.insert(-5, row("Ghost", "검성", 9999.0, 1.0));
        d.map.insert(7, row("7", "", 10.0, 1000.0));
        d
    }

    #[test]
    fn the_snapshot_json_has_the_overlay_shape_and_nothing_else() {
        let snap = build(&sample(), ViewOptions::default());
        let json = serde_json::to_value(&snap).unwrap();
        let mut keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["hp", "mode", "rows", "target", "timeMs", "v"]);
        assert_eq!(json["target"], "Urugugu");
        assert_eq!(json["timeMs"], 65_000);
        assert_eq!(json["hp"], 75.0);
        let first = json["rows"][0].as_object().unwrap();
        let mut row_keys: Vec<_> = first.keys().cloned().collect();
        row_keys.sort();
        assert_eq!(row_keys, ["cls", "dmg", "dps", "name", "pct", "you"]);
        // Combat power and ids stay home.
        let text = json.to_string();
        assert!(!text.contains("123456"));
        assert!(!text.contains("combat"));
    }

    #[test]
    fn rows_are_ranked_named_and_shared_like_the_meter() {
        let snap = build(&sample(), ViewOptions::default());
        let names: Vec<_> = snap.rows.iter().map(|r| r.name.as_str()).collect();
        // The negative id is dropped; an unnamed row shows its id.
        assert_eq!(names, ["Alpha", "Me", "Bravo", "#7"]);
        assert_eq!(snap.rows[0].cls, Some("gladiator"));
        assert_eq!(snap.rows[1].cls, None);
        assert_eq!(snap.rows[2].cls, Some("cleric"));
        assert!(snap.rows[1].you && !snap.rows[0].you);
        let total: f64 = snap.rows.iter().map(|r| r.pct).sum();
        assert!((total - 100.0).abs() < 0.3, "{total}");
        assert_eq!(snap.rows[0].pct, 49.9);
    }

    #[test]
    fn the_player_limit_keeps_the_local_player_and_can_pin_them() {
        let snap = build(&sample(), ViewOptions { limit: 1, pin_you: false });
        let names: Vec<_> = snap.rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["Alpha", "Me"]);
        assert_eq!(snap.rows[0].pct, 60.0);

        let snap = build(&sample(), ViewOptions { limit: 6, pin_you: true });
        assert_eq!(snap.rows[0].name, "Me");
    }

    #[test]
    fn training_shows_only_the_local_player() {
        let mut d = sample();
        d.target_mode = "trainTargets".into();
        let snap = build(&d, ViewOptions::default());
        assert_eq!(snap.rows.len(), 1);
        assert!(snap.rows[0].you);
        assert_eq!(snap.rows[0].pct, 100.0);
    }

    #[test]
    fn duplicate_names_keep_the_row_with_a_class() {
        let mut d = DpsData::new();
        d.map.insert(10, row("Same", "", 5.0, 5.0));
        d.map.insert(4, row("Same", "궁성", 4.0, 4.0));
        let snap = build(&d, ViewOptions::default());
        assert_eq!(snap.rows.len(), 1);
        assert_eq!(snap.rows[0].cls, Some("ranger"));
        assert_eq!(snap.hp, None);
    }

    #[test]
    fn every_class_has_an_icon() {
        for class in ALL_CLASSES {
            let icon = class_icon(class_key(class)).unwrap();
            assert!(icon.starts_with(b"\x89PNG"), "{class:?}");
            assert_eq!(class_of_job(class.class_name()), Some(class));
        }
        assert!(class_icon("../secret").is_none());
    }
}
