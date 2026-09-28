// Renderer lab smoke test in jsdom: it builds, draws the sample scenes, and keeps
// the motion bar with Play directly above the picture, with the panels beside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  /* jsdom not installed */
}
const skip = !JSDOM && 'run npm install to enable UI tests';

test('the lab builds with settings on top, Play above the picture, and the panels beside it', { skip }, async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main id="lab" class="page lab"></main></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const deck = readFileSync(new URL('../app/data/deck.sample.json', import.meta.url), 'utf8');
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    requestAnimationFrame: w.requestAnimationFrame.bind(w),
    cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    fetch: async () => ({ json: async () => JSON.parse(deck) }),
  });
  await import('../app/src/ui/lab.js');
  for (let i = 0; i < 40 && !document.querySelector('.lab-stage .readout')?.textContent; i++) await new Promise((r) => setTimeout(r, 25));

  const lab = document.getElementById('lab');
  assert.equal(lab.children.length, 2, 'settings, then the stage');
  assert.equal(lab.firstElementChild.className, 'lab-settings-wrap');
  assert.ok(lab.firstElementChild.hasAttribute('open'), 'settings start open');
  assert.equal(lab.querySelectorAll('.lab-settings fieldset').length, 6);
  const stage = lab.querySelector('.lab-stage');
  const motion = stage.firstElementChild;
  assert.equal(motion.className, 'lab-motion');
  assert.equal(motion.querySelector('.btn.primary').textContent, 'Play');
  assert.equal(motion.nextElementSibling.className, 'lab-views', 'the motion bar sits directly above the views');
  assert.ok(stage.querySelector('.lab-views .fp svg.piq-fp'), 'the picture is drawn');
  assert.ok(stage.querySelector('.lab-views .lab-panels .td svg'), 'the top-down panel is drawn beside it');
  assert.match(stage.querySelector('.readout').textContent, /above net height/);
  assert.match(lab.querySelector('.issues').textContent, /No issues found/);
});
