// Top-down court view. Two variants share one renderer:
//   full  Labeled players, paddle-hand dots, optional backhand markers. Used for
//         learning the geometry and for the answer reveal.
//   mini  The mini-map: dots only, plus the camera position and field of view,
//         so you can connect the first-person picture to the court.
// Your baseline is at the bottom, so left and right match the first-person view.

import { COURT, facingY, paddleSideX, f1, netHeightFt } from './geometry.js';
import { sampleArc, apexOf } from './trajectory.js';
import { yawOf, horizontalHalfFov } from './camera.js';
import { labelFor } from './scene.js';
import { renderCss, TOKENS } from './theme.js';

let uidCounter = 0;
const nextUid = () => `td${(++uidCounter).toString(36)}`;

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function trackRuns(arc, t0, t1, X, Y) {
  // Ground track of the ball, split at the net: [{far: bool, points: "x,y ..."}]
  const pieces = arc.crosses && arc.tNet > t0 && arc.tNet < t1 ? [[t0, arc.tNet], [arc.tNet, t1]] : [[t0, t1]];
  return pieces.map(([a, b]) => {
    const pts = sampleArc(arc, a, b, 12);
    return {
      far: arc.at((a + b) / 2)[1] > COURT.netY,
      points: pts.map((p) => `${f1(X(p[0]))},${f1(Y(p[1]))}`).join(' '),
    };
  });
}

function contentYs(frame, camera, includeReveal) {
  const ys = frame.players.map((p) => p.y);
  if (frame.ball?.arc) for (const p of sampleArc(frame.ball.arc, frame.ball.t0 ?? 0, frame.ball.t1 ?? 1, 8)) ys.push(p[1]);
  for (const tr of frame.trails ?? []) for (const p of sampleArc(tr.arc, tr.t0 ?? 0, tr.t1 ?? 1, 8)) ys.push(p[1]);
  if (camera) ys.push(camera.eye[1]);
  const r = includeReveal ? frame.reveal : null;
  if (r?.target) ys.push(r.target.y + (r.target.ry_ft ?? 1.2), r.target.y - (r.target.ry_ft ?? 1.2));
  if (r?.shot?.to) ys.push(r.shot.to.y);
  for (const mv of r?.moves ?? []) ys.push(mv.to.y);
  return ys;
}

