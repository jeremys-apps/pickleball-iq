// First-person (or over-the-shoulder) court view, rendered as an SVG string.
//
// Visual aids and why they exist (docs/rendering-notes.md has the geometry):
//   path   Dashed on the far side of the net, solid on yours, and thicker as it
//          nears you. Width comes from real depth, so the taper is perspective,
//          not decoration. The dashed/solid switch marks the net crossing, the
//          one point where comparing ball height to the net is honest.
//   shadow A shadow directly under the ball shows where over the court it is.
//   stalk  A dashed line from the shadow up to the ball with a tick at net
//          height, drawn at the ball's own depth. Near the end of its flight the
//          ball is closer to you than the net, so it appears below the net tape
//          even when it is higher. Ball above the tick = above net height.

import { COURT, netHeightFt, sideOfNet, paddleSideX, facingY, f1, clamp } from './geometry.js';
import { makeCamera, eyePosition, project, clipPolygon, clipSegment, depthOf } from './camera.js';
import { makeArc, sampleArc } from './trajectory.js';
import { labelFor } from './scene.js';
import { renderCss, TOKENS } from './theme.js';

export const DEFAULT_AIDS = Object.freeze({ path: true, shadow: true, stalk: true });

const COURT_LINES = [
  [[0, 0], [20, 0]],
  [[0, 44], [20, 44]],
  [[0, 0], [0, 44]],
  [[20, 0], [20, 44]],
  [[0, 15], [20, 15]],
  [[0, 29], [20, 29]],
  [[10, 0], [10, 15]],
  [[10, 29], [10, 44]],
];

let uidCounter = 0;
const nextUid = () => `fp${(++uidCounter).toString(36)}`;

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ptsAttr = (q) => q.map((p) => `${f1(p.x)},${f1(p.y)}`).join(' ');

function groundRect(x0, y0, x1, y1, z = 0) {
  return [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
}

function lineQuad(a, b, widthFt, z = 0.005) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * (widthFt / 2);
  const ny = (dx / L) * (widthFt / 2);
  return [
    [a[0] + nx, a[1] + ny, z],
    [b[0] + nx, b[1] + ny, z],
    [b[0] - nx, b[1] - ny, z],
    [a[0] - nx, a[1] - ny, z],
  ];
}

function ellipsePts(cx, cy, rx, ry, n = 20, z = 0.01) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z]);
  }
  return out;
}

function poly(cam, pts3, cls, extra = '') {
  const clipped = clipPolygon(cam, pts3);
  if (clipped.length < 3) return '';
  const q = clipped.map((p) => project(cam, p)).filter(Boolean);
  if (q.length < 3) return '';
  return `<polygon class="${cls}" points="${ptsAttr(q)}"${extra}/>`;
}

function segLine(cam, a, b, cls, extra = '') {
  const s = clipSegment(cam, a, b);
  if (!s) return '';
  const p = project(cam, s[0]);
  const q = project(cam, s[1]);
  if (!p || !q) return '';
  return `<line class="${cls}" x1="${f1(p.x)}" y1="${f1(p.y)}" x2="${f1(q.x)}" y2="${f1(q.y)}"${extra}/>`;
}

// Projected polyline(s) from world points, broken wherever a point is clipped.
function polylineRuns(cam, ptsW) {
  const runs = [];
  let cur = [];
  for (const w of ptsW) {
    const p = project(cam, w);
    if (p) cur.push(p);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length > 1);
}

function netMarkup(cam) {
  const xs = [];
  for (let i = 0; i <= 22; i++) xs.push(-1 + i);
  const top = xs.map((x) => [x, COURT.netY, netHeightFt(x)]);
  const tapeLow = xs.map((x) => [x, COURT.netY, netHeightFt(x) - 2 / 12]).reverse();
  const bottom = [[21, COURT.netY, 0.08], [-1, COURT.netY, 0.08]];
  let s = poly(cam, [...top, ...bottom], 'piq-net-mesh');
  s += poly(cam, [...top, ...tapeLow], 'piq-net-tape');
  for (const x of [-1, 21]) {
    const base = [x, COURT.netY, 0];
    const d = depthOf(cam, base);
    if (d <= cam.near) continue;
    const w = clamp((cam.focal * 0.2) / d, 1.5, 6);
    s += segLine(cam, base, [x, COURT.netY, netHeightFt(x) + 0.05], 'piq-net-post', ` stroke-width="${f1(w)}"`);
  }
  return { markup: s, topProjected: top.map((p) => project(cam, p)).filter(Boolean) };
}

