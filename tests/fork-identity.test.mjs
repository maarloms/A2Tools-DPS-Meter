// Fork: the identifier app.rs reads settings.json under before Tauri starts
// ("Run as administrator", 2.0.79) is the fork's own (tauri.conf.json), not
// upstream's: with upstream's the switch would read A2Tools' settings.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const app = readFileSync(new URL('../src-tauri/src/app.rs', import.meta.url), 'utf8');

test('the fork keeps its identifier', () => {
  assert.equal(conf.identifier, 'de.maarloms.aion2-dps-meter');
});

test('Run as administrator reads the fork\'s settings', () => {
  const m = app.match(/const IDENTIFIER: &str = "([^"]+)";/);
  assert.ok(m, 'IDENTIFIER in app.rs');
  assert.equal(m[1], conf.identifier);
  assert.match(app, /platform::admin::wants_admin\(IDENTIFIER\)/);
});
