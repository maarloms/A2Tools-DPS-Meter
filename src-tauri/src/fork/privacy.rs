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
//! - `dpsMeter.shareSupplyRequests` (supply_report.rs, 2.0.76): sends the
//!   server's open Supply Requests boards to a2tools.app's Profiteer.
//!   Upstream already starts it off (it reads `== "true"`); the fork writes
//!   "false" too, so a later upstream default of on doesn't switch it on.
//!
//! Upstream's loops treat a missing value as on (`!= "false"`), so a missing
//! value is written as "false" once, before they start. A value the user set
//! stays as it is.

use crate::config::settings::Settings;

/// The keys, with upstream's names (boss_report::SETTING_KEY,
/// party_presence::SETTING_KEY, supply_report::SETTING_KEY).
pub const OFF_BY_DEFAULT: [&str; 3] = ["dpsMeter.shareBossTimers", "dpsMeter.partyPresence", "dpsMeter.shareSupplyRequests"];

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
        assert_eq!(OFF_BY_DEFAULT, [
            crate::boss_report::SETTING_KEY,
            crate::party_presence::SETTING_KEY,
            crate::supply_report::SETTING_KEY,
        ]);
    }

    #[test]
    fn a_missing_value_is_off_and_a_chosen_one_stays() {
        let (s, dir) = settings("seed");
        s.set("dpsMeter.partyPresence", "true");
        seed_off_by_default(&s);
        assert_eq!(s.get("dpsMeter.shareBossTimers").as_deref(), Some("false"));
        assert_eq!(s.get("dpsMeter.partyPresence").as_deref(), Some("true"));
        assert_eq!(s.get("dpsMeter.shareSupplyRequests").as_deref(), Some("false"));
        // A second start changes nothing.
        s.set("dpsMeter.shareBossTimers", "true");
        seed_off_by_default(&s);
        assert_eq!(s.get("dpsMeter.shareBossTimers").as_deref(), Some("true"));
        let _ = s.flush();
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Every report boss_report.rs sends (maps, kills, HP, the Abyss
    /// artifacts' holders and cores, 2.0.72/73) goes out only when
    /// `shareBossTimers` isn't "false" – and the fork seeds it "false". A new
    /// path or POST upstream adds fails here, to be checked before a release.
    #[test]
    #[cfg(feature = "online")]
    fn every_boss_timer_sender_is_behind_the_switch() {
        let src = include_str!("../boss_report.rs");
        let code = &src[..src.find("#[cfg(test)]").unwrap_or(src.len())];
        let mut paths: Vec<&str> = code
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .flat_map(|l| l.match_indices("/api/").map(move |(i, _)| { let rest = &l[i..]; &rest[..rest.find('"').unwrap_or(rest.len())] }))
            .collect();
        paths.sort();
        paths.dedup();
        assert_eq!(paths, [
            "/api/boss-timers/artifacts",
            "/api/boss-timers/cores",
            "/api/boss-timers/hp",
            "/api/boss-timers/kill",
            "/api/boss-timers/report",
        ]);
        // POSTs: HP + cores' HP, the orb killers, the kills, the maps, the
        // artifacts. Each of their loops reads the switch first.
        assert_eq!(code.matches(".http.post(").count(), 5);
        assert_eq!(code.matches(".http.get(").count(), 0);
        let gate_off = "state.settings.get(SETTING_KEY).as_deref() == Some(\"false\")";
        let gate_on = "state.settings.get(SETTING_KEY).as_deref() != Some(\"false\")";
        let body = |name: &str| {
            let start = code.find(name).unwrap();
            let end = code[start + 1..].find("
fn ").or(code[start + 1..].find("
pub fn ")).map_or(code.len(), |e| start + 1 + e);
            &code[start..end]
        };
        // HP/cores' HP, kills and orb killers (spawn_events).
        let events = body("fn spawn_events(");
        assert!(events.contains(gate_off) && events.contains(gate_on));
        assert!(events.find(gate_off).unwrap() < events.find("/api/boss-timers/hp").unwrap());
        // The artifacts and the orb kills their holders settle.
        let artifacts = body("async fn send_artifacts(");
        assert!(artifacts.find(gate_off).unwrap() < artifacts.find("send_orb_killers(").unwrap());
        // The maps.
        let maps = body("pub fn spawn(app");
        assert!(maps.find(gate_off).unwrap() < maps.find("/api/boss-timers/report").unwrap());
        // send_orb_killers itself is called only from those two places.
        assert_eq!(code.matches("send_orb_killers(&state, server, expired)").count(), 1);
        assert_eq!(code.matches("send_orb_killers(").count(), 3);
        // And the switch is the one the fork seeds off.
        let (s, dir) = settings("senders");
        seed_off_by_default(&s);
        assert_eq!(s.get(crate::boss_report::SETTING_KEY).as_deref(), Some("false"));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The Supply Requests boards (supply_report.rs, 2.0.76) go out only
    /// when `shareSupplyRequests` is "true" – and the fork seeds it "false".
    /// A new path, POST or GET upstream adds there, or a looser switch,
    /// fails here, to be checked before a release.
    #[test]
    #[cfg(feature = "online")]
    fn every_supply_sender_is_behind_the_switch() {
        let src = include_str!("../supply_report.rs");
        let code = &src[..src.find("#[cfg(test)]").unwrap_or(src.len())];
        let mut paths: Vec<&str> = code
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .flat_map(|l| l.match_indices("/api/").map(move |(i, _)| { let rest = &l[i..]; &rest[..rest.find('"').unwrap_or(rest.len())] }))
            .collect();
        paths.sort();
        paths.dedup();
        assert_eq!(paths, ["/api/profiteer/supply"]);
        assert_eq!(code.matches(".http.post(").count(), 1);
        assert_eq!(code.matches(".http.get(").count(), 0);
        assert_eq!(code.matches(".send()").count(), 1);
        // One loop, and it reads the switch before it builds or sends anything.
        let gate = "state.settings.get(SETTING_KEY).as_deref() != Some(\"true\")";
        let spawn = &code[code.find("pub fn spawn(app").unwrap()..];
        let at = spawn.find(gate).expect("the switch reads == \"true\"");
        assert!(at < spawn.find("report(server").unwrap());
        assert!(at < spawn.find("/api/profiteer/supply").unwrap());
        assert!(at < spawn.find(".send()").unwrap());
        // And the switch is the one the fork seeds off.
        let (s, dir) = settings("supply");
        seed_off_by_default(&s);
        assert_eq!(s.get(crate::supply_report::SETTING_KEY).as_deref(), Some("false"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