// People are drawn as upright billboards anchored at the projected feet. A real
// camera looking down makes verticals converge, so people near the edges would
// lean; upright figures read better and the error is small. Everything else
// (court, ball, net) is projected exactly.
function personMarkup(cam, p, eyesOfId, { skipIfOffscreen = false } = {}) {
  const fy = facingY(p);
  const side = paddleSideX(p);
  const feet = project(cam, [p.x, p.y, 0]);
  const shoulder = project(cam, [p.x, p.y, 4.5]);
  const head = project(cam, [p.x, p.y, 5.15]);
  const chest = project(cam, [p.x, p.y, 3.3]);
  const hand = project(cam, [p.x + side * 1.3, p.y + fy * 0.6, 3.3]);
  const mid = project(cam, [p.x, p.y, 2.5]);
  if (!feet || !shoulder || !head) return '';
  const x = feet.x;
  if (skipIfOffscreen && (x < 0 || x > cam.width || feet.depth < 2)) return '';

  const cls = p.team === 'us' ? 'us' : 'them';
  const wB = (cam.focal * 0.62) / feet.depth;
  const wT = (cam.focal * 0.52) / shoulder.depth;
  const body = [
    { x: x - wB, y: feet.y },
    { x: x + wB, y: feet.y },
    { x: x + wT, y: shoulder.y },
    { x: x - wT, y: shoulder.y },
  ];
  const bodyEl = `<polygon class="piq-player-${cls}" points="${ptsAttr(body)}"/>`;
  const headEl = `<circle class="piq-player-${cls}" cx="${f1(x)}" cy="${f1(head.y)}" r="${f1((cam.focal * 0.42) / head.depth)}"/>`;

  let armEl = '';
  let paddleEl = '';
  let paddleBehind = false;
  if (hand && chest) {
    const px = x + (hand.x - chest.x);
    const sx = Math.sign(hand.x - chest.x) || 1;
    const sy = shoulder.y + (feet.y - shoulder.y) * 0.08;
    const armW = Math.max(1.2, (cam.focal * 0.2) / hand.depth);
    armEl = `<line class="piq-arm-${cls}" x1="${f1(x + sx * wT * 0.8)}" y1="${f1(sy)}" x2="${f1(px)}" y2="${f1(hand.y)}" stroke-width="${f1(armW)}" stroke-linecap="round"/>`;
    paddleEl = `<ellipse class="piq-paddle" cx="${f1(px)}" cy="${f1(hand.y)}" rx="${f1((cam.focal * 0.3) / hand.depth)}" ry="${f1((cam.focal * 0.4) / hand.depth)}"/>`;
    // A paddle held in front of someone facing away from the camera sits behind their body.
    paddleBehind = hand.depth > feet.depth;
  }
  const labelEl =
    mid && wB * 2 >= 12
      ? `<text class="piq-label-${cls}" x="${f1(x)}" y="${f1(mid.y)}" text-anchor="middle" dominant-baseline="central">${esc(labelFor(p, eyesOfId))}</text>`
      : '';
  const behind = paddleBehind ? armEl + paddleEl : '';
  const front = paddleBehind ? '' : armEl + paddleEl;
  return `<g class="piq-person">${behind}${bodyEl}${headEl}${front}${labelEl}</g>`;
}

