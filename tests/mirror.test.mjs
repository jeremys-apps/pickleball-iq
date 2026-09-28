// Left-right mirroring: exact reflection, tactics preserved, and only
// side-neutral cards marked mirrorable are mirrored, on alternate reviews.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mirrorScene, canMirror, shouldMirror, SIDE_WORDS } from '../app/src/court/mirror.js';
import { checkScene, frameFromScene } from '../app/src/court/scene.js';
import { renderFirstPerson } from '../app/src/court/first-person.js';
import { project } from '../app/src/court/camera.js';
import { paddleSideX } from '../app/src/court/geometry.js';

const deck = JSON.parse(readFileSync(new URL('../app/data/deck.sample.json', import.meta.url)));
const scene = (id) => deck.scenes.find((s) => s.id === id);
const card = (id) => deck.cards.find((c) => c.id === id);

test('every position flips, handedness swaps, and mirroring twice gives the original', () => {
  for (const s of deck.scenes) {
    const m = mirrorScene(s);
    s.players.forEach((p, i) => {
      assert.equal(m.players[i].x, Math.round((20 - p.x) * 1000) / 1000);
      assert.equal(m.players[i].y, p.y);
      assert.equal(m.players[i].hand, p.hand === 'R' ? 'L' : 'R');
    });
    assert.equal(m.ball.now.x, Math.round((20 - s.ball.now.x) * 1000) / 1000);
    if (s.timeline) assert.equal(m.timeline.segments[0].from.x, Math.round((20 - s.timeline.segments[0].from.x) * 1000) / 1000);
    assert.deepEqual(mirrorScene(m), s, `${s.id}: mirrored twice`);
  }
});

test('mirrored sample scenes pass the same semantic checks', () => {
  for (const s of deck.scenes) {
    assert.deepEqual(checkScene(mirrorScene(s)).filter((i) => i.level === 'error'), [], s.id);
  }
});

test('the tactic survives: both backhands stay in the middle', () => {
  const s = scene('s-floater-backhands');
  for (const sc of [s, mirrorScene(s)]) {
    for (const p of sc.players.filter((q) => q.team === 'them')) {
      assert.equal(Math.sign(10 - p.x), -paddleSideX(p), `${p.id}'s backhand faces the middle`);
    }
  }
});

test('a mirrored scene renders as the exact mirror image, camera included', () => {
  for (const id of ['s-floater-backhands', 's-dropping-dink', 's-occlusion-floater']) {
    const s = scene(id);
    const W = 800;
    const a = renderFirstPerson(frameFromScene(s), { width: W, height: 500, mode: 'over_shoulder' });
    const b = renderFirstPerson(frameFromScene(mirrorScene(s)), { width: W, height: 500, mode: 'over_shoulder' });
    for (const [x, y, z] of [[5, 30.1, 0], [15, 30.1, 0], [10, 22, 3], [8, 25, 2], [2, 40, 0]]) {
      const pa = project(a.camera, [x, y, z]);
      const pb = project(b.camera, [20 - x, y, z]);
      assert.ok(Math.abs(pa.x + pb.x - W) < 0.01, `${id}: screen x mirrors for (${x}, ${y})`);
      assert.ok(Math.abs(pa.y - pb.y) < 0.01, `${id}: screen y matches for (${x}, ${y})`);
    }
  }
});

test('only side-neutral cards marked mirrorable mirror, alternating from the second showing', () => {
  assert.equal(canMirror(card('c-floater-fp-1')), true);
  assert.equal(canMirror(card('c-occlusion-floater-1')), true);
  assert.equal(canMirror(card('c-backhands-td-1')), false, 'marked false: it is about righty and lefty placement');
  assert.equal(canMirror({ ...card('c-floater-fp-1'), prompt: 'Their righty floats one up.' }), false, 'a side word blocks it');
  assert.equal(canMirror({ ...card('c-floater-why-1'), mirrorable: true }), false, 'no court, nothing to mirror');
  const c = card('c-floater-fp-1');
  assert.deepEqual([0, 1, 2, 3].map((reps) => shouldMirror(c, { reps })), [false, true, false, true]);
  assert.equal(shouldMirror(c, undefined), false, 'a new card shows as authored');
  assert.ok(!SIDE_WORDS.test('the best shot, upright and bright'));
  assert.ok(SIDE_WORDS.test('Right. Nice read.'), '"right" meaning correct also blocks, by design');
});
