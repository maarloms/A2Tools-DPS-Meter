//! fork: TARGET mode on the capture of 2026-10-03 17:20 (Altgard, marloms).
//!
//! Loot records named marloms as entity 114 while every hit came from 14701,
//! and after the 17:26 zone load from 10917. The meter bound 114 and showed
//! nothing until the UI rebound 14701 by name, back and forth. TARGET must
//! follow the hits all along. Path from A2_TARGET_CAPTURE; skips when unset.

use std::sync::Arc;

use a2tools_dps_meter_lib::capture::packet_accumulator::PacketAccumulator;
use a2tools_dps_meter_lib::capture::stream_processor::StreamProcessor;
use a2tools_dps_meter_lib::combat::data_storage::DataStorage;
use a2tools_dps_meter_lib::combat::dps_calculator::DpsCalculator;
use a2tools_dps_meter_lib::combat::ping_tracker::PingTracker;
use a2tools_dps_meter_lib::i18n::lookup::{NpcLookup, SkillLookup};

#[test]
fn target_follows_your_hits_through_loot_records_and_zone_loads() {
    let Ok(path) = std::env::var("A2_TARGET_CAPTURE") else { return };
    let storage = Arc::new(DataStorage::new());
    storage.set_local_character_name(Some("marloms".into()));
    let (skills, npcs) = (Arc::new(SkillLookup::new()), Arc::new(NpcLookup::new()));
    let mut processor = StreamProcessor::new(storage.clone(), skills.clone(), npcs.clone());
    let mut calc = DpsCalculator::new(storage.clone(), skills, npcs, Arc::new(PingTracker::new()));
    calc.set_target_selection_mode("lastHitByMe");
    let mut accs: std::collections::HashMap<String, PacketAccumulator> = Default::default();

    // A2_TARGET_WINDOW="HH:MM-HH:MM" for other captures; default fits 17:20.
    let window = std::env::var("A2_TARGET_WINDOW").unwrap_or_else(|_| "17:21-17:47".into());
    let (from, to) = window.split_once('-').map(|(a, b)| (a.to_string(), b.to_string())).expect("window");
    let text = std::fs::read_to_string(&path).expect("capture readable");
    let (mut checks, mut empty, mut last_minute) = (0, 0, String::new());
    for line in text.lines().filter(|l| !l.is_empty()) {
        let mut parts = line.splitn(3, '|');
        let (Some(ts), Some(stream), Some(hex)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let Some(bytes) = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok()).collect::<Option<Vec<u8>>>() else { continue };
        // Capture time as "now", so lulls and windows behave as they did live.
        if let Ok(t) = chrono::DateTime::parse_from_rfc3339(ts) {
            processor.set_override_timestamp(Some(t.timestamp_millis()));
        }
        let acc = accs.entry(stream.to_string()).or_insert_with(PacketAccumulator::new);
        acc.append(&bytes);
        let consumed = processor.consume_stream(acc.snapshot());
        if consumed > 0 {
            acc.discard_bytes(consumed);
        }
        // Once a minute while fighting (17:20-17:47): you must show up.
        let minute = ts.get(11..16).unwrap_or("").to_string();
        if minute != last_minute && (from.as_str()..to.as_str()).contains(&minute.as_str()) {
            last_minute = minute.clone();
            let ids = storage.local_name_ids();
            let dps = calc.get_dps();
            checks += 1;
            let names: Vec<String> = dps.map.iter().map(|(id, p)| format!("{id}={}", p.nickname)).collect();
            eprintln!("{minute}: {names:?}");
            if dps.map.is_empty() {
                empty += 1;
                eprintln!("{minute}: TARGET empty, local {:?}, name ids {ids:?}", storage.local_player_id());
            }
            assert!(!ids.contains(&114), "{minute}: the loot id became you");
        }
    }
    eprintln!("{checks} checks, {empty} empty");
    assert!(checks > 10);
    // Before the fix 17:21 was empty: bound to the loot record's 114.
    assert_eq!(empty, 0, "TARGET empty in {empty} of {checks} minutes");
}
