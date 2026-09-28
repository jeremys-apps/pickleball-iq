// Scene data -> render frames.
//
// A "scene" is the JSON Claude writes (schemas/scene.schema.json).
// A "frame" is one instant the renderers draw: player positions, the ball,
// the camera owner, a fixed look target, and the optional answer overlay.

import { COURT, inToFt, facingY } from './geometry.js';
import { defaultLookAt } from './camera.js';
import { makeArc } from './trajectory.js';

export const playerById = (scene, id) => scene.players.find((p) => p.id === id);

export function eyesPlayer(scene) {
  const id = scene.camera?.eyes_of ?? 'you';
  return playerById(scene, id) ?? scene.players.find((p) => p.team === 'us');
}

export function ballNowFt(scene) {
  if (scene.ball?.now) return [scene.ball.now.x, scene.ball.now.y, inToFt(scene.ball.now.z_in)];
  const segs = scene.timeline?.segments;
  if (segs?.length) {
    const last = segs[segs.length - 1].to;
    return [last.x, last.y, inToFt(last.z_in)];
  }
  return null;
}

// The camera aims at one fixed point per card so playback never pans.
export function lookAtFor(scene) {
  const la = scene.camera?.look_at;
  if (la) return [la.x, la.y, inToFt(la.z_in ?? 17)];
  return defaultLookAt(eyesPlayer(scene), ballNowFt(scene));
}

export function staticArc(scene) {
  if (!scene.ball?.from || !scene.ball?.now) return null;
  return makeArc(scene.ball.from, scene.ball.now, scene.ball);
}

// Frame for the static card view. t in [0, 1] moves the ball along its arc.
export function frameFromScene(scene, t = 1) {
  const arc = staticArc(scene);
  return {
    players: scene.players.map((p) => ({ ...p })),
    ball: arc ? { pos: arc.at(t), arc, t0: 0, t1: t, hitterId: scene.ball.hitter_id ?? null } : null,
    eyesOf: eyesPlayer(scene)?.id ?? 'you',
    lookAt: lookAtFor(scene),
    reveal: scene.answer_overlay ?? null,
  };
}

// Label shown on a player marker.
export function labelFor(player, eyesOfId) {
  if (player.label) return player.label;
  if (player.id === eyesOfId) return 'You';
  if (player.team === 'us') return 'P';
  return player.hand === 'L' ? 'L' : 'R';
}

const near = (a, b, tol = 0.5) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= tol && Math.abs((a.z_in ?? 0) - (b.z_in ?? 0)) <= tol * 12;

// Semantic checks beyond JSON Schema. Returns [{level: 'error'|'warn', msg}].
export function checkScene(scene) {
  const issues = [];
  const err = (msg) => issues.push({ level: 'error', msg });
  const warn = (msg) => issues.push({ level: 'warn', msg });

  const ids = new Set();
  for (const p of scene.players ?? []) {
    if (ids.has(p.id)) err(`duplicate player id ${p.id}`);
    ids.add(p.id);
    if (p.x < -6 || p.x > 26 || p.y < -10 || p.y > 54) warn(`player ${p.id} is far outside the court`);
    const own = p.team === 'us' ? p.y <= COURT.netY : p.y >= COURT.netY;
    if (!own) err(`player ${p.id} is on the wrong side of the net for team ${p.team}`);
  }
  const eyes = eyesPlayer(scene);
  if (!eyes) err('camera.eyes_of does not match any player');
  else if (eyes.team !== 'us') err('first-person cameras are only supported for team "us" (for now)');

  const checkArc = (from, to, opts, label) => {
    const arc = makeArc(from, to, opts);
    if (arc.crosses && opts.net_clearance_in == null) warn(`${label}: crosses the net without net_clearance_in`);
    if (!arc.crosses && opts.apex_in == null && opts.net_clearance_in != null) {
      warn(`${label}: net_clearance_in given but the path does not cross the net`);
    }
    if (arc.warnings.includes('bulge_clamped')) {
      warn(`${label}: requested clearance is lower than a straight line allows; actual ${Math.round(arc.actualClearanceIn)} in`);
    }
    return arc;
  };

  if (scene.ball?.from && scene.ball?.now) {
    checkArc(scene.ball.from, scene.ball.now, scene.ball, 'ball');
    const hitter = scene.ball.hitter_id && playerById(scene, scene.ball.hitter_id);
    if (scene.ball.hitter_id && !hitter) err(`ball.hitter_id ${scene.ball.hitter_id} not found`);
    if (hitter && Math.sign(hitter.y - COURT.netY) !== Math.sign(scene.ball.from.y - COURT.netY)) {
      warn('ball.from is not on the hitter\'s side of the net');
    }
  }

  const segs = scene.timeline?.segments ?? [];
  segs.forEach((s, i) => {
    checkArc(s.from, s.to, s, `timeline segment ${s.id ?? i}`);
    if (i > 0 && !near(segs[i - 1].to, s.from)) warn(`timeline segment ${s.id ?? i} does not start where the previous one ended`);
  });
  if (segs.length && scene.ball?.now && !near(segs[segs.length - 1].to, scene.ball.now, 1.5)) {
    warn('ball.now does not match the end of the timeline');
  }
  const total = segs.reduce((a, s) => a + s.duration_ms, 0);
  if (scene.timeline?.freeze_at_ms != null && scene.timeline.freeze_at_ms > total) {
    err('timeline.freeze_at_ms is after the last segment ends');
  }

  for (const mv of scene.timeline?.movements ?? []) {
    const p = playerById(scene, mv.player_id);
    if (!p) err(`movement for unknown player ${mv.player_id}`);
    else if (facingY(p) === 1 ? mv.to.y > COURT.netY : mv.to.y < COURT.netY) err(`movement takes ${p.id} across the net`);
  }
  return issues;
}
