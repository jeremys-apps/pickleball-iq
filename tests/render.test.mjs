// Renderer geometry tests. These pin down the properties the design depends on.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frameFromScene, checkScene, answerFrame, answerArc } from '../app/src/court/scene.js';
import { renderFirstPerson } from '../app/src/court/first-person.js';
import { renderTopDown, renderSideView } from '../app/src/court/top-down.js';
import { makeArc } from '../app/src/court/trajectory.js';
import { netHeightFt, paddleSideX } from '../app/src/court/geometry.js';
import { compileTimeline, frameAt, contactFrame, createPlayer, MIN_FLIGHT_MS } from '../app/src/court/playback.js';

const deck = JSON.parse(readFileSync(new URL('../app/data/deck.sample.json', import.meta.url)));
const scene = (id) => deck.scenes.find((s) => s.id === id);
const spread = (pts) => Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));

test('net is 36 in at the posts and 34 in at the center', () => {
  assert.equal(Math.round(netHeightFt(0) * 12), 36);
  assert.equal(Math.round(netHeightFt(20) * 12), 36);
  assert.equal(Math.round(netHeightFt(10) * 12), 34);
});

test('paddle side follows team facing and handedness', () => {
  assert.equal(paddleSideX({ team: 'us', hand: 'R' }), 1);
  assert.equal(paddleSideX({ team: 'us', hand: 'L' }), -1);
  assert.equal(paddleSideX({ team: 'them', hand: 'R' }), -1);
  assert.equal(paddleSideX({ team: 'them', hand: 'L' }), 1);
});

test('arcs honor the requested net clearance', () => {
  const s = scene('s-dropping-dink');
  const arc = makeArc(s.ball.from, s.ball.now, s.ball);
  assert.ok(arc.crosses);
  assert.ok(Math.abs(arc.actualClearanceIn - s.ball.net_clearance_in) < 0.01);
});

test('sample scenes pass semantic checks', () => {
  for (const s of deck.scenes) {
    const errors = checkScene(s).filter((i) => i.level === 'error');
    assert.deepEqual(errors, [], s.id);
  }
});

for (const mode of ['over_shoulder', 'first_person']) {
  test(`floater reads above net height but draws below the tape (${mode})`, () => {
    const { debug } = renderFirstPerson(frameFromScene(scene('s-floater-backhands')), { mode });
    assert.ok(debug.ball.y < debug.tick.y, 'ball should sit above its net-height tick');
    assert.ok(debug.ball.y > debug.netTopYAtBall, 'ball should appear below the net tape (the illusion the tick corrects)');
  });

  test(`dropping dink reads below net height (${mode})`, () => {
    const { debug } = renderFirstPerson(frameFromScene(scene('s-dropping-dink')), { mode });
    assert.ok(debug.ball.y > debug.tick.y, 'ball should sit below its net-height tick');
  });
}

test('over-the-shoulder view spreads a straight-on path wider than true first person', () => {
  const f = frameFromScene(scene('s-dropping-dink'));
  const fp = renderFirstPerson(f, { mode: 'first_person' }).debug.trail;
  const ots = renderFirstPerson(f, { mode: 'over_shoulder' }).debug.trail;
  const sFp = spread([...fp.far, ...fp.near]);
  const sOts = spread([...ots.far, ...ots.near]);
  assert.ok(sOts > sFp * 1.5, `expected OTS spread (${sOts.toFixed(1)}) well above FP (${sFp.toFixed(1)})`);
});

test('path is dashed beyond the net and solid on your side', () => {
  const { svg } = renderFirstPerson(frameFromScene(scene('s-floater-backhands')));
  assert.match(svg, /piq-path piq-path-far/);
  assert.match(svg, /<line class="piq-path"/);
});

test('answer overlay is present but hidden until reveal', () => {
  const f = frameFromScene(scene('s-floater-backhands'));
  for (const svg of [renderFirstPerson(f).svg, renderTopDown(f).svg]) {
    assert.match(svg, /<g class="piq-reveal">/);
  }
  const standalone = renderTopDown(f, { embedCss: true }).svg;
  assert.match(standalone, /\.piq-reveal\{opacity:0/);
});

const close = (a, b, tol = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < tol);

test('the answer arrow starts at the contact point, not at the moving ball', () => {
  const s = scene('s-dropping-dink');
  const tdStart = (f) => renderTopDown(f).svg.match(/<line class="piq-answer" x1="([^"]+)" y1="([^"]+)"/).slice(1);
  assert.deepEqual(tdStart(frameFromScene(s, 0.4)), tdStart(frameFromScene(s, 1)));
  const fpStart = (f) => renderFirstPerson(f).svg.match(/<polyline class="piq-answer" points="([^ "]+)/)[1];
  assert.equal(fpStart(frameFromScene(s, 0.4)), fpStart(frameFromScene(s, 1)));
  const hidden = frameFromScene(s, 0.4, { reveal: false });
  assert.equal(hidden.reveal, null, 'the overlay can be left out while their shot is on its way');
  assert.doesNotMatch(renderFirstPerson(hidden).svg, /piq-reveal/);
});

