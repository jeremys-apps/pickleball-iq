// Left-right mirroring. Reflects every position across the court's center line
// (x becomes 20 - x) and swaps every player's handedness. A reflection keeps
// every forehand, backhand, middle and sideline relation, so a mirrored card is
// the same tactic seen from the other side of the court.
//
// Only cards marked mirrorable, whose text never names a side, are mirrored:
// "their righty" or "on your left" would be false in the mirror image. The
// first showing is as authored; after that the pictures alternate.

import { COURT } from './geometry.js';

const round3 = (v) => Math.round(v * 1000) / 1000;
const flipPoint = (p) => (p && typeof p === 'object' && typeof p.x === 'number' ? { ...p, x: round3(COURT.width - p.x) } : p);
const swapHand = (v) => (v === 'R' ? 'L' : v === 'L' ? 'R' : v);
const flipKey = (obj, key) => {
  if (obj && obj[key] !== undefined) obj[key] = flipPoint(obj[key]);
};

export function mirrorScene(scene) {
  const s = structuredClone(scene);
  s.players = s.players.map((p) => {
    const q = { ...flipPoint(p), hand: swapHand(p.hand) };
    if (p.label != null) q.label = swapHand(p.label); // an explicit "R" or "L" label flips too
    return q;
  });
  flipKey(s.ball, 'from');
  flipKey(s.ball, 'now');
  flipKey(s.camera, 'look_at');
  const ao = s.answer_overlay;
  if (ao) {
    flipKey(ao, 'target');
    flipKey(ao.shot, 'from'); // may be the string "ball", which stays as is
    flipKey(ao.shot, 'to');
    if (ao.moves) ao.moves = ao.moves.map((m) => ({ ...m, to: flipPoint(m.to) }));
  }
  if (s.timeline) {
    if (s.timeline.segments) s.timeline.segments = s.timeline.segments.map((g) => ({ ...g, from: flipPoint(g.from), to: flipPoint(g.to) }));
    if (s.timeline.movements) s.timeline.movements = s.timeline.movements.map((m) => ({ ...m, to: flipPoint(m.to) }));
  }
  return s;
}

// Any word starting with left or right (lefty, righties, right-handed, and also
// "right" meaning correct) or southpaw. Cards meant to mirror say "correct" or
// "best" instead. pipeline/piq.py applies the same rule when validating.
export const SIDE_WORDS = /\b(?:left|right)|southpaw/i;

export function cardText(card) {
  const parts = [card.prompt, card.explanation, card.answer, card.focus_cue];
  for (const o of card.options ?? []) parts.push(o.text, o.feedback);
  return parts.filter(Boolean).join(' ');
}

export const canMirror = (card) => !!card?.mirrorable && !!card.scene_id && !SIDE_WORDS.test(cardText(card));

// Alternate reviews: as authored when the card has an even number of reviews, mirrored when odd.
export const shouldMirror = (card, state) => canMirror(card) && (state?.reps ?? 0) % 2 === 1;
