import test from 'node:test';
import assert from 'node:assert/strict';
import { makeScheduler, suggestRating, stageFor, isDue, Rating, State } from '../app/src/srs/scheduler.js';

const t0 = new Date('2026-09-27T12:00:00Z');

test('new card goes to learning, then review', () => {
  const s = makeScheduler({ enableFuzz: false });
  let st = s.newState(t0);
  assert.equal(st.state, State.New);
  st = s.review(st, Rating.Good, t0).state;
  assert.equal(st.state, State.Learning);
  st = s.review(st, Rating.Good, new Date(st.due)).state;
  assert.equal(st.state, State.Review);
  assert.ok(st.scheduled_days >= 1);
});

test('states survive a JSON round trip', () => {
  const s = makeScheduler({ enableFuzz: false });
  const st = JSON.parse(JSON.stringify(s.review(s.newState(t0), Rating.Easy, t0).state));
  const next = s.review(st, Rating.Good, new Date('2026-10-20T12:00:00Z')).state;
  assert.ok(new Date(next.due) > new Date('2026-10-20T12:00:00Z'));
});

test('replaying a log reproduces the live state', () => {
  const s = makeScheduler({ enableFuzz: false });
  let st = s.newState(t0);
  const logs = [];
  const times = ['2026-09-27T12:00:00Z', '2026-09-27T12:15:00Z', '2026-09-30T08:00:00Z'];
  const ratings = [Rating.Good, Rating.Good, Rating.Hard];
  times.forEach((t, i) => {
    st = s.review(st, ratings[i], new Date(t)).state;
    logs.push({ reviewed_at: new Date(t).toISOString(), rating: ratings[i] });
  });
  assert.deepEqual(s.replay(logs), st);
});

test('rating suggestions', () => {
  assert.equal(suggestRating({ correct: false }), Rating.Again);
  assert.equal(suggestRating({ correct: true, guessed: true }), Rating.Hard);
  assert.equal(suggestRating({ correct: true }), Rating.Good);
  assert.equal(suggestRating({ correct: true, responseMs: 900, windowMs: 3000 }), Rating.Easy);
  assert.equal(suggestRating({ correct: true, responseMs: 2000, windowMs: 3000 }), Rating.Good);
  assert.equal(suggestRating({ correct: true, responseMs: 2900, windowMs: 3000 }), Rating.Hard);
});

test('aid fading stages', () => {
  assert.equal(stageFor(undefined).id, 'A');
  assert.equal(stageFor({ state: State.Review, scheduled_days: 5 }).id, 'B');
  assert.equal(stageFor({ state: State.Review, scheduled_days: 30 }).id, 'C');
  assert.equal(stageFor({ state: State.Relearning, scheduled_days: 0 }).id, 'A');
  assert.equal(isDue({ state: State.Review, due: '2026-09-01T00:00:00Z' }, t0), true);
  assert.equal(isDue(undefined, t0), false);
});

import { applyAidPreference, STAGES as S } from '../app/src/srs/scheduler.js';

test('mature-card aid preference changes only mature cards, and never speed or clock', () => {
  assert.equal(applyAidPreference(S.B, 'all'), S.B);
  assert.equal(applyAidPreference(S.C, 'fade'), S.C);
  const map = applyAidPreference(S.C, 'map');
  assert.equal(map.panel, 'mini');
  assert.equal(map.aids.path, false);
  const all = applyAidPreference(S.C, 'all');
  assert.deepEqual(all.aids, S.B.aids);
  assert.equal(all.panel, 'mini');
  assert.equal(all.speed, S.C.speed);
  assert.equal(all.windowScale, S.C.windowScale);
});
