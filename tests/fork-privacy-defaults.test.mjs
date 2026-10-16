// Fork: "Share field boss timers" and "Show A2Tools users in my party" start
// off (fork/privacy.rs writes "false" for a missing value; the form agrees).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const core = readFileSync(new URL('../public/src/js/core.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src-tauri/src/app.rs', import.meta.url), 'utf8');

// The block of setupSettingsPanel that wires both switches.
const start = core.indexOf('    if (this.partyPresenceCheckbox) {');
const end = core.indexOf('    if (this.debugLoggingCheckbox) {', start);
const wiring = core.slice(start, end);

function form(values) {
  const box = () => {
    const handlers = {};
    return { checked: null, addEventListener: (name, f) => { handlers[name] = f; }, change(v) { this.checked = v; handlers.change({ target: this }); } };
  };
  const saved = {};
  const self = {
    storageKeys: { partyPresence: 'dpsMeter.partyPresence', shareBossTimers: 'dpsMeter.shareBossTimers' },
    partyPresenceCheckbox: box(),
    shareBossTimersCheckbox: box(),
    safeGetSetting: (key) => values[key],
    safeSetSetting: (key, value) => { saved[key] = value; },
  };
  vm.runInNewContext(`(function () {${wiring}}).call(self)`, { self });
  return { self, saved };
}

test('both switches are wired in one block', () => {
  assert.ok(start > 0 && end > start);
  assert.match(wiring, /partyPresenceCheckbox/);
  assert.match(wiring, /shareBossTimersCheckbox/);
});

test('without a saved value both switches show off', () => {
  const { self } = form({});
  assert.equal(self.partyPresenceCheckbox.checked, false);
  assert.equal(self.shareBossTimersCheckbox.checked, false);
});

test('a value the user saved is kept, and a click saves it', () => {
  const on = form({ 'dpsMeter.partyPresence': 'true', 'dpsMeter.shareBossTimers': 'true' });
  assert.equal(on.self.partyPresenceCheckbox.checked, true);
  assert.equal(on.self.shareBossTimersCheckbox.checked, true);
  const off = form({ 'dpsMeter.partyPresence': 'false', 'dpsMeter.shareBossTimers': 'false' });
  assert.equal(off.self.partyPresenceCheckbox.checked, false);
  off.self.shareBossTimersCheckbox.change(true);
  off.self.partyPresenceCheckbox.change(true);
  assert.deepEqual(off.saved, { 'dpsMeter.shareBossTimers': 'true', 'dpsMeter.partyPresence': 'true' });
});

test('the A2-tag popup, which would save its answer, is never opened', () => {
  assert.match(core, /maybeShowPartyPromo\(\) \{/);
  assert.doesNotMatch(core, /this\.maybeShowPartyPromo\(/);
});

test('the backend writes the off default before the senders start', () => {
  const seed = app.indexOf('crate::fork::privacy::seed_off_by_default(');
  assert.ok(seed > 0);
  for (const sender of ['crate::boss_report::spawn(', 'crate::party_presence::spawn(']) {
    const at = app.indexOf(sender);
    assert.ok(at > seed, `${sender} after the seed`);
  }
});
