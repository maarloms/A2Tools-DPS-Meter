import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const bootstrap = readFileSync(new URL('../public/src/js/settingsBootstrap.js', import.meta.url), 'utf8');

function setup(view, { dom = {}, userAgent = 'Linux' } = {}) {
  const classes = new Set();
  const window = { __A2_VIEW__: view, location: { search: '' } };
  vm.runInNewContext(bootstrap, {
    window, URLSearchParams, navigator: { userAgent },
    document: { ...dom, addEventListener: dom.addEventListener || (() => {}), documentElement: { classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
    } } },
  });
  return { window, classes };
}

test('only Linux gets the linux class, in every window', () => {
  for (const view of ['main', 'details', 'history', 'settings']) {
    assert.ok(setup(view).classes.has('linux'));
    assert.equal(setup(view, { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }).classes.size, 0);
  }
});

test('other windows keep their markup', () => {
  for (const view of ['main', 'details', 'history']) {
    setup(view, { dom: { addEventListener: () => { throw new Error('unexpected listener'); } } });
  }
});

test('settings drops unused combat markup before localization while retaining its form and support dialog', () => {
  let parsed;
  const removed = [];
  const child = name => ({ classList: { contains: value => value === name }, remove: () => removed.push(name) });
  const form = child('settingsPanel');
  setup('settings', { dom: {
    addEventListener: (event, callback) => { assert.equal(event, 'DOMContentLoaded'); parsed = callback; },
    querySelector: () => ({ children: [child('header'), child('detailsPanel'), form, child('historyPanel')] }),
    querySelectorAll: selector => {
      assert.equal(selector, '.updateModal, .discordPromo');
      return [child('updateModal'), child('discordPromo')];
    },
  } });
  parsed();
  assert.deepEqual(removed, ['header', 'detailsPanel', 'historyPanel', 'updateModal', 'discordPromo']);
});

const core = readFileSync(new URL('../public/src/js/core.js', import.meta.url), 'utf8');

test('settings initializes saved controls without constructing any combat UI', () => {
  const values = { 'dpsMeter.showPing': 'false', 'dpsMeter.roundDps': 'false', 'dpsMeter.playerLimit': '12' };
  const window = { A2_VIEW: 'settings', addEventListener() {}, javaBridge: { getSetting: key => values[key] } };
  const context = vm.createContext({ window, document: { readyState: 'loading', addEventListener() {} } });
  vm.runInContext(core, context);
  const app = window.dpsApp;
  let initialized = false;
  let changed;
  app.setupSettingsPanel = () => { initialized = true; app.settingsSelections = {}; };
  app.i18n = { onChange: listener => { changed = listener; } };
  app.start();
  assert.ok(initialized);
  assert.equal(app.showPing, false);
  assert.equal(app.showTotalDps, true);
  assert.equal(app.roundDps, false);
  assert.equal(app.playerLimit, 12);
  assert.equal(app.meterUI, undefined);
  assert.equal(app.detailsUI, undefined);
  assert.equal(app._pollTimer, null);
  let dropdownRefreshes = 0;
  app.initializeSettingsDropdowns = () => dropdownRefreshes++;
  app.refreshConnectionInfo = app.updateSupportPrimaryAction = app.updateSupportQrImage = () => {};
  changed('en');
  assert.equal(app.settingsSelections.language, 'en');
  assert.equal(dropdownRefreshes, 1);
  // Settings setters can request a refresh, but must never fetch combat data.
  window.dpsData = { getDpsData: () => { throw new Error('unexpected combat fetch'); } };
  app.fetchDps();
});

const bridge = readFileSync(new URL('../public/src/js/tauriBridge.js', import.meta.url), 'utf8');
const readyMethod = bridge.slice(bridge.indexOf('    async notifyUiReady()'), bridge.indexOf('\n    // --- Settings ---'));

test('the Linux meter reveals itself only after its native size has been applied', async () => {
  let sized;
  const calls = [];
  const pendingSize = new Promise(resolve => { sized = resolve; });
  const ready = vm.runInNewContext(`({${readyMethod}}).notifyUiReady`, {
    viewMode: 'main', loadsHidden: true,
    updateWindowSize: () => pendingSize,
    invoke: async command => calls.push(command),
  });
  const pending = ready();
  await Promise.resolve();
  assert.equal(calls.length, 0);
  sized();
  await pending;
  assert.deepEqual(calls, ['main_window_ready']);
});

