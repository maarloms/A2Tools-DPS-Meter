//! Fork: training-dummy benchmark ("Puppen-Test").
//!
//! The meter's own fight data is per target and resets on idle, so it cannot
//! give an exact window. While a test is armed, the parser hands every hit
//! to `on_damage` (`DAMAGE_HOOK` at the end of `data_storage::apply_damage`).
//! Only the local player's hits count (summons by their owner). The window is
//! packet time: from the first own hit to first hit + duration, end exclusive.
//! Hits are summed per target and skill; the UI (public/fork/dummy.js)
//! picks the target with the most damage (the dummy) and keeps the history.
//! Nothing leaves the machine.
//!
//! Lock order: storage, then recorder (the hook runs inside the storage
//! lock). Never touch the storage while holding the recorder.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::Manager;

use crate::app::AppState;
use crate::entity::damage_packet::ParsedDamagePacket;
use crate::entity::special_damage::SpecialDamage;

/// The window ends in packet time; hits stamped before the end may still be
/// in flight (and a dummy's DoT ticks are applied with the next direct hit).
pub const GRACE_MS: i64 = 1_500;
pub const DURATIONS_S: [u32; 3] = [60, 180, 300];

/// One hit as the recorder needs it.
#[derive(Debug, Clone, Copy, Default)]
pub struct Hit {
    /// The dealer after summon resolution (a spirit's hit is its owner's).
    pub owner: i32,
    pub target: i32,
    pub skill: i32,
    pub dot: bool,
    pub ts: i64,
    pub dmg: i64,
    pub crit: bool,
    pub multi: bool,
    pub back: bool,
    pub perfect: bool,
    pub double: bool,
}

