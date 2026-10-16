//! A2Tools features that talk to a2tools.app on their own and that upstream
//! ships switched on: in the fork they start off and are switched on in
//! Settings → Advanced.
//!
//! - `dpsMeter.shareBossTimers` (boss_report.rs): sends the field bosses of
//!   every opened map, field boss kills and boss HP to a2tools.app. The fork's
//!   event timer has its own field boss timers (fork/bosses.rs) and needs none
//!   of it.
//! - `dpsMeter.partyPresence` (party_presence.rs): registers the own
//!   character (hashed) and asks which party members use A2Tools, for the
//!   small A2 tag; it also tells them that you use a meter.
//!
//! Upstream's loops treat a missing value as on (`!= "false"`), so a missing
//! value is written as "false" once, before they start. A value the user set
//! stays as it is.

use crate::config::settings::Settings;

/// The keys, with upstream's names (boss_report::SETTING_KEY,
/// party_presence::SETTING_KEY).
pub const OFF_BY_DEFAULT: [&str; 2] = ["dpsMeter.shareBossTimers", "dpsMeter.partyPresence"];

/// Writes "false" for every key of `OFF_BY_DEFAULT` that has no value yet.
pub fn seed_off_by_default(settings: &Settings) {
    for key in OFF_BY_DEFAULT {
        if settings.get(key).is_none() {
            settings.set(key, "false");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(name: &str) -> (Settings, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("a2t-fork-privacy-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (Settings::new(dir.clone()), dir)
    }

    #[test]
    fn the_keys_are_upstreams() {
        #[cfg(feature = "online")]
        assert_eq!(OFF_BY_DEFAULT, [crate::boss_report::SETTING_KEY, crate::party_presence::SETTING_KEY]);
    }

    #[test]
    fn a_missing_value_is_off_and_a_chosen_one_stays() {
        let (s, dir) = settings("seed");
        s.set("dpsMeter.partyPresence", "true");
        seed_off_by_default(&s);
        assert_eq!(s.get("dpsMeter.shareBossTimers").as_deref(), Some("false"));
        assert_eq!(s.get("dpsMeter.partyPresence").as_deref(), Some("true"));
        // A second start changes nothing.
        s.set("dpsMeter.shareBossTimers", "true");
        seed_off_by_default(&s);
        assert_eq!(s.get("dpsMeter.shareBossTimers").as_deref(), Some("true"));
        let _ = s.flush();
        let _ = std::fs::remove_dir_all(dir);
    }
}