test('the answer half of a replay flies the shot from contact to its target', () => {
  const s = scene('s-dropping-dink');
  const base = frameFromScene(s);
  const arc = answerArc(s);
  const at0 = answerFrame(s, base, 0);
  assert.ok(close(at0.ball.pos, base.contact), 'starts where you meet the ball');
  assert.equal(at0.trails.length, 1, 'their shot stays as a trail');
  const svg0 = renderFirstPerson(at0).svg;
  assert.doesNotMatch(svg0, /polyline class="piq-answer"/, 'no answer path before the ball leaves');
  assert.match(svg0, /piq-answer-zone/, 'the target shows at contact');
  const at1 = answerFrame(s, base, 1);
  assert.ok(close(at1.ball.pos, arc.p1), 'ends where the shot lands');
  assert.ok(close(at1.ball.pos, [s.answer_overlay.shot.to.x, s.answer_overlay.shot.to.y, s.answer_overlay.shot.to.z_in / 12]));
  for (const svg of [renderFirstPerson(at1).svg, renderTopDown(at1).svg]) {
    assert.match(svg, /piq-answer"/, 'the answer path is drawn in full');
    assert.match(svg, /piq-path/, 'the trail of their shot is still drawn');
  }
  const half = renderTopDown(answerFrame(s, base, 0.5)).svg.match(/<line class="piq-answer" x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/).slice(1).map(Number);
  const full = renderTopDown(at1).svg.match(/<line class="piq-answer" x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/).slice(1).map(Number);
  assert.ok(Math.abs(half[2] - (full[0] + full[2]) / 2) < 0.2 && Math.abs(half[3] - (full[1] + full[3]) / 2) < 0.2, 'half flown, the line ends half way');
  // A positioning answer has no shot to fly: the overlay simply appears.
  const noShot = { ...s, answer_overlay: { moves: [{ player_id: 'you', to: { x: 10, y: 13 } }] } };
  const f = answerFrame(noShot, frameFromScene(noShot), 0.5);
  assert.equal(f.ball.answer, undefined);
  assert.deepEqual(f.reveal, noShot.answer_overlay);
});

test('timed frames carry the decision point as the contact', () => {
  const s = scene('s-occlusion-floater');
  const c = compileTimeline(s);
  assert.deepEqual(frameAt(s, c, 0).contact, c.segs[c.segs.length - 1].arc.p1);
});

test('renders fit phone and laptop viewports without throwing', () => {
  const f = frameFromScene(scene('s-floater-backhands'));
  for (const [w, h] of [[360, 400], [800, 500], [1200, 700]]) {
    const { svg } = renderFirstPerson(f, { width: w, height: h });
    assert.match(svg, new RegExp(`viewBox="0 0 ${w} ${h}"`));
  }
  assert.match(renderTopDown(f, { variant: 'mini' }).svg, /piq-td-mini/);
  assert.match(renderSideView(f).svg, /Net 34 in/);
});

test('timeline freezes before the ball arrives and moves players', () => {
  const s = scene('s-occlusion-floater');
  const c = compileTimeline(s);
  assert.equal(c.total, 2480);
  assert.equal(c.freezeAt, 2330);
  const start = frameAt(s, c, 0);
  const frozen = frameAt(s, c, c.freezeAt);
  assert.equal(start.ball.segmentId, 'seg1');
  assert.equal(frozen.ball.segmentId, 'seg3');
  assert.ok(frozen.ball.pos[1] > s.ball.now.y, 'frozen ball has not yet reached the decision point');
  const opp2 = frozen.players.find((p) => p.id === 'opp2');
  assert.ok(Math.abs(opp2.x - 14.2) < 0.01);
  assert.equal(frozen.reveal, null, 'no answer overlay during playback');
});

test('an earlier freeze as the card matures, clamped so the last shot stays visible', () => {
  const s = scene('s-occlusion-floater');
  assert.equal(compileTimeline(s).authoredFreezeAt, 2330);
  assert.equal(compileTimeline(s, { freezeLeadMs: 120 }).freezeAt, 2210);
  assert.equal(compileTimeline(s, { freezeLeadMs: 250 }).freezeAt, 2080);
  assert.equal(compileTimeline(s, { freezeLeadMs: 250 }).authoredFreezeAt, 2330, 'the authored freeze is reported unchanged');
  // A short last shot: the freeze never lands before MIN_FLIGHT_MS into it, and never later than authored.
  const seg1 = s.timeline.segments[0];
  const seg3 = s.timeline.segments[2];
  const short = { ...s, timeline: { segments: [seg1, { ...seg3, from: seg1.to, duration_ms: 300 }], movements: [], freeze_at_ms: 1150 } };
  assert.equal(MIN_FLIGHT_MS, 150);
  assert.equal(compileTimeline(short).freezeAt, 1150);
  assert.equal(compileTimeline(short, { freezeLeadMs: 250 }).freezeAt, 1100, 'clamped to MIN_FLIGHT_MS into the last shot');
  assert.equal(compileTimeline(short, { freezeLeadMs: -50 }).freezeAt, 1150, 'never later than authored');
});

test('the player honors the freeze lead and can run to the end for the reveal', () => {
  const s = scene('s-occlusion-floater');
  const stops = [];
  const p = createPlayer(s, { freezeLeadMs: 250, reducedMotion: true, onFreeze: (f, ms) => stops.push(ms) });
  p.play(0);
  p.play(0, { toEnd: true });
  assert.deepEqual(stops, [2080, 2480]);
  assert.equal(p.compiled.freezeAt, 2080);
});

test('the contact frame keeps players where the lead-in moved them, with the answer', () => {
  const s = scene('s-occlusion-floater');
  const c = compileTimeline(s);
  const f = contactFrame(s, c);
  const last = c.segs[c.segs.length - 1];
  assert.ok(Math.abs(f.players.find((p) => p.id === 'opp2').x - 14.2) < 0.01, 'opp2 stays where his movement ended');
  assert.equal(frameFromScene(s).players.find((p) => p.id === 'opp2').x, 15, 'the static frame is the starting setup');
  assert.deepEqual(f.contact, last.arc.p1);
  assert.deepEqual(f.ball.pos, last.arc.at(1), 'the ball sits at the contact point');
  assert.equal(f.ball.t1, 1);
  assert.deepEqual(f.trails, [], 'a volley is one shot, drawn as the ball arc');
  assert.deepEqual(f.reveal, s.answer_overlay);
  assert.equal(contactFrame(s, c, { reveal: false }).reveal, null);
  const plain = (x) => JSON.parse(JSON.stringify(x)); // arcs carry closures; compare their data
  assert.deepEqual(plain(createPlayer(s, { reducedMotion: true }).contactFrame()), plain(f));
});

test('an answer move the lead-in already made draws no arrow', () => {
  const s = scene('s-occlusion-floater');
  const withMove = (to) => ({ ...s, answer_overlay: { ...s.answer_overlay, moves: [{ player_id: 'opp2', to }] } });
  const arrows = (sc) => {
    const f = contactFrame(sc, compileTimeline(sc));
    return {
      map: (renderTopDown(f).svg.match(/<line class="piq-answer"/g) ?? []).length,
      eye: (renderFirstPerson(f, { revealAll: true }).svg.match(/<polyline class="piq-answer"/g) ?? []).length,
    };
  };
  const none = arrows(s);
  assert.deepEqual(arrows(withMove({ x: 14.2, y: 30.1 })), none, 'opp2 is already there at contact: no stub arrow');
  const real = arrows(withMove({ x: 11, y: 30.1 }));
  assert.equal(real.map, none.map + 1, 'a real move still draws on the map');
  assert.ok(real.eye > none.eye, 'and in your view');
});

test('the contact frame draws a ball that bounced before contact with its bounce', () => {
  const s = scene('s-occlusion-floater');
  const landing = { x: 6.4, y: 18.5, z_in: 0 };
  const now = { x: 6.6, y: 16.4, z_in: 14 };
  const bounced = {
    ...s,
    ball: { from: { x: 4.7, y: 28.6, z_in: 20 }, now, net_clearance_in: 10, hitter_id: 'opp1' },
    timeline: {
      segments: [
        { id: 'in', kind: 'shot', hitter_id: 'opp1', from: { x: 4.7, y: 28.6, z_in: 20 }, to: landing, net_clearance_in: 10, duration_ms: 900 },
        { id: 'up', kind: 'bounce', from: landing, to: now, apex_in: 16, duration_ms: 300 },
      ],
      movements: [],
      freeze_at_ms: 1050,
    },
  };
  const c = compileTimeline(bounced);
  const f = contactFrame(bounced, c);
  assert.equal(f.trails.length, 1, 'the flight before the bounce stays drawn');
  assert.equal(f.trails[0].arc, c.segs[0].arc);
  assert.equal(f.ball.arc, c.segs[1].arc, 'the ball arc is the bounce up to contact');
  assert.equal(f.ball.hitterId, 'opp1', 'the shot belongs to the player who hit it, not to the bounce');
  // Both pieces reach the map as orange tracks; the static frame has one arc from ball.from to ball.now.
  const tracks = (fr) => (renderTopDown(fr).svg.match(/class="piq-path/g) ?? []).length;
  assert.ok(tracks(f) > tracks(frameFromScene(bounced)), 'the bounce adds a track the static frame lacks');
});
