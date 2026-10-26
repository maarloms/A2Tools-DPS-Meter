// Fork: the support dialog shows no ExitLag sponsor card and no "More ways to
// donate on a2tools.app" link (public/fork/skin.css, for every theme).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const skin = readFileSync(new URL('../public/fork/skin.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the sponsor card and the donate link are hidden whatever the theme', () => {
  assert.match(html, /<link href="\/fork\/skin\.css" rel="stylesheet"/);
  assert.match(html, /<div class="supportModal" id="supportModal"/);
  assert.match(html, /<a class="supportMore"/);
  assert.match(html, /<a class="supportSponsor"/);
  assert.match(skin, /\n\.supportModal \.supportSponsor,\n\.supportModal \.supportMore \{\n  display: none !important;\n\}/);
});
