// Stylesheet rules the jsdom tests cannot see, since jsdom ignores media
// queries. These read app/styles.css as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Top-level rules and at-rules as [prelude, body], matching braces.
function blocks(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  let open = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' && depth++ === 0) open = i;
    else if (text[i] === '}' && --depth === 0) {
      out.push([text.slice(start, open).trim(), text.slice(open + 1, i)]);
      start = i + 1;
    }
  }
  return out;
}

test('hover styles apply only where a pointer can hover, so a tap never leaves a choice looking selected', () => {
  const hoverOnly = (prelude) => /^@media\s*\(\s*hover\s*:\s*hover\s*\)/.test(prelude);
  const all = blocks(css);
  assert.ok(all.some(([p, body]) => hoverOnly(p) && body.includes('.option:hover')), 'choices still highlight under a mouse');
  const bare = all.filter(([p, body]) => !hoverOnly(p) && (p + body).includes(':hover')).map(([p]) => p);
  assert.deepEqual(bare, []);
});

test("sign-in errors are red, the colour of a wrong answer, under a field and under the buttons, in both themes", () => {
  const all = blocks(css);
  const colorOf = (selector) =>
    all
      .filter(([p]) => p.split(',').map((s) => s.trim()).includes(selector))
      .map(([, body]) => (body.match(/(?:^|;)\s*color:\s*([^;]+)/) ?? [])[1]?.trim())
      .filter(Boolean)
      .pop();
  // These outrank the grey of a field's hint (.form label small) and of .note.
  assert.equal(colorOf('.form label small.error'), 'var(--bad)');
  assert.equal(colorOf('.note.error'), 'var(--bad)');
  const themes = all.filter(([p, body]) => p === ':root' || (/prefers-color-scheme:\s*dark/.test(p) && body.includes(':root')));
  assert.equal(themes.length, 2);
  for (const [p, body] of themes) assert.match(body, /--bad:\s*#[0-9A-Fa-f]{6}/, `${p} defines the red`);
});
