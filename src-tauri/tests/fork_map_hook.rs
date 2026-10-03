//! fork: the field boss map packet reaches FORK_PACKET_HOOK when a capture
//! is fed through the stream processor. Path from A2_MAP_CAPTURE.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use a2tools_dps_meter_lib::capture::packet_accumulator::PacketAccumulator;
use a2tools_dps_meter_lib::capture::stream_processor::{StreamProcessor, FORK_PACKET_HOOK};
use a2tools_dps_meter_lib::combat::data_storage::DataStorage;
use a2tools_dps_meter_lib::i18n::lookup::{NpcLookup, SkillLookup};

static SEEN: AtomicUsize = AtomicUsize::new(0);
static ALL: AtomicUsize = AtomicUsize::new(0);

fn hook(p: &[u8]) {
    ALL.fetch_add(1, Ordering::Relaxed);
    if p.len() > 5 && p[1..5].windows(2).any(|w| w == [0x01, 0x91]) {
        SEEN.fetch_add(1, Ordering::Relaxed);
    }
}

#[test]
fn map_packets_reach_the_hook() {
    let Ok(path) = std::env::var("A2_MAP_CAPTURE") else { return };
    let _ = FORK_PACKET_HOOK.set(hook);
    let storage = Arc::new(DataStorage::new());
    let mut processor = StreamProcessor::new(storage, Arc::new(SkillLookup::new()), Arc::new(NpcLookup::new()));
    let mut accs: std::collections::HashMap<String, PacketAccumulator> = Default::default();
    for line in std::fs::read_to_string(&path).unwrap().lines().filter(|l| !l.is_empty() && !l.starts_with('#')) {
        let mut parts = line.splitn(3, '|');
        let (Some(_), Some(stream), Some(hex)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let Some(bytes) = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok()).collect::<Option<Vec<u8>>>() else { continue };
        let acc = accs.entry(stream.to_string()).or_insert_with(PacketAccumulator::new);
        acc.append(&bytes);
        let consumed = processor.consume_stream(acc.snapshot());
        if consumed > 0 {
            acc.discard_bytes(consumed);
        }
    }
    eprintln!("hook saw {} packets, {} map packets", ALL.load(Ordering::Relaxed), SEEN.load(Ordering::Relaxed));
    assert!(SEEN.load(Ordering::Relaxed) > 0);
}