// opts: {variant: 'full'|'mini', scale, crop: 'auto', cropIncludesReveal, camera (from renderFirstPerson), wedgeLengthFt,
//        showBackhand, embedCss, revealAll, uid, ariaLabel}
export function renderTopDown(frame, opts = {}) {
  const mini = opts.variant === 'mini';
  const s = opts.scale ?? (mini ? 3 : 8);
  const m = mini ? 1.5 : 2.5;
  // crop: 'auto' trims the court to the players, ball and (optionally) the answer,
  // so a top-down view fits a phone screen without scrolling.
  let yTop = COURT.length + m;
  let yBot = -m;
  if (opts.crop === 'auto') {
    const ys = contentYs(frame, opts.camera, opts.cropIncludesReveal ?? true);
    if (ys.length) {
      yTop = Math.min(yTop, Math.max(...ys) + 3);
      yBot = Math.max(yBot, Math.min(...ys) - 3);
    }
  }
  const W = (COURT.width + 2 * m) * s;
  const H = (yTop - yBot) * s;
  const X = (x) => (x + m) * s;
  const Y = (y) => (yTop - y) * s;
  const uid = opts.uid ?? nextUid();
  const lw = Math.max(1, s * COURT.lineWidthFt);
  const out = [];

  out.push(`<rect class="piq-surround" x="0" y="0" width="${f1(W)}" height="${f1(H)}" rx="${mini ? 4 : 8}"/>`);
  out.push(`<rect class="piq-surface" x="${f1(X(0))}" y="${f1(Y(44))}" width="${f1(20 * s)}" height="${f1(44 * s)}"/>`);
  out.push(`<rect class="piq-kitchen" x="${f1(X(0))}" y="${f1(Y(29))}" width="${f1(20 * s)}" height="${f1(14 * s)}"/>`);
  out.push(`<rect class="piq-td-line" x="${f1(X(0))}" y="${f1(Y(44))}" width="${f1(20 * s)}" height="${f1(44 * s)}" stroke-width="${f1(lw)}"/>`);
  for (const y of [COURT.nearKitchenY, COURT.farKitchenY]) {
    out.push(`<line class="piq-td-line" x1="${f1(X(0))}" y1="${f1(Y(y))}" x2="${f1(X(20))}" y2="${f1(Y(y))}" stroke-width="${f1(lw)}"/>`);
  }
  out.push(`<line class="piq-td-line" x1="${f1(X(10))}" y1="${f1(Y(0))}" x2="${f1(X(10))}" y2="${f1(Y(15))}" stroke-width="${f1(lw)}"/>`);
  out.push(`<line class="piq-td-line" x1="${f1(X(10))}" y1="${f1(Y(29))}" x2="${f1(X(10))}" y2="${f1(Y(44))}" stroke-width="${f1(lw)}"/>`);
  out.push(`<line class="piq-td-net" x1="${f1(X(-1))}" y1="${f1(Y(22))}" x2="${f1(X(21))}" y2="${f1(Y(22))}" stroke-width="${mini ? 1.6 : 3}"/>`);

  if (opts.camera) {
    const cam = opts.camera;
    const yaw = yawOf(cam);
    const half = horizontalHalfFov(cam);
    const L = opts.wedgeLengthFt ?? 12;
    const e = cam.eye;
    const a = [e[0] + L * Math.sin(yaw - half), e[1] + L * Math.cos(yaw - half)];
    const b = [e[0] + L * Math.sin(yaw + half), e[1] + L * Math.cos(yaw + half)];
    out.push(`<polygon class="piq-fov" points="${f1(X(e[0]))},${f1(Y(e[1]))} ${f1(X(a[0]))},${f1(Y(a[1]))} ${f1(X(b[0]))},${f1(Y(b[1]))}"/>`);
  }

  // Finished shots stay as trails; the answer ball's path is the green reveal line.
  const tracks = [...(frame.trails ?? [])];
  if (frame.ball?.arc && !frame.ball.answer) tracks.push({ arc: frame.ball.arc, t0: frame.ball.t0 ?? 0, t1: frame.ball.t1 ?? 1 });
  for (const tr of tracks) {
    for (const run of trackRuns(tr.arc, tr.t0 ?? 0, tr.t1 ?? 1, X, Y)) {
      out.push(
        `<polyline class="piq-path${run.far ? ' piq-path-far' : ''}" stroke-width="${run.far ? (mini ? 1 : 1.6) : mini ? 1.5 : 2.6}" points="${run.points}"/>`,
      );
    }
  }

  for (const p of frame.players) {
    const cls = p.team === 'us' ? 'us' : 'them';
    const r = mini ? Math.max(3, 0.9 * s) : Math.max(11, 1.35 * s);
    if (!mini) {
      const side = paddleSideX(p);
      out.push(`<circle class="piq-paddle" cx="${f1(X(p.x + side * 1.9))}" cy="${f1(Y(p.y))}" r="${f1(Math.max(1.8, 0.33 * s))}"/>`);
    }
    out.push(`<circle class="piq-player-${cls}" cx="${f1(X(p.x))}" cy="${f1(Y(p.y))}" r="${f1(r)}"/>`);
    if (!mini) {
      out.push(
        `<text class="piq-label-${cls}" x="${f1(X(p.x))}" y="${f1(Y(p.y))}" text-anchor="middle" dominant-baseline="central">${esc(labelFor(p, frame.eyesOf))}</text>`,
      );
      if (opts.showBackhand && p.team === 'them') {
        const side = paddleSideX(p);
        const fy = facingY(p);
        out.push(
          `<text class="piq-annot" x="${f1(X(p.x - side * 1.9))}" y="${f1(Y(p.y - fy * 2.4))}" text-anchor="middle" dominant-baseline="central">BH</text>`,
        );
      }
    }
  }

  if (frame.ball) {
    const [bx, by] = frame.ball.pos;
    out.push(`<circle class="piq-ball" cx="${f1(X(bx))}" cy="${f1(Y(by))}" r="${f1(mini ? Math.max(2, 0.4 * s) : Math.max(4, 0.45 * s))}"/>`);
  }

  if (opts.camera) {
    const e = opts.camera.eye;
    out.push(`<circle class="piq-cam" cx="${f1(X(e[0]))}" cy="${f1(Y(e[1]))}" r="${f1(Math.max(2.2, 0.35 * s))}"/>`);
  }

  const r = frame.reveal;
  if (r) {
    let g = '<g class="piq-reveal">';
    if (r.target) {
      g += `<ellipse class="piq-answer-zone" cx="${f1(X(r.target.x))}" cy="${f1(Y(r.target.y))}" rx="${f1((r.target.rx_ft ?? 2) * s)}" ry="${f1((r.target.ry_ft ?? 1.2) * s)}"/>`;
    }
    if (r.shot?.to) {
      // From the contact point, not the ball in this frame (see first-person.js).
      const c = frame.contact;
      const from = r.shot.from && r.shot.from !== 'ball' ? r.shot.from : c ? { x: c[0], y: c[1] } : frame.ball ? { x: frame.ball.pos[0], y: frame.ball.pos[1] } : null;
      const t1 = r.shot_t ?? 1;
      if (from && t1 > 0) {
        // The ground track is straight, so a partly flown shot ends part way along it.
        const to = { x: from.x + (r.shot.to.x - from.x) * t1, y: from.y + (r.shot.to.y - from.y) * t1 };
        g += `<line class="piq-answer" x1="${f1(X(from.x))}" y1="${f1(Y(from.y))}" x2="${f1(X(to.x))}" y2="${f1(Y(to.y))}" stroke-width="${mini ? 1.5 : 2.5}" marker-end="url(#piq-ah-${uid})"/>`;
      }
    }
    for (const mv of r.moves ?? []) {
      const p = frame.players.find((q) => q.id === mv.player_id);
      if (p) {
        g += `<line class="piq-answer" x1="${f1(X(p.x))}" y1="${f1(Y(p.y))}" x2="${f1(X(mv.to.x))}" y2="${f1(Y(mv.to.y))}" stroke-width="${mini ? 1.5 : 2.5}" marker-end="url(#piq-ah-${uid})"/>`;
      }
    }
    out.push(g + '</g>');
  }

  const css = opts.embedCss
    ? `<style>${renderCss(opts.tokens ?? TOKENS, { useVars: false, revealAll: opts.revealAll })}</style>`
    : '';
  const defs = `<defs><marker id="piq-ah-${uid}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path class="piq-arrowhead" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
  const svg =
    `<svg class="piq-svg piq-td${mini ? ' piq-td-mini' : ''}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f1(W)} ${f1(H)}" role="img" ` +
    `aria-label="${esc(opts.ariaLabel ?? (mini ? 'Mini-map' : 'Top-down court view'))}">${css}${defs}${out.join('')}</svg>`;
  return { svg, width: W, height: H };
}

// Side view of the ball's height against the net. Useful where no first-person
// view is shown (for example a top-down-only card on a small screen).
export function renderSideView(frame, opts = {}) {
  const W = opts.width ?? 320;
  const H = opts.height ?? 110;
  const arc = frame.ball?.arc;
  const css = opts.embedCss ? `<style>${renderCss(opts.tokens ?? TOKENS, { useVars: false })}</style>` : '';
  const open = `<svg class="piq-svg piq-side" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Side view of ball height versus the net">${css}`;
  if (!arc) return { svg: `${open}</svg>` };

  const pad = 12;
  const yLo = Math.min(arc.p0[1], arc.p1[1], COURT.netY) - 1.5;
  const yHi = Math.max(arc.p0[1], arc.p1[1], COURT.netY) + 1.5;
  const zHi = Math.max(apexOf(arc)[2], 4) + 0.6;
  const sx = (W - 2 * pad) / (yHi - yLo);
  const sz = (H - 2 * pad - 14) / zHi;
  const PX = (y) => pad + (y - yLo) * sx; // your side on the left
  const PY = (z) => H - pad - 14 - z * sz;
  const ground = PY(0);
  const t1 = frame.ball.t1 ?? 1;
  const netX = PX(COURT.netY);
  const [bx, , bz] = frame.ball.pos;
  const nh = netHeightFt(bx);

  let g = `<rect class="piq-backdrop" x="0" y="0" width="${W}" height="${H}" rx="8"/>`;
  g += `<rect class="piq-surround" x="0" y="${f1(ground)}" width="${W}" height="${f1(H - ground)}"/>`;
  g += `<line class="piq-annot-line" x1="${pad}" y1="${f1(PY(nh))}" x2="${W - pad}" y2="${f1(PY(nh))}" stroke-width="1" stroke-dasharray="3 3"/>`;
  g += `<line class="piq-td-net" x1="${f1(netX)}" y1="${f1(ground)}" x2="${f1(netX)}" y2="${f1(PY(nh))}" stroke-width="3"/>`;
  const pts = sampleArc(arc, 0, t1, 32);
  const split = arc.crosses && arc.tNet < t1 ? Math.round((arc.tNet / t1) * 32) : null;
  const toStr = (arr) => arr.map((p) => `${f1(PX(p[1]))},${f1(PY(p[2]))}`).join(' ');
  if (split != null) {
    g += `<polyline class="piq-path piq-path-far" stroke-width="1.6" points="${toStr(pts.slice(0, split + 1))}"/>`;
    g += `<polyline class="piq-path" stroke-width="2.6" points="${toStr(pts.slice(split))}"/>`;
  } else {
    g += `<polyline class="piq-path${arc.p0[1] > COURT.netY ? ' piq-path-far' : ''}" stroke-width="2" points="${toStr(pts)}"/>`;
  }
  g += `<circle class="piq-ball" cx="${f1(PX(frame.ball.pos[1]))}" cy="${f1(PY(bz))}" r="5"/>`;
  g += `<text class="piq-annot" x="${f1(netX + 6)}" y="${f1(PY(nh) - 7)}">Net ${Math.round(nh * 12)} in</text>`;
  g += `<text class="piq-annot" x="${pad}" y="${H - 6}">Ball ${Math.round(bz * 12)} in</text>`;
  g += `<text class="piq-annot" x="${W - pad}" y="${H - 6}" text-anchor="end">Their side</text>`;
  return { svg: `${open}${g}</svg>` };
}