test('tool windows and other platforms keep their existing native reveal behavior', async () => {
  for (const [viewMode, loadsHidden] of [['details', true], ['history', true], ['settings', false], ['main', false]]) {
    const ready = vm.runInNewContext(`({${readyMethod}}).notifyUiReady`, {
      viewMode, loadsHidden,
      updateWindowSize: () => { throw new Error('unexpected resize'); },
      invoke: () => { throw new Error('unexpected reveal'); },
    });
    await ready();
  }
});

test('Linux settings lays out its form and reveals without waiting for hidden animation frames', async () => {
  for (const shown of [true, false]) {
    const calls = [];
    const ready = vm.runInNewContext(`({${readyMethod}}).notifyUiReady`, {
      viewMode: 'settings', loadsHidden: true, settingsActive: null,
      settingsLifecycleReady: Promise.resolve(), settingsLifecycleGeneration: 0,
      Event, window: { dispatchEvent: event => calls.push(event.type) },
      document: { querySelector: () => ({ getBoundingClientRect: () => calls.push('layout') }) },
      invoke: async (command, args) => { calls.push(`${command}:${args.label}`); return shown; },
      resumeSettings: () => calls.push('resume'),
    });
    await ready();
    assert.deepEqual(calls, ['layout', 'tool_window_ready:settings', shown ? 'resume' : 'settings-hidden']);
  }
});