impl Hit {
    fn from_packet(pdp: &ParsedDamagePacket, owner: i32) -> Self {
        let has = |s: SpecialDamage| pdp.specials().contains(&s);
        Hit {
            owner,
            target: pdp.target_id(),
            skill: pdp.skill_code(),
            dot: pdp.is_dot(),
            ts: pdp.timestamp(),
            dmg: pdp.total_damage() as i64,
            crit: pdp.is_crit(),
            multi: pdp.multi_hit_count() > 0,
            back: has(SpecialDamage::Back),
            perfect: has(SpecialDamage::Perfect),
            double: has(SpecialDamage::Double),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillAgg {
    pub code: i32,
    pub name: String,
    pub dot: bool,
    pub dmg: i64,
    pub hits: u32,
    pub crit: u32,
    pub multi: u32,
    pub back: u32,
    pub perfect: u32,
    pub double: u32,
    pub max: i64,
}

impl SkillAgg {
    fn add(&mut self, h: &Hit) {
        self.dmg += h.dmg;
        self.hits += 1;
        self.crit += h.crit as u32;
        self.multi += h.multi as u32;
        self.back += h.back as u32;
        self.perfect += h.perfect as u32;
        self.double += h.double as u32;
        self.max = self.max.max(h.dmg);
    }

    fn merge(&mut self, o: &SkillAgg) {
        self.dmg += o.dmg;
        self.hits += o.hits;
        self.crit += o.crit;
        self.multi += o.multi;
        self.back += o.back;
        self.perfect += o.perfect;
        self.double += o.double;
        self.max = self.max.max(o.max);
    }
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TargetAgg {
    pub target_id: i32,
    pub dmg: i64,
    pub hits: u32,
    pub skills: Vec<SkillAgg>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: Option<String>,
    pub server_id: u16,
    /// JobClass variant name ("Gladiator"), the UI translates it.
    pub class: Option<String>,
    pub level: Option<u32>,
    pub gear_score: Option<i32>,
    pub combat_power: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    /// The first hit's packet time; unique per run.
    pub id: i64,
    pub duration_ms: i64,
    pub start_ts: i64,
    pub end_ts: i64,
    /// Last own hit inside the window.
    pub last_hit_ts: i64,
    pub targets: Vec<TargetAgg>,
    pub profile: Profile,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// "idle", "armed", "running" or "done".
    pub phase: &'static str,
    pub duration_ms: i64,
    pub now: i64,
    pub start_ts: Option<i64>,
    pub end_ts: Option<i64>,
    /// Own damage so far, all targets.
    pub damage: i64,
    /// Whether the meter knows who you are (otherwise nothing is counted).
    pub has_local: bool,
    pub result: Option<RunResult>,
}

#[derive(Debug, Default)]
struct Run {
    duration_ms: i64,
    armed_at: i64,
    start: Option<i64>,
    last_hit: i64,
    damage: i64,
    targets: HashMap<i32, (i64, u32, HashMap<(i32, bool), SkillAgg>)>,
}

/// The test's state machine, free of Tauri so it can be tested.
#[derive(Debug, Default)]
pub struct Recorder {
    run: Option<Run>,
    result: Option<RunResult>,
}

impl Recorder {
    pub fn start(&mut self, duration_ms: i64, now: i64) {
        self.result = None;
        self.run = Some(Run { duration_ms, armed_at: now, ..Run::default() });
    }

    pub fn cancel(&mut self) {
        self.run = None;
        self.result = None;
    }

    pub fn active(&self) -> bool {
        self.run.is_some()
    }

    /// One hit from the parser. `local` is the meter's local player id.
    pub fn record(&mut self, hit: &Hit, local: Option<i64>) {
        let Some(run) = self.run.as_mut() else { return };
        if local != Some(hit.owner as i64) || hit.owner <= 0 || hit.dmg <= 0 {
            return;
        }
        let start = match run.start {
            Some(s) => s,
            None => {
                // A packet from before the test was armed does not start it.
                if hit.ts < run.armed_at {
                    return;
                }
                run.start = Some(hit.ts);
                hit.ts
            }
        };
        if hit.ts < start || hit.ts >= start + run.duration_ms {
            return;
        }
        run.damage += hit.dmg;
        run.last_hit = run.last_hit.max(hit.ts);
        let t = run.targets.entry(hit.target).or_default();
        t.0 += hit.dmg;
        t.1 += 1;
        t.2.entry((hit.skill, hit.dot))
            .or_insert_with(|| SkillAgg { code: hit.skill, dot: hit.dot, ..SkillAgg::default() })
            .add(hit);
    }

    /// Where the test stands at `now`; finishes it once the window and the
    /// grace time are over. `finish` names the skills and adds the profile.
    pub fn status(&mut self, now: i64, finish: impl FnOnce(&mut RunResult)) -> Status {
        let mut status = Status {
            phase: "idle",
            duration_ms: 0,
            now,
            start_ts: None,
            end_ts: None,
            damage: 0,
            has_local: false,
            result: None,
        };
        if let Some(run) = &self.run {
            status.duration_ms = run.duration_ms;
            status.damage = run.damage;
            match run.start {
                None => status.phase = "armed",
                Some(start) => {
                    let end = start + run.duration_ms;
                    status.start_ts = Some(start);
                    status.end_ts = Some(end);
                    status.phase = "running";
                    if now >= end + GRACE_MS {
                        let run = self.run.take().unwrap_or_default();
                        let mut result = into_result(run, start);
                        finish(&mut result);
                        self.result = Some(result);
                    }
                }
            }
        }
        if let Some(result) = &self.result {
            status.phase = "done";
            status.duration_ms = result.duration_ms;
            status.start_ts = Some(result.start_ts);
            status.end_ts = Some(result.end_ts);
            status.damage = result.targets.iter().map(|t| t.dmg).sum();
            status.result = Some(result.clone());
        }
        status
    }
}

fn into_result(run: Run, start: i64) -> RunResult {
    let mut targets: Vec<TargetAgg> = run.targets.into_iter().map(|(target_id, (dmg, hits, skills))| {
        let mut skills: Vec<SkillAgg> = skills.into_values().collect();
        skills.sort_by(|a, b| b.dmg.cmp(&a.dmg).then(a.code.cmp(&b.code)));
        TargetAgg { target_id, dmg, hits, skills }
    }).collect();
    targets.sort_by(|a, b| b.dmg.cmp(&a.dmg).then(a.target_id.cmp(&b.target_id)));
    RunResult {
        id: start,
        duration_ms: run.duration_ms,
        start_ts: start,
        end_ts: start + run.duration_ms,
        last_hit_ts: run.last_hit,
        targets,
        profile: Profile::default(),
    }
}

/// Skill codes and names as Details shows them: a variant whose name equals
/// its base skill's is filed under the base (dps_calculator does the same),
/// DoTs get " - DOT".
pub fn name_skills(result: &mut RunResult, name_of: impl Fn(i32) -> String, lookup: impl Fn(i32) -> String) {
    for target in &mut result.targets {
        let mut merged: Vec<SkillAgg> = Vec::new();
        for skill in target.skills.drain(..) {
            let raw = skill.code;
            let base = raw - (raw % 10000);
            let base_name = name_of(base);
            let code = if !base_name.is_empty() {
                let raw_name = name_of(raw);
                if raw_name.is_empty() || raw_name == base_name { base } else { raw }
            } else {
                raw
            };
            if let Some(m) = merged.iter_mut().find(|m| m.code == code && m.dot == skill.dot) {
                m.merge(&skill);
            } else {
                let mut name = lookup(code);
                if name.is_empty() {
                    name = format!("#{code}");
                }
                if skill.dot {
                    name = format!("{name} - DOT");
                }
                merged.push(SkillAgg { code, name, ..skill });
            }
        }
        merged.sort_by(|a, b| b.dmg.cmp(&a.dmg).then(a.code.cmp(&b.code)));
        target.skills = merged;
    }
}

static ARMED: AtomicBool = AtomicBool::new(false);
static RECORDER: Mutex<Option<Recorder>> = Mutex::new(None);

fn with_recorder<R>(f: impl FnOnce(&mut Recorder) -> R) -> R {
    let mut guard = RECORDER.lock().unwrap_or_else(|e| e.into_inner());
    f(guard.get_or_insert_with(Recorder::default))
}

/// `DAMAGE_HOOK`: on the capture thread, inside the storage lock. Costs one
/// atomic load while no test runs.
fn on_damage(pdp: &ParsedDamagePacket, owner: i32, local: Option<i64>) {
    if !ARMED.load(Ordering::Relaxed) {
        return;
    }
    let hit = Hit::from_packet(pdp, owner);
    with_recorder(|r| r.record(&hit, local));
}

pub fn start_hook() {
    let _ = crate::combat::data_storage::DAMAGE_HOOK.set(on_damage);
}

#[tauri::command]
pub fn fork_dummy_start(duration_s: u32) -> Result<(), String> {
    if !DURATIONS_S.contains(&duration_s) {
        return Err(format!("Dauer {duration_s} s wird nicht unterstützt"));
    }
    with_recorder(|r| r.start(duration_s as i64 * 1000, crate::clock::now_ms()));
    ARMED.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn fork_dummy_cancel() {
    ARMED.store(false, Ordering::Relaxed);
    with_recorder(Recorder::cancel);
}

#[tauri::command]
pub async fn fork_dummy_status(app: tauri::AppHandle) -> Status {
    let state = app.state::<AppState>();
    // Read the storage before taking the recorder: the capture thread holds
    // the storage lock while it hands a hit to the recorder.
    let has_local = state.data_storage.local_player_id().is_some();
    let p = state.data_storage.local_profile();
    let profile = Profile {
        name: p.name,
        server_id: p.server_id,
        class: p.class.map(|c| format!("{c:?}")),
        level: p.level,
        gear_score: p.gear_score,
        combat_power: p.combat_power,
    };
    let lookup = state.skill_lookup.clone();
    let mut status = with_recorder(|r| {
        let status = r.status(crate::clock::now_ms(), |result| {
            name_skills(result, |c| lookup.get_skill_name(c), |c| lookup.lookup_skill_name(c));
            result.profile = profile;
        });
        if !r.active() {
            ARMED.store(false, Ordering::Relaxed);
        }
        status
    });
    status.has_local = has_local;
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: i32 = 7;

    fn hit(ts: i64, target: i32, skill: i32, dmg: i64) -> Hit {
        Hit { owner: ME, target, skill, ts, dmg, ..Hit::default() }
    }

    fn finish(r: &mut Recorder, now: i64) -> Status {
        r.status(now, |_| {})
    }

    #[test]
    fn the_window_runs_from_the_first_own_hit_for_the_duration_end_exclusive() {
        let mut r = Recorder::default();
        r.start(60_000, 1_000);
        assert_eq!(finish(&mut r, 1_500).phase, "armed");
        r.record(&hit(5_000, 1, 100, 10), Some(ME as i64));
        r.record(&hit(64_999, 1, 100, 20), Some(ME as i64));
        r.record(&hit(65_000, 1, 100, 1_000), Some(ME as i64)); // the end is out
        let s = finish(&mut r, 30_000);
        assert_eq!((s.phase, s.start_ts, s.end_ts, s.damage), ("running", Some(5_000), Some(65_000), 30));
        // Still running inside the grace time.
        assert_eq!(finish(&mut r, 65_000 + GRACE_MS - 1).phase, "running");
        let s = finish(&mut r, 65_000 + GRACE_MS);
        assert_eq!(s.phase, "done");
        let res = s.result.unwrap();
        assert_eq!((res.id, res.duration_ms, res.last_hit_ts), (5_000, 60_000, 64_999));
        assert_eq!(res.targets[0].dmg, 30);
        assert!(!r.active());
    }

    #[test]
    fn only_the_local_players_hits_count_and_unknown_identity_counts_nothing() {
        let mut r = Recorder::default();
        r.start(60_000, 0);
        r.record(&Hit { owner: 99, ..hit(10, 1, 100, 500) }, Some(ME as i64));
        r.record(&hit(20, 1, 100, 500), None);
        assert_eq!(finish(&mut r, 30).phase, "armed");
        r.record(&hit(40, 1, 100, 5), Some(ME as i64));
        let s = finish(&mut r, 50);
        assert_eq!((s.start_ts, s.damage), (Some(40), 5));
    }

    #[test]
    fn a_hit_stamped_before_arming_does_not_start_the_test() {
        let mut r = Recorder::default();
        r.start(60_000, 10_000);
        r.record(&hit(9_999, 1, 100, 50), Some(ME as i64));
        assert_eq!(finish(&mut r, 10_001).phase, "armed");
    }

    #[test]
    fn hits_are_summed_per_target_and_skill_with_their_flags() {
        let mut r = Recorder::default();
        r.start(60_000, 0);
        let me = Some(ME as i64);
        r.record(&Hit { crit: true, multi: true, ..hit(1, 1, 100, 30) }, me);
        r.record(&Hit { back: true, ..hit(2, 1, 100, 10) }, me);
        r.record(&Hit { dot: true, ..hit(3, 1, 100, 5) }, me);
        r.record(&hit(4, 2, 200, 100), me); // the other target has more
        r.record(&hit(5, 1, 0, 0), me); // no damage: ignored
        let res = finish(&mut r, 60_001 + GRACE_MS).result.unwrap();
        assert_eq!(res.targets.iter().map(|t| (t.target_id, t.dmg, t.hits)).collect::<Vec<_>>(), vec![(2, 100, 1), (1, 45, 3)]);
        let s = &res.targets[1].skills;
        assert_eq!(s.len(), 2);
        assert_eq!((s[0].code, s[0].dot, s[0].dmg, s[0].hits, s[0].crit, s[0].multi, s[0].back, s[0].max), (100, false, 40, 2, 1, 1, 1, 30));
        assert_eq!((s[1].dot, s[1].dmg), (true, 5));
    }

    #[test]
    fn cancel_and_restart_drop_the_old_run_and_result() {
        let mut r = Recorder::default();
        r.start(60_000, 0);
        r.record(&hit(1, 1, 100, 30), Some(ME as i64));
        assert_eq!(finish(&mut r, 70_000).phase, "done");
        r.start(180_000, 80_000);
        let s = finish(&mut r, 80_001);
        assert_eq!((s.phase, s.duration_ms, s.result.is_none()), ("armed", 180_000, true));
        r.cancel();
        assert_eq!(finish(&mut r, 80_002).phase, "idle");
    }

    #[test]
    fn skill_variants_named_like_their_base_merge_under_it() {
        let mut res = RunResult {
            id: 0, duration_ms: 0, start_ts: 0, end_ts: 0, last_hit_ts: 0, profile: Profile::default(),
            targets: vec![TargetAgg { target_id: 1, dmg: 0, hits: 0, skills: vec![
                SkillAgg { code: 11_020_001, dmg: 10, hits: 1, max: 10, ..SkillAgg::default() },
                SkillAgg { code: 11_020_002, dmg: 30, hits: 2, max: 20, ..SkillAgg::default() },
                SkillAgg { code: 11_020_003, dmg: 5, hits: 1, ..SkillAgg::default() },
                SkillAgg { code: 11_020_001, dot: true, dmg: 1, hits: 1, ..SkillAgg::default() },
            ] }],
        };
        let names = |c: i32| match c {
            11_020_000 | 11_020_001 | 11_020_002 => "Schlag".to_string(),
            11_020_003 => "Schlag II".to_string(),
            _ => String::new(),
        };
        name_skills(&mut res, names, names);
        let s = &res.targets[0].skills;
        assert_eq!(s.iter().map(|k| (k.code, k.name.as_str(), k.dmg, k.hits)).collect::<Vec<_>>(), vec![
            (11_020_000, "Schlag", 40, 3),
            (11_020_003, "Schlag II", 5, 1),
            (11_020_000, "Schlag - DOT", 1, 1),
        ]);
        assert_eq!(s[0].max, 20);
    }

    #[test]
    fn the_status_serializes_in_camel_case() {
        let mut r = Recorder::default();
        r.start(60_000, 0);
        let json = serde_json::to_string(&finish(&mut r, 1)).unwrap();
        assert!(json.contains(r#""phase":"armed""#) && json.contains(r#""durationMs":60000"#) && json.contains(r#""hasLocal":false"#));
    }
}
