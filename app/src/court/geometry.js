// Court geometry and small vector helpers.
//
// Coordinate system (see docs/rendering-notes.md):
//   x: across the court, 0 = your left sideline, 20 = your right sideline (feet)
//   y: along the court, 0 = your baseline, 22 = net, 44 = their baseline (feet)
//   z: height above the ground (feet internally; scene files use inches as z_in)
// "us" players face +y. "them" players face -y.

export const COURT = Object.freeze({
  width: 20,
  length: 44,
  netY: 22,
  nearKitchenY: 15,
  farKitchenY: 29,
  centerX: 10,
  netHeightPostFt: 36 / 12,
  netHeightCenterFt: 34 / 12,
  netPostOutsideFt: 1,
  lineWidthFt: 2 / 12,
});

export const inToFt = (inches) => inches / 12;
export const ftToIn = (feet) => feet * 12;

// Net top height at a given x. 36 in at the sidelines, 34 in at the center,
// approximated as a parabolic sag. Outside the sidelines it stays at post height.
export function netHeightFt(x) {
  const half = COURT.width / 2;
  const k = Math.min(1, Math.abs(x - half) / half);
  return COURT.netHeightCenterFt + (COURT.netHeightPostFt - COURT.netHeightCenterFt) * k * k;
}

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a) => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// +1 when the player faces +y (our team), -1 when facing -y (their team).
export const facingY = (player) => (player.team === 'us' ? 1 : -1);

// +1 when the paddle hand sits toward +x, -1 toward -x.
// A right-hander on our team (facing +y) holds the paddle toward +x.
// A right-hander on their team (facing -y) holds it toward -x.
export const paddleSideX = (player) => (player.hand === 'L' ? -1 : 1) * facingY(player);

// -1 for our half (y < 22), +1 for their half.
export const sideOfNet = (y) => (y < COURT.netY ? -1 : 1);

// Compact number formatting for SVG output.
export const f1 = (n) => {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
};
