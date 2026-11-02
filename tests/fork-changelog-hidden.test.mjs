// Fork: Settings -> "What's new" (upstream 2.0.84+, taengu's release notes
// from cdn.a2tools.app) is hidden, and nothing opens it by itself: the fork's
// own notes are the patch-notes popup's (Marlon, 02.11.2026). The backend's
// release_notes stops at the fork's guard (src-tauri/src/fork/update.rs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../public/src/js/core.js', import.meta.url), 'utf8');

test("the What's new tab is not listed in Settings", () => {
  const tab = html.match(/<button class="settingsNavItem"[^>]*data-section="changelog"[^>]*>/);
  assert.ok(tab, 'upstream still has the tab: check the fork hook in index.html');
  assert.match(tab[0], /style="display:none"/);
  // The section stays hidden, so changelog.js never loads the notes itself.
  assert.match(html, /<section class="settingsSection" id="settingsSection-changelog"[^>]* hidden>/);
});

test("no launch opens What's new", () => {
  assert.equal(core.match(/maybeShowWhatsNew\(/g)?.length ?? 0, 1, 'defined, never called');
});

test('the target menu lists GROUP', () => {
  assert.match(core, /\["groupTargets", "GROUP", "header\.targetMode\.groupTargets", [^\]]+\], \/\/ fork/);
  for (const lang of ['de', 'en']) {
    const ui = JSON.parse(readFileSync(new URL(`../src/data/i18n/ui/${lang}.json`, import.meta.url), 'utf8'));
    assert.ok(ui.header.targetMode.groupTargets, lang);
  }
});
