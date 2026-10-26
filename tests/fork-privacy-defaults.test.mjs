// Fork: "Sync useful data to A2Tools" (shareData, 2.0.78: boss timers and
// Supply Requests), "Show A2Tools users in my party" and "Upload boss fights
// without an account" (guestUpload, 2.0.79) start off (fork/privacy.rs writes
// "false" for a missing value; the form agrees). The switches shareData
// replaced don't turn it on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const core = readFileSync(new URL('../public/src/js/core.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = readFileSync(new URL('../src-tauri/src/app.rs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// The block of setupSettingsPanel that wires both switches.
const start = core.indexOf('    if (this.partyPresenceCheckbox) {');
const end = core.indexOf('    if (this.debugLoggingCheckbox) {', start);
const wiring = core.slice(start, end);

// The guest upload switch's wiring.
const guestStart = core.indexOf('    if (this.guestUploadCheckbox) {');
const guestEnd = core.indexOf('\n    }\n', guestStart) + 7;
const guestWiring = core.slice(guestStart, guestEnd);

function box() {
  const handlers = {};
  return { checked: null, addEventListener: (name, f) => { handlers[name] = f; }, change(v) { this.checked = v; handlers.change({ target: this }); } };
}

function form(values) {
  const saved = {};
  const self = {
    storageKeys: { partyPresence: 'dpsMeter.partyPresence', shareData: 'dpsMeter.shareData' },
    partyPresenceCheckbox: box(),
    shareDataCheckbox: box(),
    safeGetSetting: (key) => values[key],
    safeSetSetting: (key, value) => { saved[key] = value; },
  };
  vm.runInNewContext(`(function () {${wiring}}).call(self)`, { self });
  return { self, saved };
}

function guestForm(values) {
  const saved = {};
  const self = {
    storageKeys: { guestUpload: 'dpsMeter.guestUpload' },
    guestUploadCheckbox: box(),
    safeGetSetting: (key) => values[key],
    safeSetSetting: (key, value) => { saved[key] = value; },
  };
  vm.runInNewContext(`(function () {${guestWiring}}).call(self)`, { self });
  return { self, saved };
}

test('both switches are wired in one block', () => {
  assert.ok(start > 0 && end > start);
  assert.match(wiring, /partyPresenceCheckbox/);
  assert.match(wiring, /shareDataCheckbox/);
});

test('without a saved value both switches show off', () => {
  const { self } = form({});
  assert.equal(self.partyPresenceCheckbox.checked, false);
  assert.equal(self.shareDataCheckbox.checked, false);
});

test('the switches shareData replaced do not show it on', () => {
  for (const old of [
    { 'dpsMeter.shareBossTimers': 'true' },
    { 'dpsMeter.shareBossTimers': 'true', 'dpsMeter.shareSupplyRequests': 'true' },
    { 'dpsMeter.shareSupplyRequests': 'true' },
  ]) {
    assert.equal(form(old).self.shareDataCheckbox.checked, false, JSON.stringify(old));
  }
  // Only the new switch, turned on, shows it on.
  assert.equal(form({ 'dpsMeter.shareBossTimers': 'false', 'dpsMeter.shareData': 'true' }).self.shareDataCheckbox.checked, true);
});

test('a value the user saved is kept, and a click saves it', () => {
  const on = form({ 'dpsMeter.partyPresence': 'true', 'dpsMeter.shareData': 'true' });
  assert.equal(on.self.partyPresenceCheckbox.checked, true);
  assert.equal(on.self.shareDataCheckbox.checked, true);
  const off = form({ 'dpsMeter.partyPresence': 'false', 'dpsMeter.shareData': 'false' });
  assert.equal(off.self.partyPresenceCheckbox.checked, false);
  off.self.shareDataCheckbox.change(true);
  off.self.partyPresenceCheckbox.change(true);
  assert.deepEqual(off.saved, { 'dpsMeter.shareData': 'true', 'dpsMeter.partyPresence': 'true' });
});

test('guest uploads show off unless turned on, and a click saves it', () => {
  assert.ok(guestStart > 0 && guestWiring.endsWith('    }\n'), guestWiring);
  assert.equal(guestForm({}).self.guestUploadCheckbox.checked, false);
  assert.equal(guestForm({ 'dpsMeter.guestUpload': 'false' }).self.guestUploadCheckbox.checked, false);
  const on = guestForm({ 'dpsMeter.guestUpload': 'true' });
  assert.equal(on.self.guestUploadCheckbox.checked, true);
  on.self.guestUploadCheckbox.change(false);
  assert.deepEqual(on.saved, { 'dpsMeter.guestUpload': 'false' });
});

test('the guest upload switch stays in Settings', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="settingsToggle guestUploadRow"/);
  assert.match(html, /<input type="checkbox" class="guestUploadCheckbox" \/>/);
});

test('the A2-tag and account popups, which would save their answer, are never opened', () => {
  assert.match(core, /maybeShowPartyPromo\(\) \{/);
  assert.doesNotMatch(core, /this\.maybeShowPartyPromo\(/);
  // The account card would keep guest uploads on for a new install.
  assert.match(core, /async maybeShowAccountPromo\(\) \{/);
  assert.doesNotMatch(core, /this\.maybeShowAccountPromo\(/);
});

test('a new install does not turn guest uploads on', () => {
  const at = app.indexOf('            if new_install {\n');
  assert.ok(at > 0);
  const block = app.slice(at, app.indexOf('\n            }\n', at));
  assert.match(block, /\/\/ fork: a new install doesn't upload without an account/);
  assert.doesNotMatch(block, /GUEST_UPLOAD_KEY|settings\.set\("dpsMeter\.guestUpload"/);
});

test('the backend writes the off default before the senders start', () => {
  const seed = app.indexOf('crate::fork::privacy::seed_off_by_default(');
  assert.ok(seed > 0);
  for (const sender of ['crate::boss_report::spawn(', 'crate::supply_report::spawn(', 'crate::party_presence::spawn(']) {
    const at = app.indexOf(sender);
    assert.ok(at > seed, `${sender} after the seed`);
  }
});
