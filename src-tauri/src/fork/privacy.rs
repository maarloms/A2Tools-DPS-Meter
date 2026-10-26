//! A2Tools features that talk to a2tools.app on their own and that upstream
//! ships switched on: in the fork they start off and are switched on in
//! Settings.
//!
//! - `dpsMeter.shareData` (boss_report.rs `shares_data`, 2.0.78): "Sync
//!   useful data to A2Tools", one switch for the field bosses of every opened
//!   map, field boss kills, boss HP, the Abyss artifacts (boss_report.rs) and
//!   the server's Supply Requests boards (supply_report.rs). It replaced
//!   `dpsMeter.shareBossTimers` and `dpsMeter.shareSupplyRequests`; upstream
//!   falls back to those while it has no value. The fork writes "false"
//!   for it, so a player who had shared boss timers before starts off as well
//!   and turns the new switch on himself (Marlon, 26.10.2026). The fork's
//!   event timer has its own field boss timers (fork/bosses.rs).
//! - `dpsMeter.partyPresence` (party_presence.rs): registers the own
//!   character (hashed) and asks which party members use A2Tools, for the
//!   small A2 tag; it also tells them that you use a meter.
//! - `dpsMeter.guestUpload` (account/guest.rs, share/mod.rs, 2.0.79):
//!   "Upload boss fights without an account", public on a2tools.app.
//!   Upstream turns it on for a new install and asks once with its account
//!   card; the fork shows no such card, so a new install doesn't turn it on
//!   (app.rs, `// fork:`) and it is written "false" here.
//!
//! Upstream's loops treat a missing value as on (`!= "false"`), so a missing
//! value is written as "false" once, before they start. A value the user set
//! stays as it is.

use crate::config::settings::Settings;