function trailMarkup(cam, arc, t0, t1, beyond) {
  const res = { far: '', near: '', farDepth: Infinity, nearDepth: Infinity, farPts: [], nearPts: [] };
  if (!arc || t1 <= t0) return res;
  const pieces =
    arc.crosses && arc.tNet > t0 && arc.tNet < t1 ? [[t0, arc.tNet], [arc.tNet, t1]] : [[t0, t1]];
  const k = 0.117 * cam.focal;
  for (const [a, b] of pieces) {
    const isFar = beyond(arc.at((a + b) / 2)[1]);
    const n = Math.max(6, Math.round(32 * (b - a)));
    const ptsW = sampleArc(arc, a, b, n);
    if (isFar) {
      for (const run of polylineRuns(cam, ptsW)) {
        res.far += `<polyline class="piq-path piq-path-far" stroke-width="1.6" points="${ptsAttr(run)}"/>`;
        res.farPts.push(...run);
        for (const p of run) res.farDepth = Math.min(res.farDepth, p.depth);
      }
    } else {
      for (let i = 1; i < ptsW.length; i++) {
        const s = clipSegment(cam, ptsW[i - 1], ptsW[i]);
        if (!s) continue;
        const p = project(cam, s[0]);
        const q = project(cam, s[1]);
        if (!p || !q) continue;
        const w = clamp(k / ((p.depth + q.depth) / 2), 1.5, 6.5);
        res.near += `<line class="piq-path" x1="${f1(p.x)}" y1="${f1(p.y)}" x2="${f1(q.x)}" y2="${f1(q.y)}" stroke-width="${f1(w)}"/>`;
        res.nearPts.push(p, q);
        res.nearDepth = Math.min(res.nearDepth, p.depth, q.depth);
      }
    }
  }
  return res;
}

function ballMarkup(cam, pos, aids) {
  const [x, y, z] = pos;
  let s = '';
  const dbg = {};
  if (aids.shadow) s += poly(cam, ellipsePts(x, y, 0.22, 0.22, 16, 0.01), 'piq-ball-shadow');
  if (aids.stalk) {
    const nh = netHeightFt(x);
    s += segLine(cam, [x, y, 0.01], [x, y, Math.max(z, nh)], 'piq-stalk');
    const a = project(cam, [x - cam.r[0] * 0.35, y - cam.r[1] * 0.35, nh]);
    const b = project(cam, [x + cam.r[0] * 0.35, y + cam.r[1] * 0.35, nh]);
    if (a && b) {
      s += `<line class="piq-tick" x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}"/>`;
      dbg.tick = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  const b = project(cam, pos);
  if (b) {
    s += `<circle class="piq-ball" cx="${f1(b.x)}" cy="${f1(b.y)}" r="${f1(Math.max(2.5, (cam.focal * 0.18) / b.depth))}"/>`;
    dbg.ball = b;
  }
  return { markup: s, dbg };
}

function revealMarkup(cam, frame, uid) {
  const r = frame.reveal;
  if (!r) return '';
  let s = '<g class="piq-reveal">';
  if (r.target) {
    const ring = ellipsePts(r.target.x, r.target.y, r.target.rx_ft ?? 2, r.target.ry_ft ?? 1.2, 28, 0.02);
    s += poly(cam, ring, 'piq-answer-zone');
  }
  if (r.shot?.to) {
    const from =
      r.shot.from && r.shot.from !== 'ball'
        ? r.shot.from
        : frame.ball
          ? { x: frame.ball.pos[0], y: frame.ball.pos[1], z_in: frame.ball.pos[2] * 12 }
          : null;
    if (from) {
      const arc = makeArc(from, r.shot.to, r.shot);
      for (const run of polylineRuns(cam, sampleArc(arc, 0, 1, 28))) {
        s += `<polyline class="piq-answer" points="${ptsAttr(run)}" marker-end="url(#piq-ah-${uid})"/>`;
      }
    }
  }
  for (const mv of r.moves ?? []) {
    const p = frame.players.find((q) => q.id === mv.player_id);
    if (!p) continue;
    const a = project(cam, [p.x, p.y, 0.03]);
    const b = project(cam, [mv.to.x, mv.to.y, 0.03]);
    if (a && b) {
      s += `<polyline class="piq-answer" points="${f1(a.x)},${f1(a.y)} ${f1(b.x)},${f1(b.y)}" marker-end="url(#piq-ah-${uid})"/>`;
    }
  }
  return s + '</g>';
}

function netTopYAt(topProjected, x) {
  const pts = [...topProjected].sort((a, b) => a.x - b.x);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i - 1].x <= x && x <= pts[i].x) {
      const t = (x - pts[i - 1].x) / (pts[i].x - pts[i - 1].x || 1);
      return pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
    }
  }
  return null;
}

