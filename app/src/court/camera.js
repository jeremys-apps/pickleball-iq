// Pinhole camera for the first-person view.
// Why over-the-shoulder is the default: when a ball comes straight at you, its
// whole flight lies in a vertical plane through your eyes and projects to a
// vertical line (the arch disappears). Moving the eye a couple of feet to the
// side and back takes it out of that plane. See docs/rendering-notes.md.

import { COURT, sub, dot, cross, normalize, lerp3, facingY, paddleSideX } from './geometry.js';

export const CAMERA_DEFAULTS = Object.freeze({
  eyeHeightFt: 5.3,
  firstPersonBackFt: 0.5,
  overShoulder: Object.freeze({ lateralFt: 2.3, backFt: 2.7, upFt: 0.4 }),
  lookHeightFt: 1.4,
  nearDepthFt: 0.5,
  // Focal length is tied to viewport height so vertical coverage stays constant;
  // wider screens simply see more to the sides.
  focalPerHeight: 0.6,
  centerYRatio: 0.4625,
});

export const CAMERA_MODES = Object.freeze(['over_shoulder', 'first_person']);

export function eyePosition(player, mode, opts = {}) {
  const o = { ...CAMERA_DEFAULTS, ...opts };
  const os = { ...CAMERA_DEFAULTS.overShoulder, ...(opts.overShoulder || {}) };
  const fy = facingY(player);
  if (mode === 'first_person') {
    return [player.x, player.y - fy * o.firstPersonBackFt, o.eyeHeightFt];
  }
  // Offset away from the paddle side so the incoming ball and your paddle stay in view.
  const side = paddleSideX(player);
  return [player.x - side * os.lateralFt, player.y - fy * os.backFt, o.eyeHeightFt + os.upFt];
}

// Default aim: a point on the net plane slightly toward the paddle side of the ball.
// Computed once per card so the camera does not pan during playback.
export function defaultLookAt(player, ballNowFt, opts = {}) {
  const o = { ...CAMERA_DEFAULTS, ...opts };
  const side = paddleSideX(player);
  const x = ballNowFt ? ballNowFt[0] + 0.5 * side : player.x + side;
  return [x, COURT.netY, o.lookHeightFt];
}

export function makeCamera(eye, target, view, opts = {}) {
  const o = { ...CAMERA_DEFAULTS, ...opts };
  const f = normalize(sub(target, eye));
  let r = cross(f, [0, 0, 1]);
  if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = [1, 0, 0];
  r = normalize(r);
  const u = cross(r, f);
  const focal = view.focal ?? view.height * o.focalPerHeight;
  return {
    eye,
    target,
    f,
    r,
    u,
    width: view.width,
    height: view.height,
    cx: view.width / 2,
    cy: view.height * o.centerYRatio,
    focal,
    near: o.nearDepthFt,
  };
}

export const depthOf = (cam, p) => dot(sub(p, cam.eye), cam.f);

// Returns {x, y, depth} in viewport pixels, or null if behind the near plane.
export function project(cam, p) {
  const d = sub(p, cam.eye);
  const z = dot(d, cam.f);
  if (z < cam.near) return null;
  return {
    x: cam.cx + (cam.focal * dot(d, cam.r)) / z,
    y: cam.cy - (cam.focal * dot(d, cam.u)) / z,
    depth: z,
  };
}

// Clip a 3D segment against the near plane. Returns [a, b] or null.
export function clipSegment(cam, a, b) {
  const n = cam.near + 1e-3;
  const da = depthOf(cam, a);
  const db = depthOf(cam, b);
  if (da < n && db < n) return null;
  if (da >= n && db >= n) return [a, b];
  const t = (n - da) / (db - da);
  const m = lerp3(a, b, t);
  return da < n ? [m, b] : [a, m];
}

// Sutherland-Hodgman clip of a 3D polygon against the near plane.
export function clipPolygon(cam, pts) {
  const n = cam.near + 1e-3;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const da = depthOf(cam, a);
    const db = depthOf(cam, b);
    const inA = da >= n;
    const inB = db >= n;
    if (inA) out.push(a);
    if (inA !== inB) out.push(lerp3(a, b, (n - da) / (db - da)));
  }
  return out;
}

export const horizontalHalfFov = (cam) => Math.atan(cam.cx / cam.focal);

// Heading on the ground plane. 0 = looking toward +y, positive = turned toward +x.
export const yawOf = (cam) => Math.atan2(cam.f[0], cam.f[1]);