/// The keys, with upstream's names (boss_report::SHARE_DATA_KEY,
/// party_presence::SETTING_KEY, account::guest::GUEST_UPLOAD_KEY).
pub const OFF_BY_DEFAULT: [&str; 3] = ["dpsMeter.shareData", "dpsMeter.partyPresence", "dpsMeter.guestUpload"];

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

    /// The code of a source file before its tests, with LF line ends.
    #[cfg(feature = "online")]
    fn code_of(src: &str) -> String {
        let src = src.replace("\r\n", "\n");
        src[..src.find("#[cfg(test)]").unwrap_or(src.len())].to_string()
    }

    /// The paths under /api/ a file names outside comments, sorted.
    #[cfg(feature = "online")]
    fn api_paths(code: &str) -> Vec<String> {
        let mut paths: Vec<String> = code
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .flat_map(|l| l.match_indices("/api/").map(move |(i, _)| { let rest = &l[i..]; rest[..rest.find('"').unwrap_or(rest.len())].to_string() }))
            .collect();
        paths.sort();
        paths.dedup();
        paths
    }

    /// A function's text, from `name` to the next top-level `fn`.
    #[cfg(feature = "online")]
    fn body<'a>(code: &'a str, name: &str) -> &'a str {
        let start = code.find(name).unwrap_or_else(|| panic!("{name} not found"));
        let rest = &code[start + 1..];
        let end = [rest.find("\nfn "), rest.find("\npub fn "), rest.find("\nasync fn "), rest.find("\npub async fn ")]
            .into_iter()
            .flatten()
            .min()
            .map_or(code.len(), |e| start + 1 + e);
        &code[start..end]
    }

    /// The source files, for checks across all of them.
    #[cfg(feature = "online")]
    fn sources() -> Vec<std::path::PathBuf> {
        fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() { walk(&p, out) } else if p.extension().is_some_and(|x| x == "rs") { out.push(p) }
            }
        }
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        walk(&src, &mut files);
        assert!(files.len() > 50, "found the sources");
        files
    }

    #[test]
    fn the_keys_are_upstreams() {
        #[cfg(feature = "online")]
        assert_eq!(OFF_BY_DEFAULT, [
            crate::boss_report::SHARE_DATA_KEY,
            crate::party_presence::SETTING_KEY,
            crate::account::guest::GUEST_UPLOAD_KEY,
        ]);
    }

    #[test]
    fn a_missing_value_is_off_and_a_chosen_one_stays() {
        let (s, dir) = settings("seed");
        s.set("dpsMeter.partyPresence", "true");
        seed_off_by_default(&s);
        assert_eq!(s.get("dpsMeter.shareData").as_deref(), Some("false"));
        assert_eq!(s.get("dpsMeter.partyPresence").as_deref(), Some("true"));
        assert_eq!(s.get("dpsMeter.guestUpload").as_deref(), Some("false"));
        // A second start changes nothing.
        s.set("dpsMeter.shareData", "true");
        seed_off_by_default(&s);
        assert_eq!(s.get("dpsMeter.shareData").as_deref(), Some("true"));
        let _ = s.flush();
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A player from before 2.0.78 who had turned "Share field boss timers"
    /// (or Supply Requests) on lands at off with the one new switch: the seed
    /// writes it "false", and upstream's fallback to the old keys only applies
    /// while it has no value. Not by chance either: with both old keys "true"
    /// (upstream's fallback would say on) it is still off.
    #[test]
    #[cfg(feature = "online")]
    fn an_old_boss_timer_or_supply_switch_does_not_turn_the_sync_on() {
        let olds: [&[(&str, &str)]; 4] = [
            &[("dpsMeter.shareBossTimers", "true"), ("dpsMeter.shareSupplyRequests", "false")],
            &[("dpsMeter.shareBossTimers", "true"), ("dpsMeter.shareSupplyRequests", "true")],
            &[("dpsMeter.shareSupplyRequests", "true")],
            &[],
        ];
        for old in olds {
            let (s, dir) = settings("old-keys");
            for (k, v) in old {
                s.set(k, v);
            }
            seed_off_by_default(&s);
            assert_eq!(s.get(crate::boss_report::SHARE_DATA_KEY).as_deref(), Some("false"), "{old:?}");
            assert!(!crate::boss_report::shares_data(|k| s.get(k)), "{old:?}: off");
            // Turned on with the new switch, it is on.
            s.set(crate::boss_report::SHARE_DATA_KEY, "true");
            assert!(crate::boss_report::shares_data(|k| s.get(k)), "{old:?}: on once chosen");
            let _ = s.flush();
            let _ = std::fs::remove_dir_all(dir);
        }
        // shares_data asks the new switch first: once it has a value, the old
        // keys don't count.
        let code = code_of(include_str!("../boss_report.rs"));
        let shares = body(&code, "pub fn shares_data(");
        assert!(shares.contains("match get(SHARE_DATA_KEY).as_deref() {"), "{shares}");
        assert!(shares.contains("Some(v) => v != \"false\","), "{shares}");
    }

    /// Every report boss_report.rs sends (maps, kills, HP, the Abyss
    /// artifacts' holders and cores, 2.0.72/73) goes out only when
    /// `shares_data` says so – and the fork seeds `shareData` "false". A new
    /// path or POST upstream adds fails here, to be checked before a release.
    #[test]
    #[cfg(feature = "online")]
    fn every_boss_timer_sender_is_behind_the_switch() {
        let code = code_of(include_str!("../boss_report.rs"));
        assert_eq!(api_paths(&code), [
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
        // The switch: the one setting, read through shares_data.
        assert!(code.contains("fn sharing(state: &AppState) -> bool {\n    shares_data(|k| state.settings.get(k))\n}"));
        // The five places that ask it.
        assert_eq!(code.matches("sharing(&state)").count(), 5);
        let gate_off = "!sharing(&state)";
        // HP/cores' HP, kills and orb killers (spawn_events).
        let events = body(&code, "fn spawn_events(");
        let hp = events.find("let off = !sharing(&state);").expect("HP behind the switch");
        assert!(hp < events.find("/api/boss-timers/hp").unwrap());
        assert!(events.contains("let (false, false, Some(body)) = (off, server == 0, body) else { continue };"));
        let expired = events.find("if !expired.is_empty() && sharing(&state) {").expect("orb killers behind the switch");
        assert!(expired < events.find("send_orb_killers(&state, server, expired)").unwrap());
        let kills = events.find("if !sharing(&state) {\n                waiting.clear();").expect("kills behind the switch");
        assert!(kills < events.find("event_request(server, &event)").unwrap());
        // The artifacts and the orb kills their holders settle.
        let artifacts = body(&code, "async fn send_artifacts(");
        assert!(artifacts.find(gate_off).unwrap() < artifacts.find("send_orb_killers(").unwrap());
        assert!(artifacts.find(gate_off).unwrap() < artifacts.find("/api/boss-timers/artifacts").unwrap());
        // The maps.
        let maps = body(&code, "pub fn spawn(app");
        assert!(maps.find(gate_off).unwrap() < maps.find("/api/boss-timers/report").unwrap());
        // send_orb_killers itself is called only from those two places.
        assert_eq!(code.matches("send_orb_killers(&state, server, expired)").count(), 1);
        assert_eq!(code.matches("send_orb_killers(").count(), 3);
        // And the switch is the one the fork seeds off.
        let (s, dir) = settings("senders");
        seed_off_by_default(&s);
        assert_eq!(s.get(crate::boss_report::SHARE_DATA_KEY).as_deref(), Some("false"));
        assert!(!crate::boss_report::shares_data(|k| s.get(k)));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The Supply Requests boards (supply_report.rs, 2.0.76) go out only
    /// when `shares_data` says so – the same switch, seeded "false". A new
    /// path, POST or GET upstream adds there, or another switch, fails here,
    /// to be checked before a release.
    #[test]
    #[cfg(feature = "online")]
    fn every_supply_sender_is_behind_the_switch() {
        let code = code_of(include_str!("../supply_report.rs"));
        assert_eq!(api_paths(&code), ["/api/profiteer/supply"]);
        assert_eq!(code.matches(".http.post(").count(), 1);
        assert_eq!(code.matches(".http.get(").count(), 0);
        assert_eq!(code.matches(".send()").count(), 1);
        // One loop, and it reads the switch before it builds or sends anything.
        let gate = "if !crate::boss_report::shares_data(|k| state.settings.get(k)) {";
        let spawn = &code[code.find("pub fn spawn(app").unwrap()..];
        let at = spawn.find(gate).expect("the switch is shares_data");
        assert!(at < spawn.find("report(server").unwrap());
        assert!(at < spawn.find("/api/profiteer/supply").unwrap());
        assert!(at < spawn.find(".send()").unwrap());
        assert!(!code.contains("SETTING_KEY"), "a switch of its own again: check it");
    }

    /// Uploads without an account (account/guest.rs, 2.0.79) happen only
    /// with "Upload boss fights without an account" turned on: nothing sets
    /// it "true" by itself (upstream's new-install default is the fork's
    /// `// fork:` in app.rs), the guest is made only on an upload that checked
    /// the switch, and the fork seeds it "false". The claim calls need a guest
    /// key, which only such an upload makes. A new path, POST or caller fails
    /// here, to be checked before a release.
    #[test]
    #[cfg(feature = "online")]
    fn guest_uploads_only_with_the_switch() {
        let guest = code_of(include_str!("../account/guest.rs"));
        assert_eq!(api_paths(&guest), ["/api/guest", "/api/guest/claim-code", "/api/guest/merge"]);
        assert_eq!(guest.matches(".post(").count(), 3);
        assert_eq!(guest.matches(".get(").count(), 0);
        assert_eq!(guest.matches(".send()").count(), 3);
        // The guest is made in token(), which keeps its key (guest.dat).
        let token = body(&guest, "pub async fn token(");
        assert!(token.contains("/api/guest\""));
        assert!(token.contains("secret::save_guest("));
        // merge and claim-code send only with a guest key kept.
        let merge = body(&guest, "pub async fn merge_into_account(");
        assert!(merge.find("secret::load_guest(app_data_dir) else { return None }").unwrap() < merge.find(".send()").unwrap());
        let claim = body(&guest, "pub async fn claim_code(");
        assert!(claim.find("secret::load_guest(app_data_dir) else {").unwrap() < claim.find(".send()").unwrap());

        let mut token_calls = Vec::new();
        for p in sources().iter().filter(|p| !p.ends_with("fork/privacy.rs") && !p.ends_with("account/guest.rs")) {
            // The whole file: share/mod.rs has a test module before the upload.
            let code = std::fs::read_to_string(p).unwrap().replace("\r\n", "\n");
            // Nothing turns the switch on by itself.
            for set in ["GUEST_UPLOAD_KEY, \"true\"", "\"dpsMeter.guestUpload\", \"true\""] {
                assert!(!code.contains(set), "{p:?} sets guest uploads on");
            }
            for (at, _) in code.match_indices("guest::token(") {
                token_calls.push((p.clone(), code[..at].to_string()));
            }
            // A merge only where this PC holds a guest key.
            for (at, _) in code.match_indices("guest::merge_into_account(") {
                let before = &code[at.saturating_sub(200)..at];
                assert!(before.contains("has_guest("), "{p:?}: merge without a guest check");
            }
        }
        // The guest is made in one place: an upload, in the arm that checked
        // the switch.
        assert_eq!(token_calls.len(), 1, "{:?}", token_calls.iter().map(|c| &c.0).collect::<Vec<_>>());
        let (file, before) = &token_calls[0];
        assert!(file.ends_with("share/mod.rs") || file.ends_with("share\\mod.rs"), "{file:?}");
        let arm = &before[before.rfind("crate::account::secret::Stored::Missing").expect("the signed-out arm")..];
        assert!(arm.contains("if settings.get(crate::account::guest::GUEST_UPLOAD_KEY).as_deref() == Some(\"true\") =>"), "{arm}");
        // The new-install block upstream turned it on in is the fork's.
        let app = include_str!("../app.rs").replace("\r\n", "\n");
        let at = app.find("            if new_install {\n").expect("the new-install block");
        let block = &app[at..at + app[at..].find("\n            }\n").unwrap()];
        assert!(block.contains("// fork: a new install doesn't upload without an account"), "{block}");
        assert!(!block.contains("GUEST_UPLOAD_KEY"), "{block}");

        // And the fork seeds it off: no automatic upload, as a guest or not.
        let (s, dir) = settings("guest");
        seed_off_by_default(&s);
        assert_eq!(s.get(crate::account::guest::GUEST_UPLOAD_KEY).as_deref(), Some("false"));
        assert!(!crate::share::auto_uploads(&s));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// "Send Logs to Dev" (share/dev_logs.rs; from 2.0.77 with debug.log,
    /// which can hold names, the party roster and the Windows user name)
    /// stays the fork's stub in app.rs, and nothing else calls the sender.
    /// A merge that brings upstream's command body back fails here.
    #[test]
    fn send_logs_to_dev_stays_the_stub() {
        let app = include_str!("../app.rs").replace("\r\n", "\n");
        let at = app.find("async fn send_logs_to_dev(\n    _state").expect("the fork's stub (online build)");
        let body = &app[at..];
        let body = &body[..body.find("\n}\n").expect("end of the stub")];
        assert!(body.contains("Err(\"Sending logs to the developer is turned off in this build\".into())"), "{body}");
        assert!(!body.contains("dev_logs::send"), "{body}");
        assert!(!body.contains(".await"), "{body}");

        fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() { walk(&p, out) } else if p.extension().is_some_and(|x| x == "rs") { out.push(p) }
            }
        }
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        walk(&src, &mut files);
        assert!(files.len() > 50, "found the sources");
        let callers: Vec<_> = files
            .iter()
            .filter(|p| !p.ends_with("share/dev_logs.rs") && !p.ends_with("fork/privacy.rs"))
            .filter(|p| {
                let code = std::fs::read_to_string(p).unwrap();
                code.contains("dev_logs::send") || code.contains("dev_logs::{")
            })
            .collect();
        assert!(callers.is_empty(), "dev_logs sender called from {callers:?}");
    }
}
