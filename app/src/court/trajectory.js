// Ball flight model.
//
// Scene files describe shots the way pros talk about them: where the ball was
// struck, where it is now (or where it lands), and how much it cleared the net
// by ("barely cleared", "a floater"). This module turns that into a curve.
//
// Model: x and y move linearly in t; height is a straight line between the
// endpoint heights plus a parabolic bulge 4*h*t*(1-t). This is a gravity-only
// approximation. Real pickleballs lose speed quickly (the holes add drag), so
// real shots drop more steeply late in flight. Phase 5 replaces the height
// profile with a drag model; keep the interface (at, tNet) stable.

import { COURT, netHeightFt, inToFt, ftToIn } from './geometry.js';

const DEFAULT_CLEARANCE_IN = 6;

const toFt3 = (p) => [p.x, p.y, inToFt(p.z_in ?? 0)];

// from, to: {x, y, z_in}. opts: {net_clearance_in} for shots that cross the net,
// or {apex_in} for segments that stay on one side (for example after a bounce).
export function makeArc(from, to, opts = {}) {
  const p0 = toFt3(from);
  const p1 = toFt3(to);
  const crosses = (p0[1] - COURT.netY) * (p1[1] - COURT.netY) < 0;
  const tNet = crosses ? (COURT.netY - p0[1]) / (p1[1] - p0[1]) : null;
  const warnings = [];
  const linAt = (t) => p0[2] * (1 - t) + p1[2] * t;

  let h;
  if (crosses) {
    const clearanceIn = opts.net_clearance_in ?? DEFAULT_CLEARANCE_IN;
    if (opts.net_clearance_in == null) warnings.push('net_clearance_defaulted');
    const xNet = p0[0] + (p1[0] - p0[0]) * tNet;
    const zNet = netHeightFt(xNet) + inToFt(clearanceIn);
    h = (zNet - linAt(tNet)) / (4 * tNet * (1 - tNet));
  } else if (opts.apex_in != null) {
    h = inToFt(opts.apex_in) - (p0[2] + p1[2]) / 2;
  } else {
    h = 0.5;
    warnings.push('apex_defaulted');
  }
  if (h < 0) {
    // A ball path is always concave down. If the straight line already clears
    // more than requested, keep it straight and report the real clearance.
    warnings.push('bulge_clamped');
    h = 0;
  }

  const at = (t) => [
    p0[0] + (p1[0] - p0[0]) * t,
    p0[1] + (p1[1] - p0[1]) * t,
    linAt(t) + 4 * h * t * (1 - t),
  ];

  let actualClearanceIn = null;
  if (crosses) {
    const pn = at(tNet);
    actualClearanceIn = ftToIn(pn[2] - netHeightFt(pn[0]));
  }

  return { p0, p1, h, crosses, tNet, at, warnings, actualClearanceIn };
}

// Sample an arc into n+1 points between t0 and t1.
export function sampleArc(arc, t0, t1, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(arc.at(t0 + ((t1 - t0) * i) / n));
  return out;
}

// Highest point of the arc (useful for side views).
export function apexOf(arc, samples = 48) {
  let best = arc.at(0);
  for (let i = 1; i <= samples; i++) {
    const p = arc.at(i / samples);
    if (p[2] > best[2]) best = p;
  }
  return best;
}
