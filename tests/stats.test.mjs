// Progress statistics: timed-read trends, topic rows weakest first, drills ranked by weakness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { timedTrend, topicStats, drillPlan, median, MIN_TIMED_REVIEWS } from '../app/src/stats.js';
import { indexDeck } from '../app/src/deck.js';
import { emptyProgress, recordReview } from '../app/src/store/progress.js';
import { makeScheduler, Rating } from '../app/src/srs/scheduler.js';

const deck = JSON.parse(readFileSync(new URL('../app/data/deck.sample.json', import.meta.url)));
const index = indexDeck(deck);
const s = makeScheduler({ enableFuzz: false });
const NOW = new Date('2026-10-10T18:00:00Z');
const at = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60000);

function review(p, id, rating, when) {
  const { state } = s.review(p.cards[id]?.fsrs ?? s.newState(when), rating, when);
  recordReview(p, id, state, { rating, reviewed_at: when.toISOString(), correct: rating > 1 });
}

const log = (i, { stage = 'B', ms = 1000, correct = true, choice = 'a' } = {}) => ({
  id: `l${i}`,
  card_id: 'c-occlusion-floater-1',
  rating: correct ? 3 : 1,
  reviewed_at: new Date(NOW.getTime() + i * 60000).toISOString(),
  correct,
  choice,
  response_ms: ms,
  stage,
  view: 'first_person',
  device_id: 'd',
});

test('median', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('timedTrend needs six timed reviews and compares the first and last window', () => {
  assert.equal(timedTrend([]), null);
  assert.equal(MIN_TIMED_REVIEWS, 6);
  const logs = [2000, 1900, 1800, 1200, 1100, 1000].map((ms, i) => log(i, { ms }));
  assert.equal(timedTrend(logs.slice(0, 5)), null, 'five is not enough');
  const t = timedTrend(logs);
  assert.deepEqual([t.n, t.earlyMedianMs, t.lateMedianMs, t.deltaMs, t.timeouts], [6, 1900, 1100, -800, 0]);
  assert.equal(t.earlyAccuracy, 1);
  const w = timedTrend(logs, { window: 2 });
  assert.deepEqual([w.earlyMedianMs, w.lateMedianMs], [1950, 1050]);
});

test('timedTrend ignores stage A and counts timeouts', () => {
  const logs = [
    ...[0, 1, 2].map((i) => log(i, { stage: 'A', ms: 5000 })),
    ...[3, 4, 5, 6, 7, 8].map((i) => log(i, { ms: 1000 })),
    log(9, { ms: 2550, correct: false, choice: null }),
  ];
  const t = timedTrend(logs);
  assert.equal(t.n, 7, 'stage A reviews are left out');
  assert.equal(t.timeouts, 1);
  assert.ok(t.earlyMedianMs <= 1000 && t.lateMedianMs >= 1000);
  assert.equal(timedTrend(logs, { window: 3 }).lateAccuracy, 2 / 3);
});

test('topicStats groups by topic, falls back to category, ignores unknown cards, and sorts weakest first', () => {
  const p = emptyProgress('d');
  review(p, 'c-dink-fp-1', Rating.Good, at(60 * 24 * 3));
  review(p, 'c-dink-fp-1', Rating.Good, at(60 * 24 * 3 - 10)); // graduates to review
  review(p, 'c-dink-fp-1', Rating.Again, at(60 * 24 * 2)); // a lapse on the reset topic (only review cards lapse)
  review(p, 'c-backhands-td-1', Rating.Easy, at(60 * 24 * 3));
  review(p, 'c-backhands-td-1', Rating.Easy, at(60 * 24 * 2));
  p.logs.push({ ...log(99), card_id: 'c-gone-1' }); // a card that left the deck
  const rows = topicStats(index, p, { scheduler: s, now: NOW });
  assert.deepEqual(rows.map((r) => r.topic).sort(), ['reset', 'speed_up', 'targets', 'transition']);
  const reset = rows.find((r) => r.topic === 'reset');
  assert.deepEqual([reset.cards, reset.seen, reset.choiceReviews, reset.accuracy, reset.lapses], [1, 1, 3, 2 / 3, 1]);
  assert.ok(reset.retrievability > 0 && reset.retrievability < 1);
  assert.equal(rows[0].topic, 'reset', 'the lapsed topic is the weakest');
  const unseen = rows.find((r) => r.topic === 'transition');
  assert.deepEqual([unseen.seen, unseen.accuracy, unseen.retrievability, unseen.timed], [0, null, null, null]);
  assert.ok(rows.indexOf(unseen) > rows.indexOf(reset), 'unknown retention sorts after known');
  const stripped = indexDeck({ ...deck, principles: deck.principles.map(({ topic, ...rest }) => rest) });
  assert.deepEqual(topicStats(stripped, p).map((r) => r.topic).sort(), ['drill', 'strategy'], 'without a topic, the category names the row');
  assert.equal(topicStats(index, p).find((r) => r.topic === 'reset').retrievability, null, 'no scheduler, no retention');
});

test('topicStats carries the timed trend of its timed cards', () => {
  const p = emptyProgress('d');
  for (let i = 0; i < 6; i++) p.logs.push(log(i, { ms: 1500 - i * 100 }));
  const speedUp = topicStats(index, p).find((r) => r.topic === 'speed_up');
  assert.equal(speedUp.timed.n, 6);
  assert.ok(speedUp.timed.deltaMs < 0, 'reads got faster');
});

test('drillPlan ranks drills by the weakest thing they train', () => {
  const p = emptyProgress('d');
  const fresh = drillPlan(index, p, { scheduler: s, now: NOW });
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].drill.id, 'p-drop-and-advance');
  assert.equal(fresh[0].trains[0].principle.id, 'p-below-net-reset');
  assert.deepEqual([fresh[0].trains[0].seen, fresh[0].score, fresh[0].weakest], [false, null, null]);
  assert.equal(fresh[0].cards[0].id, 'c-drop-advance-drill-1');
  review(p, 'c-dink-fp-1', Rating.Good, at(60 * 24 * 5));
  review(p, 'c-dink-fp-1', Rating.Again, at(60 * 24 * 4));
  const ranked = drillPlan(index, p, { scheduler: s, now: NOW });
  assert.equal(ranked[0].weakest.principle.id, 'p-below-net-reset');
  assert.ok(ranked[0].score > 0 && ranked[0].score < 1);
  const two = indexDeck({
    ...deck,
    principles: [...deck.principles, { ...deck.principles[3], id: 'p-other-drill', priority: 9, trains: ['p-two-backhands-middle', 'p-missing'] }],
  });
  const plans = drillPlan(two, p, { scheduler: s, now: NOW });
  assert.deepEqual(plans.map((d) => d.drill.id), ['p-drop-and-advance', 'p-other-drill'], 'a known weakness outranks an unseen target');
  assert.equal(plans[1].trains.length, 1, 'unknown principle ids are skipped');
  assert.equal(drillPlan(two, emptyProgress('e'), { scheduler: s, now: NOW })[0].drill.id, 'p-other-drill', 'nothing seen: higher priority first');
});
