# Rendering notes

How scenes become pictures. The renderer is deterministic: the same scene always
draws the same SVG, which is what makes Claude-generated scenes checkable.

## Coordinates

Feet, from your side. `x` runs 0 to 20 from your left sideline to your right,
`y` runs 0 to 44 from your baseline to theirs, the net is at `y = 22` and the
kitchen lines at 15 and 29. Heights are stored in inches (`z_in`) because pros
talk about heights that way, and converted to feet internally. The net is 36 in
at the posts and 34 in at the center; `netHeightFt(x)` interpolates linearly.
Players carry `team` (`us` or `them`) and `hand` (`R` or `L`); paddle side and
backhand side follow from which way the team faces (`geometry.js`).

## Camera

A pinhole camera (`camera.js`). The eye sits at your position at eye height;
the over-the-shoulder mode moves it 2.3 ft to the side away from your paddle,
2.7 ft back and 0.4 ft up. The focal length is 0.6 times the view height and the
principal point sits slightly above center (0.4625 of the height), which puts the
far baseline comfortably below the top edge. Geometry is clipped against a near
plane at 0.5 ft: polygons with Sutherland-Hodgman, segments individually, so the
court floor and nearby players never flip behind the eye.

The camera aims at one fixed point per card (`lookAtFor` in `scene.js`), computed
from the static scene, so animated playback never pans.

**Why over the shoulder.** A ball coming straight at your eyes stays on the line
of sight, so its projection barely moves: the whole arc collapses into a short
vertical smear and its height becomes unreadable. Moving the eye sideways and
back takes the eye out of the ball's plane of flight and restores the arc. True
first person is still available for lessons about the view in front of your face.

## Reading height

Perspective makes height ambiguous: a ball 40 in high far away projects near the
net tape, while a ball 12 in high close to you can appear above it. Three aids
resolve it. The **shadow** marks the ball's ground position. The dashed **stalk**
joins ball and shadow. A short **tick** on the stalk marks net height at that
spot, so "above the tick" means above net height, independent of perspective.
Tests assert that a floater reads above net height and a dropping dink below it
from both cameras.

## Players and paths

Players are billboards: upright figures with a head, torso, arms and a paddle on
the correct side, scaled by depth and always facing the camera. A near-side
player whose feet project off-screen is skipped rather than drawn as a giant
fragment. The ball path is sampled from the arc, drawn dashed on their side of
the net and solid on yours, with stroke width tapered by depth. Draw order is
depth-sorted in two groups split by the net, so far-side objects never overlap
near-side ones incorrectly.

## Ball flight model

`trajectory.js`. Horizontal position moves linearly with the parameter `t`.
Height is the straight line between the endpoint heights plus a parabolic bulge:

```
z(t) = z0 (1 - t) + z1 t + 4 h t (1 - t)
```

For a shot that crosses the net, `h` is solved so the ball clears the net by
`net_clearance_in` at the crossing point `tNet`. For a segment on one side (after
a bounce), `h` comes from `apex_in`. The bulge is clamped at zero: if the straight
line already clears more than requested, the path stays straight and the actual
clearance is reported (`actualClearanceIn`, which `tools/check-scenes.mjs` compares
with the request).

This is gravity-only. Real pickleballs lose speed quickly because of their holes,
so real shots drop more steeply late in flight. Phase 5 (T-3) should replace the
height profile with a drag model, for example quadratic drag integrated
numerically and fitted so a drive loses a realistic share of its speed across
the court, while keeping the `at(t)` and `tNet` interface.

## Mirroring

`mirror.js` reflects a scene across the center line: every x becomes `20 - x`
(players, ball, camera aim, answer overlay, timeline shots and movements) and
every player's handedness swaps, including an explicit `R` or `L` label. Because
the camera's position and aim derive from the player's paddle side and the ball,
the camera flips shoulders too, and with the principal point at the screen center
the whole picture is an exact mirror image (`tests/mirror.test.mjs` checks screen
positions). A reflection preserves forehand, backhand, middle and sideline
relations, so the correct answer is unchanged. Text can break the symmetry
("their righty" names a hand that swaps), which is why only cards marked
`mirrorable`, with no word starting with left or right, are mirrored. In a
mirrored card you are drawn with the other hand as well; that is what keeps
every tactic valid.

## Views

`top-down.js` draws the full court or a mini-map, with backhand labels, the
camera's field of view as a wedge, and the answer overlay. `crop: 'auto'` trims
the court to the players, ball, camera and (optionally) the answer, so the map
fits a phone screen. `renderSideView` shows heights against the net for the lab.

## Playback

`playback.js` compiles a scene's timeline into chained segments. `frameAt` is a
pure function from time to frame (ball position, trail, player positions), which
keeps animation testable. `createPlayer` drives it with `requestAnimationFrame`,
applies the stage speed, stops at `freeze_at_ms`, and honors reduced motion by
freezing immediately. The stage's `freezeLeadMs` pulls that stop earlier than
`freeze_at_ms`, clamped so at least `MIN_FLIGHT_MS` of the last shot is shown
and never later than authored; `play(0, { toEnd: true })` runs through to the
end of the timeline for the reveal after an answer.

## Performance

Each animation frame rebuilds the SVG through `innerHTML`. With these scene sizes
that is comfortably fast on current phones. If older devices stutter, keep the
static court in one layer and update only the ball, shadow and trail elements.
