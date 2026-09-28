// Timeline playback for occlusion training.
//
// A scene's timeline is a chain of ball segments (shots and bounces) plus player
// movements. Playback shows the lead-in shots, freezes at the decision point,
// and hands control to the UI, which starts a response clock.
//
// frameAt() is pure (easy to test); createPlayer() drives it with
// requestAnimationFrame. The camera look target stays fixed for the whole
// timeline (scene.js lookAtFor) so the view never pans.

import { makeArc } from './trajectory.js';
import { lookAtFor, eyesPlayer } from './scene.js';
import { clamp, lerp } from './geometry.js';

const smoothstep = (p) => p * p * (3 - 2 * p);

// The freeze can be pulled earlier than authored as a card matures (T-2), but
// never before the last shot has been visible for this long.
export const MIN_FLIGHT_MS = 150;

// freezeLeadMs: how much earlier than the authored freeze_at_ms to freeze.
// freezeAt is clamped between the last segment's start plus MIN_FLIGHT_MS and
// the authored freeze, so an earlier freeze never hides the whole last shot
// and never lands later than the author intended.
export function compileTimeline(scene, { freezeLeadMs = 0 } = {}) {
  const tl = scene.timeline;
  if (!tl?.segments?.length) return null;
  let t = 0;
  const segs = tl.segments.map((sg) => {
    const arc = makeArc(sg.from, sg.to, sg);
    const seg = { ...sg, arc, start: t, end: t + sg.duration_ms };
    t += sg.duration_ms;
    return seg;
  });
  const movements = [...(tl.movements ?? [])].sort((a, b) => a.start_ms - b.start_ms);
  const authoredFreezeAt = Math.min(tl.freeze_at_ms ?? t, t);
  const last = segs[segs.length - 1];
  const earliest = Math.min(authoredFreezeAt, last.start + MIN_FLIGHT_MS);
  const freezeAt = clamp(authoredFreezeAt - Math.max(0, freezeLeadMs), earliest, authoredFreezeAt);
  return {
    segs,
    total: t,
    freezeAt,
    authoredFreezeAt,
    responseWindowMs: tl.response_window_ms ?? 3000,
    movements,
    lookAt: lookAtFor(scene),
    eyesOf: eyesPlayer(scene)?.id ?? 'you',
  };
}

function playerPositions(scene, compiled, ms) {
  return scene.players.map((p) => {
    let x = p.x;
    let y = p.y;
    for (const mv of compiled.movements) {
      if (mv.player_id !== p.id || ms <= mv.start_ms) continue;
      const span = Math.max(1, mv.end_ms - mv.start_ms);
      const k = smoothstep(clamp((ms - mv.start_ms) / span, 0, 1));
      x = lerp(x, mv.to.x, k);
      y = lerp(y, mv.to.y, k);
    }
    return { ...p, x, y };
  });
}

// Frame at scene time ms. The trail shows only the shot in flight.
export function frameAt(scene, compiled, ms, { reveal = false } = {}) {
  const m = clamp(ms, 0, compiled.total);
  const seg = compiled.segs.find((s) => m >= s.start && m <= s.end) ?? compiled.segs[compiled.segs.length - 1];
  const lt = seg.end > seg.start ? (m - seg.start) / (seg.end - seg.start) : 1;
  return {
    players: playerPositions(scene, compiled, m),
    ball: { pos: seg.arc.at(lt), arc: seg.arc, t0: 0, t1: lt, hitterId: seg.hitter_id ?? null, segmentId: seg.id },
    eyesOf: compiled.eyesOf,
    lookAt: compiled.lookAt,
    reveal: reveal ? (scene.answer_overlay ?? null) : null,
  };
}

// Drives playback. speed < 1 is slow motion (used for new cards).
// opts.freezeLeadMs freezes earlier than authored (see compileTimeline).
// play(fromMs, { toEnd: true }) ignores the freeze and runs to the end of the
// timeline, for the reveal after an answer; onFreeze then fires at the end.
// Callbacks: onFrame(frame, ms), onFreeze(frame, ms).
export function createPlayer(scene, opts = {}) {
  const compiled = compileTimeline(scene, { freezeLeadMs: opts.freezeLeadMs ?? 0 });
  if (!compiled) throw new Error('createPlayer: scene has no timeline');
  let stopAt = compiled.freezeAt;
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id) => cancelAnimationFrame(id));
  const now = opts.now ?? (() => performance.now());
  const reducedMotion =
    opts.reducedMotion ??
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let speed = opts.speed ?? 1;
  let handle = null;
  let startReal = 0;
  let startScene = 0;

  const stop = () => {
    if (handle != null) caf(handle);
    handle = null;
  };

  const freeze = () => {
    stop();
    const f = frameAt(scene, compiled, stopAt);
    opts.onFrame?.(f, stopAt);
    opts.onFreeze?.(f, stopAt);
  };

  const tick = () => {
    const ms = startScene + (now() - startReal) * speed;
    if (ms >= stopAt) return freeze();
    opts.onFrame?.(frameAt(scene, compiled, ms), ms);
    handle = raf(tick);
  };

  return {
    compiled,
    play(fromMs = 0, { toEnd = false } = {}) {
      stop();
      stopAt = toEnd ? compiled.total : compiled.freezeAt;
      if (reducedMotion) return freeze();
      startReal = now();
      startScene = fromMs;
      handle = raf(tick);
    },
    stop,
    setSpeed(s) {
      speed = s;
    },
    frameAt: (ms, o) => frameAt(scene, compiled, ms, o),
    destroy: stop,
  };
}
