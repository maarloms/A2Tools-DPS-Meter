//! Your own gear score and combat power, as the character sheet shows them.
//!
//! The party roster carries both, but only when the party changes, so the
//! numbers on uploaded fights were often hours old (2026-10-03: roster 1496,
//! sheet 1560). The game tells you about your own gear directly:
//!
//! - `1d 56` when your gear changes: `<u32 gear score> <u32 highest gear score>`
//!   (22:20:56, rings swapped: 1547 / 1560).
//! - `56 36` when your combat power changes: `<u64 combat power> <u64 same>`
//!   (74331, the sheet's "74,33K").
//! - The self record (`33 36`) on every zone load: the gear scores right
//!   after your name and level, the combat power as the one pair of equal
//!   u64 values in it (80 bytes before the end in both captures).

use crate::capture::stream_processor::read_varint;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Gear {
    pub gear_score: Option<i32>,
    pub gear_score_max: Option<i32>,
    pub combat_power: Option<i64>,
}

fn u32_at(p: &[u8], at: usize) -> Option<u32> {
    p.get(at..at + 4).map(|b| u32::from_le_bytes(b.try_into().unwrap()))
}

fn u64_at(p: &[u8], at: usize) -> Option<u64> {
    p.get(at..at + 8).map(|b| u64::from_le_bytes(b.try_into().unwrap()))
}

const GS: std::ops::RangeInclusive<u32> = 100..=100_000;
const CP: std::ops::RangeInclusive<u64> = 1_000..=100_000_000;

/// Gear from one decoded packet, if it is one of the three above. `name`:
/// your character name, to find the self record's fields.
pub fn parse(packet: &[u8], name: Option<&str>) -> Option<Gear> {
    let len = read_varint(packet, 0);
    let o = usize::try_from(len.length).ok().filter(|l| *l > 0)?;
    match packet.get(o..o + 2)? {
        [0x1d, 0x56] => {
            let (gs, max) = (u32_at(packet, o + 2)?, u32_at(packet, o + 6)?);
            (GS.contains(&gs) && GS.contains(&max) && gs <= max).then_some(Gear {
                gear_score: Some(gs as i32),
                gear_score_max: Some(max as i32),
                combat_power: None,
            })
        }
        [0x56, 0x36] => {
            let cp = u64_at(packet, o + 2)?;
            CP.contains(&cp).then_some(Gear { combat_power: Some(cp as i64), ..Default::default() })
        }
        [0x33, 0x36] => parse_self_record(packet, name?),
        _ => None,
    }
}

fn parse_self_record(packet: &[u8], name: &str) -> Option<Gear> {
    let name = name.trim().as_bytes();
    if name.is_empty() {
        return None;
    }
    // `<len u8> <name>`, then `fd 08 | u32 | u8 | u32 level | u32 gs | u32 max | u32 level`.
    let at = packet.windows(name.len() + 1).position(|w| w[0] as usize == name.len() && &w[1..] == name)?;
    let tail = at + 1 + name.len();
    let (level, gs, max, level2) = (u32_at(packet, tail + 7)?, u32_at(packet, tail + 11)?, u32_at(packet, tail + 15)?, u32_at(packet, tail + 19)?);
    let gear_ok = level == level2 && (1..=200).contains(&level) && GS.contains(&gs) && GS.contains(&max) && gs <= max;
    // The pair of equal u64 values. Zeros around it also match one byte
    // early (the value times 256); the smallest is the real one, and two
    // different values that are not such shifts mean we cannot tell.
    let mut pairs: Vec<u64> = (tail..packet.len().saturating_sub(15))
        .filter_map(|k| {
            let (a, b) = (u64_at(packet, k)?, u64_at(packet, k + 8)?);
            (a == b && CP.contains(&a)).then_some(a)
        })
        .collect();
    pairs.sort_unstable();
    pairs.dedup();
    let shifts_of_first = pairs.iter().all(|v| pairs.first().is_some_and(|f| {
        let mut x = *f;
        while x < *v {
            x <<= 8;
        }
        x == *v
    }));
    if !shifts_of_first {
        pairs.clear();
    }
    let gear = Gear {
        gear_score: gear_ok.then_some(gs as i32),
        gear_score_max: gear_ok.then_some(max as i32),
        combat_power: pairs.first().map(|v| *v as i64),
    };
    (gear != Gear::default()).then_some(gear)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unhex(s: &str) -> Vec<u8> {
        let s: String = s.chars().filter(|c| !c.is_whitespace()).collect();
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn gear_and_combat_power_updates() {
        // 22:20:56 on 2026-10-03, rings swapped; the sheet then showed 1547 and 74,33K.
        let gs = parse(&unhex("0e 1d 56 0b 06 00 00 18 06 00 00"), None).unwrap();
        assert_eq!((gs.gear_score, gs.gear_score_max, gs.combat_power), (Some(1547), Some(1560), None));
        let cp = parse(&unhex("10 56 36 5b 22 01 00 00 00 00 00 5b 22 01 00 00 00 00 00"), None).unwrap();
        assert_eq!(cp.combat_power, Some(74331));
        assert_eq!(parse(&unhex("0e 1d 37 0b 06 00 00 18 06 00 00"), None), None);
    }

    #[test]
    fn the_self_record_has_both() {
        // Shortened: the record's head, then zeros, then the combat power pair.
        let mut p = unhex(
            "33 36 d4 73 5e 81 c1 28 37 07 6d 61 72 6c 6f 6d 73
             fd 08 07 00 00 00 02 2d 00 00 00 0b 06 00 00 18 06 00 00 2d 00 00 00",
        );
        p.extend(std::iter::repeat_n(0u8, 40));
        p.extend(unhex("5b 22 01 00 00 00 00 00 5b 22 01 00 00 00 00 00 05 01 3c 01"));
        let mut packet = vec![0x80 | (p.len() as u8 & 0x7f), (p.len() >> 7) as u8];
        packet.extend(p);
        let g = parse(&packet, Some("marloms")).unwrap();
        assert_eq!((g.gear_score, g.gear_score_max, g.combat_power), (Some(1547), Some(1560), Some(74331)));
        assert_eq!(parse(&packet, Some("someone")), None);
    }
}