// frame: from scene.js frameFromScene() or playback.js frameAt().
// opts: {width, height, mode, aids, uid, embedCss, revealAll, camera, ariaLabel}
export function renderFirstPerson(frame, opts = {}) {
  const width = opts.width ?? 520;
  const height = opts.height ?? 400;
  const mode = opts.mode ?? 'over_shoulder';
  const aids = { ...DEFAULT_AIDS, ...(opts.aids || {}) };
  const uid = opts.uid ?? nextUid();
  const owner = frame.players.find((p) => p.id === frame.eyesOf);
  if (!owner) throw new Error(`renderFirstPerson: no player with id "${frame.eyesOf}"`);

  const eye = eyePosition(owner, mode, opts.camera);
  const cam = makeCamera(eye, frame.lookAt, { width, height }, opts.camera);
  const camSide = sideOfNet(eye[1]);
  const beyond = (y) => sideOfNet(y) !== camSide;

  const parts = [`<rect class="piq-backdrop" x="0" y="0" width="${width}" height="${height}"/>`];
  parts.push(poly(cam, groundRect(-14, -12, 34, 64), 'piq-surround'));
  parts.push(poly(cam, groundRect(0, 0, 20, 44, 0.002), 'piq-surface'));
  parts.push(poly(cam, groundRect(0, COURT.nearKitchenY, 20, COURT.netY, 0.003), 'piq-kitchen'));
  parts.push(poly(cam, groundRect(0, COURT.netY, 20, COURT.farKitchenY, 0.003), 'piq-kitchen'));
  for (const [a, b] of COURT_LINES) parts.push(poly(cam, lineQuad(a, b, COURT.lineWidthFt), 'piq-line'));

  const far = [];
  const nearList = [];
  for (const p of frame.players) {
    if (p.id === frame.eyesOf) continue;
    const markup = personMarkup(cam, p, frame.eyesOf, { skipIfOffscreen: !beyond(p.y) });
    if (markup) (beyond(p.y) ? far : nearList).push({ d: depthOf(cam, [p.x, p.y, 0]), markup });
  }

  const debug = { eye, lookAt: frame.lookAt, camera: cam };
  if (frame.ball) {
    const trail = aids.path
      ? trailMarkup(cam, frame.ball.arc, frame.ball.t0 ?? 0, frame.ball.t1 ?? 1, beyond)
      : { far: '', near: '', farPts: [], nearPts: [] };
    debug.trail = { far: trail.farPts, near: trail.nearPts };
    const ballDepth = depthOf(cam, frame.ball.pos);
    const bm = ballMarkup(cam, frame.ball.pos, aids);
    Object.assign(debug, bm.dbg);
    // The trail is drawn just before the ball so the ball sits on top of its own path.
    if (trail.far) far.push({ d: Math.min(trail.farDepth, ballDepth) + 0.001, markup: trail.far });
    if (trail.near) nearList.push({ d: ballDepth + 0.001, markup: trail.near });
    (beyond(frame.ball.pos[1]) ? far : nearList).push({ d: ballDepth, markup: bm.markup });
  }

  far.sort((a, b) => b.d - a.d).forEach((o) => parts.push(o.markup));
  const net = netMarkup(cam);
  parts.push(net.markup);
  nearList.sort((a, b) => b.d - a.d).forEach((o) => parts.push(o.markup));
  parts.push(revealMarkup(cam, frame, uid));

  if (debug.ball) debug.netTopYAtBall = netTopYAt(net.topProjected, debug.ball.x);

  const css = opts.embedCss
    ? `<style>${renderCss(opts.tokens ?? TOKENS, { useVars: false, revealAll: opts.revealAll })}</style>`
    : '';
  const defs = `<defs><marker id="piq-ah-${uid}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path class="piq-arrowhead" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
  const svg =
    `<svg class="piq-svg piq-fp" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `role="img" aria-label="${esc(opts.ariaLabel ?? 'Court view from your position')}">` +
    css +
    defs +
    parts.join('') +
    '</svg>';
  return { svg, camera: cam, debug };
}

