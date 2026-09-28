// Spaced repetition via FSRS (ts-fsrs, vendored in app/vendor/ts-fsrs).
//
// Card states are stored JSON-serialized (dates as ISO strings); ts-fsrs accepts
// them back directly. Ratings: 1 Again, 2 Hard, 3 Good, 4 Easy.

import { fsrs, generatorParameters, createEmptyCard, Rating, State } from '../../vendor/ts-fsrs/index.mjs';

export { Rating, State };

const toJSON = (card) => JSON.parse(JSON.stringify(card));

export function makeScheduler({ requestRetention = 0.9, maximumInterval = 365, enableFuzz = true } = {}) {
  const f = fsrs(
    generatorParameters({
      request_retention: requestRetention,
      maximum_interval: maximumInterval,
      enable_fuzz: enableFuzz,
    }),
  );
  return {
    newState(now = new Date()) {
      return toJSON(createEmptyCard(now));
    },
    review(state, rating, now = new Date()) {
      const { card, log } = f.next(state ?? createEmptyCard(now), now, rating);
      return { state: toJSON(card), log: toJSON(log) };
    },
    // Next due date for each rating, for labeling the rating buttons.
    preview(state, now = new Date()) {
      const rec = f.repeat(state ?? createEmptyCard(now), now);
      const out = {};
      for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) out[r] = new Date(rec[r].card.due);
      return out;
    },
    retrievability(state, now = new Date()) {
      if (!state || state.state === State.New) return null;
      return f.get_retrievability(state, now, false);
    },
    // Rebuild a card's state from its review log, oldest first. Used when two
    // devices both reviewed the same card between syncs.
    replay(logs) {
      const sorted = [...logs].sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));
      if (!sorted.length) return null;
      let card = createEmptyCard(new Date(sorted[0].reviewed_at));
      for (const l of sorted) card = f.next(card, new Date(l.reviewed_at), l.rating).card;
      return toJSON(card);
    },
  };
}

// Suggested rating from what happened. The user can always override.
//   Wrong or timed out: Again.
//   Correct but flagged as a guess: Hard.
//   Correct with a response clock: Easy if fast, Good if comfortable, Hard if late.
export function suggestRating({ correct, guessed = false, responseMs = null, windowMs = null }) {
  if (!correct) return Rating.Again;
  if (guessed) return Rating.Hard;
  if (windowMs && responseMs != null) {
    const r = responseMs / windowMs;
    if (r <= 0.4) return Rating.Easy;
    if (r <= 0.8) return Rating.Good;
    return Rating.Hard;
  }
  return Rating.Good;
}

// Aid fading. Support is generous while a card is new and is withdrawn as it
// matures, so recognition stops depending on crutches the court won't give you.
//   A  new or relearning: first person + labeled top-down, all aids, untimed,
//      slow-motion playback
//   B  in review: first person + mini-map, all aids, clock at 1.33x the scene window
//   C  mature (interval of 21 days or more): first person only, shadow only,
//      real speed, clock at 0.85x the scene window
export const STAGES = Object.freeze({
  A: Object.freeze({ id: 'A', panel: 'top_down', aids: { path: true, shadow: true, stalk: true }, windowScale: null, speed: 0.6 }),
  B: Object.freeze({ id: 'B', panel: 'mini', aids: { path: true, shadow: true, stalk: true }, windowScale: 4 / 3, speed: 0.85 }),
  C: Object.freeze({ id: 'C', panel: null, aids: { path: false, shadow: true, stalk: false }, windowScale: 0.85, speed: 1 }),
});

export const MATURE_DAYS = 21;

// The "On mature cards" setting. 'fade' (default) uses stage C as defined above.
// 'map' keeps the mini-map; 'all' keeps every aid and the mini-map. Real speed and
// the shorter response window apply either way, because those are match-like.
export const MATURE_AID_CHOICES = Object.freeze(['fade', 'map', 'all']);

export function applyAidPreference(stage, pref = 'fade') {
  if (stage.id !== 'C' || pref === 'fade') return stage;
  if (pref === 'map') return { ...stage, panel: 'mini' };
  if (pref === 'all') return { ...stage, panel: 'mini', aids: { ...STAGES.B.aids } };
  return stage;
}

export function stageFor(state) {
  if (!state || state.state === State.New || state.state === State.Learning || state.state === State.Relearning) {
    return STAGES.A;
  }
  return state.scheduled_days >= MATURE_DAYS ? STAGES.C : STAGES.B;
}

export function isDue(state, now = new Date()) {
  return !!state && state.state !== State.New && new Date(state.due) <= now;
}