function setupBridge({
  view = 'settings', linux = true, discover, title = null, shown = true,
  loadsHidden = linux, reusesSettings = linux,
  now = () => 0, setItem = () => {}, getSettings = () => ({}), nativeListen,
  storage = {},
} = {}) {
  const calls = [];
  const listeners = new Map();
  const events = new Map();
  const timers = new Map();
  const stored = new Map(Object.entries(storage));
  let timerId = 0;
  const window = {
    __A2_VIEW__: view, location: { search: '' },
    __A2_WINDOW_STARTUP__: { loadsHidden, reusesSettings },
    addEventListener(name, handler) {
      const handlers = events.get(name) || [];
      handlers.push(handler);
      events.set(name, handlers);
    },
    dispatchEvent(event) { events.get(event.type)?.forEach(handler => handler(event)); },
    __TAURI__: {
      core: { invoke: (command, args) => {
        calls.push({ command, args });
        if (command === 'get_available_devices' && discover) return discover();
        if (command === 'get_aion2_window_title') return Promise.resolve(title);
        if (command === 'tool_window_ready') return Promise.resolve(typeof shown === 'function' ? shown() : shown);
        if (command === 'get_settings') return Promise.resolve(getSettings());
        return Promise.resolve(null);
      } },
      event: { listen: (name, handler) => {
        listeners.set(name, handler);
        return nativeListen ? nativeListen(name) : Promise.resolve(() => {});
      } },
      opener: { open() {} },
      window: { getCurrentWindow: () => ({ label: view, show: () => calls.push({ command: 'show' }), setFocus() {} }) },
    },
  };
  const document = {
    readyState: 'loading', activeElement: null,
    addEventListener() {}, querySelectorAll: () => [],
    documentElement: { classList: { add() {}, contains: name => name === 'linux' && linux } },
    head: { appendChild() {} }, createElement: () => ({}),
    querySelector: () => null,
  };
  class ClockDate extends Date { static now() { return now(); } }
  vm.runInNewContext(bridge, {
    window, document, navigator: { userAgent: '' }, URLSearchParams, Event, Date: ClockDate,
    localStorage: {
      setItem: (key, value) => { setItem(key, value); stored.set(key, String(value)); },
      getItem: key => stored.get(key) ?? null,
      removeItem: key => stored.delete(key), clear: () => stored.clear(),
    }, console: { log() {}, warn() {}, error() {} },
    setTimeout() {}, requestAnimationFrame() {}, MutationObserver: class { observe() {} },
    setInterval: callback => { timers.set(++timerId, callback); return timerId; },
    clearInterval: id => timers.delete(id),
  });
  return { window, document, calls, timers, listeners, stored };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('native startup policy controls lifecycle even when the browser platform differs', async () => {
  const hidden = setupBridge({ linux: false, loadsHidden: true, reusesSettings: true });
  assert.equal(hidden.timers.size, 0);
  await hidden.window.javaBridge.toolWindowReady('settings');
  assert.ok(!hidden.calls.some(call => call.command === 'show' || call.command === 'tool_window_ready'));
  await hidden.window.javaBridge.notifyUiReady();
  assert.equal(hidden.timers.size, 1);
  assert.equal(hidden.calls.filter(call => call.command === 'get_settings').length, 1);
  hidden.listeners.get('settings-hidden')();
  hidden.listeners.get('settings-shown')();
  await settle();
  assert.equal(hidden.calls.filter(call => call.command === 'get_settings').length, 2);

  const visible = setupBridge({ linux: true, loadsHidden: false, reusesSettings: false });
  await visible.window.javaBridge.toolWindowReady('settings');
  assert.ok(visible.calls.some(call => call.command === 'show'));
  const reads = visible.calls.length;
  await visible.window.javaBridge.notifyUiReady();
  assert.equal(visible.calls.length, reads);
});

test('a close before bridge installation pauses polling and the next opening re-reads settings', async () => {
  let values = { 'dpsMeter.playerLimit': '6' };
  const app = setupBridge({ shown: false, getSettings: () => values });
  let formSyncs = 0, modalCloses = 0;
  app.window._dpsApp = { syncSettingsForm: () => formSyncs++, closeSupportModal: () => modalCloses++ };
  await app.window.javaBridge.notifyUiReady();
  await settle();
  assert.equal(app.timers.size, 0);
  assert.equal(modalCloses, 1);
  assert.ok(!app.calls.some(call => call.command === 'get_capture_status'));
  values = { 'dpsMeter.playerLimit': '12' };
  app.listeners.get('settings-shown')();
  app.listeners.get('settings-shown')();
  await settle();
  assert.equal(app.timers.size, 1);
  assert.equal(formSyncs, 1);
  assert.equal(app.window.javaBridge.getSetting('dpsMeter.playerLimit'), '12');
  assert.equal(app.calls.filter(call => call.command === 'get_settings').length, 2);
});

test('a late successful readiness reply cannot restart a closed settings window', async () => {
  const reply = deferred();
  const app = setupBridge({ shown: () => reply.promise });
  const ready = app.window.javaBridge.notifyUiReady();
  await settle();
  assert.ok(app.calls.some(call => call.command === 'tool_window_ready'));
  app.listeners.get('settings-hidden')();
  reply.resolve(true);
  await ready;
  assert.equal(app.timers.size, 0);
  assert.ok(!app.calls.some(call => call.command === 'get_capture_status'));
  app.listeners.get('settings-shown')();
  assert.equal(app.timers.size, 1);
});

test('a late refused readiness reply cannot pause a newly opened settings window', async () => {
  const reply = deferred();
  const app = setupBridge({ shown: () => reply.promise });
  let formSyncs = 0;
  app.window._dpsApp = { syncSettingsForm: () => formSyncs++ };
  const ready = app.window.javaBridge.notifyUiReady();
  await settle();
  app.listeners.get('settings-hidden')();
  app.listeners.get('settings-shown')();
  reply.resolve(false);
  await ready;
  await settle();
  assert.equal(app.timers.size, 1);
  assert.equal(formSyncs, 1);
});

test('readiness waits for both lifecycle subscriptions before asking the backend to show', async () => {
  const shown = deferred(), hidden = deferred();
  const app = setupBridge({ nativeListen: name => {
    if (name === 'settings-shown') return shown.promise;
    if (name === 'settings-hidden') return hidden.promise;
    return Promise.resolve(() => {});
  } });
  const ready = app.window.javaBridge.notifyUiReady();
  await settle();
  assert.ok(!app.calls.some(call => call.command === 'tool_window_ready'));
  shown.resolve(() => {});
  await settle();
  assert.ok(!app.calls.some(call => call.command === 'tool_window_ready'));
  hidden.resolve(() => {});
  await ready;
  assert.equal(app.calls.filter(call => call.command === 'tool_window_ready').length, 1);
  assert.equal(app.timers.size, 1);
});

test('a native fallback activation before UI readiness starts polling once and resyncs the form', async () => {
  const reply = deferred();
  const app = setupBridge({ shown: () => reply.promise });
  let formSyncs = 0;
  app.window._dpsApp = { syncSettingsForm: () => formSyncs++ };
  const ready = app.window.javaBridge.notifyUiReady();
  await settle();
  assert.equal(app.timers.size, 0);
  app.listeners.get('settings-shown')();
  app.listeners.get('settings-shown')();
  reply.resolve(true);
  await ready;
  await settle();
  assert.equal(app.timers.size, 1);
  assert.equal(formSyncs, 1);
  assert.equal(app.calls.filter(call => call.command === 'get_settings').length, 2);
  assert.equal(app.calls.filter(call => call.command === 'get_capture_status').length, 1);
});

test('a duplicate shown event does not cancel the settings read needed by the first opening', async () => {
  const pending = deferred();
  let reads = 0, formSyncs = 0;
  const app = setupBridge({ getSettings: () => ++reads === 1 ? {} : pending.promise });
  app.window._dpsApp = { syncSettingsForm: () => formSyncs++ };
  await app.window.javaBridge.notifyUiReady();
  app.listeners.get('settings-hidden')();
  app.listeners.get('settings-shown')();
  app.listeners.get('settings-shown')();
  pending.resolve({ 'dpsMeter.playerLimit': '12' });
  await settle();
  assert.equal(reads, 2);
  assert.equal(formSyncs, 1);
  assert.equal(app.timers.size, 1);
});

test('a settings reply received while closed updates the cache but does not touch the form', async () => {
  const pending = deferred();
  let reads = 0, formSyncs = 0;
  const app = setupBridge({ getSettings: () => ++reads === 1 ? {} : pending.promise });
  app.window._dpsApp = { syncSettingsForm: () => formSyncs++ };
  await app.window.javaBridge.notifyUiReady();
  app.listeners.get('settings-hidden')();
  app.listeners.get('settings-shown')();
  app.listeners.get('settings-hidden')();
  pending.resolve({ 'dpsMeter.playerLimit': '12' });
  await settle();
  assert.equal(formSyncs, 0);
  assert.equal(app.timers.size, 0);
  assert.equal(app.window.javaBridge.getSetting('dpsMeter.playerLimit'), '12');
});

test('an older settings response cannot replace the latest reopen snapshot', async () => {
  const initial = deferred(), reopened = deferred();
  let reads = 0;
  const app = setupBridge({ getSettings: () => ++reads === 1 ? initial.promise : reopened.promise });
  app.listeners.get('settings-shown')();
  reopened.resolve({ 'dpsMeter.playerLimit': '12' });
  await settle();
  assert.equal(app.window.javaBridge.getSetting('dpsMeter.playerLimit'), '12');
  initial.resolve({ 'dpsMeter.playerLimit': '6' });
  await app.window.a2SettingsReady;
  await settle();
  assert.equal(app.window.javaBridge.getSetting('dpsMeter.playerLimit'), '12');
  assert.equal(app.stored.get('dpsMeter.playerLimit'), '12');
});

test('startup awaits a settings read that supersedes the initial pending read', async () => {
  const initial = deferred(), reopened = deferred();
  let reads = 0, ready = false;
  const app = setupBridge({ getSettings: () => ++reads === 1 ? initial.promise : reopened.promise });
  app.window.a2SettingsReady.then(() => { ready = true; });
  app.listeners.get('settings-shown')();
  initial.resolve({ 'dpsMeter.playerLimit': '6' });
  await settle();
  assert.equal(ready, false);
  reopened.resolve({ 'dpsMeter.playerLimit': '12' });
  await app.window.a2SettingsReady;
  assert.equal(app.window.javaBridge.getSetting('dpsMeter.playerLimit'), '12');
});

test('pending snapshots preserve newer local edits and setting-changed events per key', async () => {
  const pending = deferred();
  const app = setupBridge({ getSettings: () => pending.promise });
  app.window.javaBridge.setSetting('dpsMeter.playerLimit', '12');
  app.listeners.get('setting-changed')({ payload: { key: 'dpsMeter.roundDps', value: 'false' } });
  pending.resolve({ 'dpsMeter.playerLimit': '6', 'dpsMeter.roundDps': 'true', 'dpsMeter.theme': 'frost' });
  await app.window.a2SettingsReady;
  assert.equal(app.window.javaBridge.getSetting('dpsMeter.playerLimit'), '12');
  assert.equal(app.window.javaBridge.getSetting('dpsMeter.roundDps'), 'false');
  assert.equal(app.window.javaBridge.getSetting('dpsMeter.theme'), 'frost');
});

test('clearing settings invalidates pending snapshots and does not repopulate localStorage', async () => {
  const pending = deferred();
  const app = setupBridge({ getSettings: () => pending.promise, storage: { 'dpsMeter.playerLimit': '6' } });
  app.window.javaBridge.clearAllSettings();
  pending.resolve({ 'dpsMeter.playerLimit': '12' });
  await app.window.a2SettingsReady;
  assert.equal(app.window.javaBridge.getSetting('dpsMeter.playerLimit'), null);
  assert.equal(app.stored.size, 0);
  assert.ok(app.calls.some(call => call.command === 'clear_settings'));
});

test('hidden settings stops status polling; showing it again resumes one timer and re-reads the form', async () => {
  const app = setupBridge();
  assert.equal(app.timers.size, 0);
  await app.window.javaBridge.notifyUiReady();
  assert.equal(app.timers.size, 1);
  assert.ok(!app.listeners.has('dps-update'));
  assert.ok(!app.listeners.has('ping-update'));
  let accountRefreshes = 0;
  let formSyncs = 0;
  app.window._dpsApp = {
    refreshAccountPanel: () => accountRefreshes++,
    syncSettingsForm: () => formSyncs++,
  };
  const settingsReads = () => app.calls.filter(call => call.command === 'get_settings').length;
  // Asked to open while already shown: check the account, nothing else.
  app.listeners.get('settings-shown')();
  await settle();
  assert.equal(accountRefreshes, 1);
  assert.equal(settingsReads(), 1);
  assert.equal(formSyncs, 0);
  app.listeners.get('settings-hidden')();
  assert.equal(app.timers.size, 0);
  app.listeners.get('account-changed')({ payload: {} });
  assert.equal(accountRefreshes, 1);
  const reads = () => app.calls.filter(call => call.command === 'get_capture_status').length;
  const before = reads();
  app.listeners.get('settings-shown')();
  assert.equal(reads(), before + 1);
  assert.equal(app.timers.size, 1);
  app.listeners.get('settings-shown')();
  assert.equal(app.timers.size, 1);
  assert.equal(reads(), before + 1);
  assert.equal(accountRefreshes, 3);
  await settle();
  assert.equal(settingsReads(), 2);
  assert.equal(formSyncs, 1);
  for (let i = 0; i < 20; i++) {
    app.listeners.get('settings-hidden')();
    assert.equal(app.timers.size, 0);
    app.listeners.get('settings-shown')();
    assert.equal(app.timers.size, 1);
  }
});

test('device discovery shares pending calls and rendering cached options never enumerates again', async () => {
  let resolve;
  let discoveries = 0;
  const pending = new Promise(done => { resolve = done; });
  const app = setupBridge({ discover: () => { discoveries++; return pending; } });
  assert.equal(discoveries, 0);
  const first = app.window.javaBridge.loadAvailableDevices();
  const second = app.window.javaBridge.loadAvailableDevices();
  assert.equal(app.window.javaBridge.getAvailableDevices(), '[]');
  assert.equal(discoveries, 1);
  resolve(['eth0']);
  await Promise.all([first, second]);
  assert.equal(app.window.javaBridge.getAvailableDevices(), '["eth0"]');
  assert.equal(discoveries, 1);
  await app.window.javaBridge.loadAvailableDevices();
  assert.equal(discoveries, 2);
});

test('a stale device list is answered at once and refreshed once in the background', async () => {
  let clock = 0;
  let discoveries = 0;
  let devices = ['eth0'];
  const app = setupBridge({ now: () => clock, discover: () => { discoveries++; return Promise.resolve(devices); } });
  await app.window.javaBridge.loadAvailableDevices();
  clock = 9000;
  assert.equal(app.window.javaBridge.getAvailableDevices(), '["eth0"]');
  assert.equal(discoveries, 1);
  clock = 10001;
  devices = ['eth0', 'wlan0'];
  assert.equal(app.window.javaBridge.getAvailableDevices(), '["eth0"]');
  assert.equal(app.window.javaBridge.getAvailableDevices(), '["eth0"]');
  assert.equal(discoveries, 2);
  await settle();
  assert.equal(app.window.javaBridge.getAvailableDevices(), '["eth0","wlan0"]');
  assert.equal(discoveries, 2);
});

test('settings reports whether the game runs after each status read, but not while hidden', async () => {
  const app = setupBridge({ title: 'AION2 | Hero' });
  const titles = [];
  app.window._dpsApp = { refreshSettingsStatus: () => titles.push(app.window.javaBridge.getAion2WindowTitle()) };
  await app.window.javaBridge.notifyUiReady();
  await settle();
  assert.deepEqual(titles, ['AION2 | Hero']);
  app.listeners.get('settings-hidden')();
  assert.equal(app.timers.size, 0);
  app.listeners.get('capture-status-changed')({ payload: {} });
  await settle();
  assert.equal(titles.length, 1);
  app.listeners.get('settings-shown')();
  await settle();
  assert.equal(titles.length, 2);
});

test('the settings window shows "detecting" while the game runs without a port', () => {
  const window = {
    A2_VIEW: 'settings', addEventListener() {},
    javaBridge: {
      getSetting: () => null,
      getAion2WindowTitle: () => 'AION2 | Hero',
      getConnectionInfo: () => JSON.stringify({ ip: '10.0.0.2' }),
    },
  };
  const context = vm.createContext({ window, document: { readyState: 'loading', addEventListener() {} } });
  vm.runInContext(core, context);
  const app = window.dpsApp;
  app.setupSettingsPanel = () => {
    app.settingsSelections = {};
    app.lockedIp = { textContent: '' };
    app.lockedPort = { textContent: '', classList: { remove() {} } };
  };
  app.i18n = { t: (key, fallback) => fallback };
  app.start();
  assert.equal(app.aionRunning, true);
  assert.equal(app.lockedPort.textContent, 'Detecting AION2 connection...');
  window.javaBridge.getAion2WindowTitle = () => null;
  app.refreshSettingsStatus();
  assert.equal(app.lockedPort.textContent, 'Auto');
});

function setupCharacterStatus(info, { focused = false, running = true } = {}) {
  const stored = new Map([['dpsMeter.userName', 'Previous']]);
  const input = { value: focused ? 'Draft name' : 'Previous' };
  const document = { readyState: 'loading', activeElement: focused ? input : null, addEventListener() {} };
  const window = {
    A2_VIEW: 'settings', addEventListener() {},
    dpsData: { getDpsData: () => assert.fail('settings fetched combat data') },
    javaBridge: {
      getAion2WindowTitle: () => running ? 'AION2' : null,
      getConnectionInfo: () => JSON.stringify(info),
      resetDps: () => assert.fail('settings reset the fight'),
      setCharacterName: () => assert.fail('settings re-sent the character name'),
    },
  };
  vm.runInNewContext(core, {
    window, document,
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
  });
  const app = window.dpsApp;
  app.USER_NAME = 'Previous';
  app.characterNameInput = input;
  app.lockedIp = { textContent: '' };
  app.lockedPort = { textContent: '', classList: { remove() {} } };
  app.refreshSettingsStatus();
  return { app, input, stored };
}

test('settings status quietly adopts a switched character name without fetching or resetting combat', () => {
  const fixture = setupCharacterStatus({ characterName: 'Current', characterNameFromGame: true, localPlayerId: 9 });
  assert.equal(fixture.app.USER_NAME, 'Current');
  assert.equal(fixture.input.value, 'Current');
  assert.equal(fixture.stored.get('dpsMeter.userName'), 'Current');
  assert.equal(fixture.app.getRecentLocalIdForName('Current'), 9);
  assert.equal(fixture.app.meterUI, undefined);
  assert.equal(fixture.app._pollTimer, null);
});

test('settings status does not overwrite a character name currently being edited', () => {
  const fixture = setupCharacterStatus({ characterName: 'Current', characterNameFromGame: true }, { focused: true });
  assert.equal(fixture.app.USER_NAME, 'Current');
  assert.equal(fixture.input.value, 'Draft name');
});

test('settings status retains a manual name until the game supplies a confirmed one', () => {
  const fixture = setupCharacterStatus({ characterName: 'Unconfirmed', characterNameFromGame: false });
  assert.equal(fixture.app.USER_NAME, 'Previous');
  assert.equal(fixture.input.value, 'Previous');
  assert.equal(fixture.stored.get('dpsMeter.userName'), 'Previous');
});

test('an unnamed tutorial character does not erase the last saved real name', () => {
  const fixture = setupCharacterStatus({ characterName: '', characterNameFromGame: true });
  assert.equal(fixture.app.USER_NAME, '');
  assert.equal(fixture.input.value, '');
  assert.equal(fixture.stored.get('dpsMeter.userName'), 'Previous');
});

test('hiding settings runs its pause once per close, and only the settings window listens', () => {
  const app = setupBridge();
  let modalCloses = 0;
  app.window._dpsApp = { closeSupportModal: () => modalCloses++ };
  // Close dispatches from the page, then the native close event follows.
  app.window.dispatchEvent(new Event('settings-hidden'));
  app.listeners.get('settings-hidden')();
  assert.equal(modalCloses, 1);
  app.listeners.get('settings-shown')();
  app.listeners.get('settings-hidden')();
  assert.equal(modalCloses, 2);
  const main = setupBridge({ view: 'main' });
  assert.ok(!main.listeners.has('settings-hidden'));
});

test('a full localStorage quota does not keep a setting from the backend', () => {
  const app = setupBridge({ setItem: () => { throw new Error('QuotaExceededError'); } });
  app.window.javaBridge.setSetting('dpsMeter.language', 'de');
  const sent = app.calls.filter(call => call.command === 'update_settings' || call.command === 'set_language');
  assert.deepEqual(sent.map(call => call.command), ['update_settings', 'set_language']);
  assert.equal(app.window.javaBridge.getSetting('dpsMeter.language'), 'de');
});

test('showing a reused settings window refills its form without wiring controls again', async () => {
  const values = {
    'dpsMeter.bossLogsEnabled': 'true', 'dpsMeter.autoHideMeter': 'false', 'dpsMeter.saveRawPackets': 'true',
    'dpsMeter.debugLoggingEnabled': 'true', 'dpsMeter.meterFillOpacity': '55', 'dpsMeter.playerLimit': '10',
    'dpsMeter.betaUi': 'false', 'dpsMeter.slimMode': 'true', 'dpsMeter.theme': 'frost',
    'dpsMeter.defaultMeterMode': 'allTargets', 'dpsMeter.allTargetsWindowMs': '60000',
    'dpsMeter.trainSelectionMode': 'highestDamage', 'dpsMeter.detailsMonitor': '1',
    'dpsMeter.targetSelectionWindowMs': '7777',
    'dpsMeter.manualDevice': 'eth1', 'dpsMeter.roundDps': 'false',
  };
  const wired = [];
  const control = (props = {}) => ({
    checked: false, value: '', ...props,
    addEventListener: name => wired.push(name),
    dispatchEvent(event) { this.events = [...(this.events || []), event.type]; },
  });
  const limitText = { textContent: '6' };
  const limitItems = ['6', '10'].map(value => ({ dataset: { value }, classList: { toggle(name, on) { this.on = on; } } }));
  const window = { A2_VIEW: 'settings', addEventListener() {}, javaBridge: { getSetting: key => values[key] ?? null } };
  const context = vm.createContext({
    window, Event,
    localStorage: { getItem: () => null },
    document: {
      readyState: 'loading', addEventListener() {}, querySelector: selector => (
        selector === '.playerLimitDropdownWrapper'
          ? { querySelector: () => limitText, querySelectorAll: () => limitItems }
          : null
      ),
    },
  });
  vm.runInContext(core, context);
  const app = window.dpsApp;
  Object.assign(app, {
    bossLogsCheckbox: control(), autoHideMeterCheckbox: control({ checked: true }),
    saveRawPacketsCheckbox: control(), debugLoggingCheckbox: control(),
    meterOpacityInput: control({ value: '80' }), autoDetectDeviceCheckbox: control({ checked: true }),
    settingsSelections: { language: 'en' }, availableThemes: ['aion2', 'frost'],
  });
  const remote = [];
  const order = [];
  app.applyRemoteSettingChange = (key, value) => remote.push([key, value]);
  app.setBetaUi = enabled => { app.betaUi = enabled; };
  app.setSlimMode = enabled => { app.slimMode = enabled; };
  app.applyTheme = theme => { app.theme = theme; };
  app._updateDeviceDropdownState = () => {};
  app._loadDeviceDropdown = () => order.push('devices');
  app.initializeSettingsDropdowns = () => order.push(`dropdowns:${app.monitorList?.length ?? 0}`);
  app.refreshMonitorList = async () => { order.push('monitors'); app.monitorList = [{}, {}]; return app.monitorList; };
  await app.syncSettingsForm();
  assert.deepEqual(remote, [['dpsMeter.roundDps', 'false']]);
  assert.equal(app.bossLogsCheckbox.checked, true);
  assert.equal(app.autoHideMeterCheckbox.checked, false);
  assert.equal(app.saveRawPacketsCheckbox.checked, true);
  assert.equal(app.debugLoggingEnabled, true);
  assert.equal(app.meterOpacityInput.value, '55');
  assert.deepEqual(app.meterOpacityInput.events, ['input']);
  assert.equal(app.playerLimit, 10);
  assert.equal(limitText.textContent, '10');
  assert.deepEqual(limitItems.map(item => item.classList.on), [false, true]);
  assert.equal(app.getMeterLayout(), 'classicSlim');
  assert.equal(app.theme, 'frost');
  assert.equal(app.settingsSelections.defaultMeterMode, 'allTargets');
  assert.equal(app.settingsSelections.allTargetsWindowMs, '60000');
  assert.equal(app.settingsSelections.targetSelectionWindowMs, '5000', 'an unknown stored value falls back');
  assert.equal(app.settingsSelections.trainSelectionMode, 'highestDamage');
  assert.equal(app.trainSelectionMode, 'highestDamage');
  assert.equal(app.detailsMonitor, '1');
  assert.equal(app.autoDetectDeviceCheckbox.checked, false);
  assert.deepEqual(order, ['devices', 'dropdowns:0', 'monitors', 'dropdowns:2']);
  assert.deepEqual(wired, []);
});

test('Linux settings is revealed by notifyUiReady, and a Close before then stays closed', async () => {
  for (const shown of [false, true]) {
    const app = setupBridge({ shown });
    let formSyncs = 0;
    app.window._dpsApp = { syncSettingsForm: () => formSyncs++ };
    await app.window.javaBridge.toolWindowReady('settings');
    assert.ok(!app.calls.some(call => call.command === 'tool_window_ready' || call.command === 'show'));
    app.listeners.get('settings-hidden')();
    await app.window.javaBridge.notifyUiReady();
    await settle();
    assert.equal(app.timers.size, shown ? 1 : 0);
    assert.equal(formSyncs, shown ? 1 : 0);
  }
});

test('other platforms reveal settings from the page and never resync it', async () => {
  const app = setupBridge({ linux: false });
  let accountRefreshes = 0;
  app.window._dpsApp = { refreshAccountPanel: () => accountRefreshes++, syncSettingsForm: () => { throw new Error('resync'); } };
  await app.window.javaBridge.toolWindowReady('settings');
  assert.deepEqual(app.calls.slice(-2).map(call => call.command), ['show', 'tool_window_ready']);
  app.listeners.get('settings-shown')();
  await app.window.javaBridge.notifyUiReady();
  await settle();
  assert.equal(accountRefreshes, 1);
  assert.equal(app.calls.filter(call => call.command === 'get_settings').length, 1);
});

test('hiding settings flushes a name typed just before Close exactly once', () => {
  const listeners = new Map();
  const timers = new Map();
  const saves = [];
  const input = { value: '', addEventListener: (name, handler) => listeners.set(`input:${name}`, handler) };
  const app = {
    characterNameInput: input, USER_NAME: '', storageKeys: { userName: 'name' },
    safeGetSetting: () => 'previous',
    safeSetSetting: (key, name) => saves.push({ key, name }),
    setUserName: (name, options) => {
      assert.equal(options.manual, true);
      assert.equal(options.syncBackend, true);
    },
  };
  const block = core.slice(core.indexOf('    if (this.characterNameInput) {', core.indexOf('  setupSettingsPanel()')),
    core.indexOf('    if (this.localActorIdInput) {', core.indexOf('  setupSettingsPanel()')));
  vm.runInNewContext(`(function () { ${block} }).call(app)`, {
    app, window: { A2_VIEW: 'settings', addEventListener: (name, handler) => listeners.set(name, handler) },
    setTimeout: callback => { timers.set(1, callback); return 1; },
    clearTimeout: id => timers.delete(id),
  });
  input.value = 'new player';
  listeners.get('input:input')();
  listeners.get('settings-hidden')();
  listeners.get('settings-hidden')();
  assert.equal(timers.size, 0);
  assert.deepEqual(saves, [{ key: 'name', name: 'new player' }]);
  const mainListeners = new Map();
  vm.runInNewContext(`(function () { ${block} }).call(app)`, {
    app, window: { A2_VIEW: 'main', addEventListener: (name, handler) => mainListeners.set(name, handler) },
    setTimeout() {}, clearTimeout() {},
  });
  assert.ok(!mainListeners.has('settings-hidden'));
});

test('opening settings does not reapply the default target mode to an ongoing fight', () => {
  const writes = [];
  const state = { mode: 'allTargets' };
  const app = {
    storageKeys: {}, settingsSelections: {},
    safeGetSetting: () => null, safeGetStorage: () => null,
    safeSetSetting: (...args) => writes.push(args),
    setTargetSelection: (mode, { syncBackend }) => { if (syncBackend) state.mode = mode; },
    setUserName: (name, { syncBackend }) => { if (syncBackend) writes.push(['name', name]); },
    setDebugLogging: (value, { syncBackend }) => { if (syncBackend) writes.push(['debug', value]); },
    setOnlyShowUser() {}, setPinMeToTop() {}, setBetaUi() {}, setSlimMode() {},
    setMainPlayerNamesBold() {}, setMainPlayerDpsBold() {}, applyTheme() {},
  };
  const setupStart = core.indexOf('  setupSettingsPanel()');
  const initialization = core.slice(core.indexOf('    const syncBackend', setupStart),
    core.indexOf('    if (this.characterNameInput) {', setupStart));
  const helpers = core.slice(core.indexOf('const SETTING_CHOICES'), core.indexOf('const REMOTE_APPLIED_SETTING_CONTROLS'));
  vm.runInNewContext(`${helpers}(function () { ${initialization} }).call(app)`, {
    app, window: { A2_VIEW: 'settings' },
  });
  assert.equal(state.mode, 'allTargets');
  assert.equal(app.settingsSelections.defaultMeterMode, 'bossTargets');
  assert.equal(writes.length, 0);
});
