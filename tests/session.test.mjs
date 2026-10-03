// Session planning without a DOM: batches, no daily cap, sibling spreading,
// due-first order, practice ahead, and recording an unrated answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { planBatch, finalizePending } = await import('../app/src/ui/session.js');
const { indexDeck } = await import('../app/src/deck.js');
const { emptyProgress, recordReview, savePending, PENDING_KEY } = await import('../app/src/store/progress.js');
const { makeScheduler, Rating } = await import('../app/src/srs/scheduler.js');
const { DEFAULT_SETTINGS } = await import('../app/src/store/settings.js');

const deck = JSON.parse(readFileSync(new URL('../app/data/deck.sample.json', import.meta.url)));
const index = indexDeck(deck);
const s = makeScheduler({ enableFuzz: false });
const NOW = new Date('2026-10-01T18:00:00Z');
const minutes = (n) => new Date(NOW.getTime() + n * 60000);

function review(p, id, rating, at) {
  const { state } = s.review(p.cards[id]?.fsrs ?? s.newState(at), rating, at);
  recordReview(p, id, state, { rating, reviewed_at: at.toISOString() });
}

test('no daily cap by default: a first batch holds every new card', () => {
  const plan = planBatch(index, emptyProgress('d'), DEFAULT_SETTINGS, { now: NOW });
  assert.equal(DEFAULT_SETTINGS.newPerDay, null);
  assert.equal(plan.newCount, deck.cards.length);
  assert.equal(plan.items.length, deck.cards.length);
  const firstFour = plan.items.slice(0, 4).map((x) => x.card.principle_id);
  assert.equal(new Set(firstFour).size, 4, 'one variant of each principle before any sibling');
});

test('an optional new-card limit still applies when set', () => {
  const plan = planBatch(index, emptyProgress('d'), { ...DEFAULT_SETTINGS, newPerDay: 2 }, { now: NOW });
  assert.equal(plan.newCount, 2);
  assert.equal(plan.items.length, 2);
});

test('batches respect the batch size, and later batches continue with what is left', () => {
  const p = emptyProgress('d');
  const settings = { ...DEFAULT_SETTINGS, batchSize: 3 };
  const first = planBatch(index, p, settings, { now: NOW });
  assert.equal(first.items.length, 3);
  for (const it of first.items) review(p, it.card.id, Rating.Easy, minutes(-1));
  const second = planBatch(index, p, settings, { now: NOW });
  assert.equal(second.items.length, 3);
  assert.equal(second.items.filter((x) => first.items.some((y) => y.card.id === x.card.id)).length, 0, 'no repeats of graduated cards');
});

test('overdue reviews come first, and a learning card waits until its step is over', () => {
  const p = emptyProgress('d');
  review(p, 'c-dink-fp-1', Rating.Good, new Date(NOW.getTime() - 10 * 86400e3));
  review(p, 'c-dink-fp-1', Rating.Good, new Date(NOW.getTime() - 10 * 86400e3 + 10 * 60000)); // due about 8 days ago
  review(p, 'c-backhands-td-1', Rating.Good, minutes(-5)); // learning: the button said 10 min, so due in 5
  const plan = planBatch(index, p, DEFAULT_SETTINGS, { now: NOW });
  assert.equal(plan.dueCount, 1);
  assert.equal(plan.items[0].card.id, 'c-dink-fp-1', 'most overdue first');
  assert.ok(!plan.items.some((x) => x.card.id === 'c-backhands-td-1'), 'not before its 10 minutes are up');
  const later = planBatch(index, p, DEFAULT_SETTINGS, { now: minutes(6) });
  assert.equal(later.dueCount, 2);
  assert.deepEqual(later.items.slice(0, 2).map((x) => [x.card.id, x.kind]), [['c-dink-fp-1', 'review'], ['c-backhands-td-1', 'review']]);
});

test('practice ahead once nothing is due and every card has been seen', () => {
  const p = emptyProgress('d');
  for (const c of deck.cards) {
    review(p, c.id, Rating.Good, minutes(-60));
    review(p, c.id, Rating.Good, minutes(-50)); // graduated, due in about two days
  }
  const plan = planBatch(index, p, DEFAULT_SETTINGS, { now: NOW });
  assert.equal(plan.practice, true);
  assert.equal(plan.items.length, deck.cards.length);
  assert.ok(plan.items.every((x) => x.kind === 'ahead'));
});

test('an answer left unrated is recorded once, with its suggested rating', () => {
  const app = { index, scheduler: s, progress: emptyProgress('d') };
  savePending({ card_id: 'c-dink-fp-1', rating: Rating.Again, correct: false, choice: 'b', response_ms: 4200, stage: 'A', view: 'first_person', reviewed_at: minutes(-30).toISOString() });
  assert.ok(localStorage.getItem(PENDING_KEY));
  assert.equal(finalizePending(app), true);
  const last = app.progress.logs.at(-1);
  assert.equal(last.auto_rated, true);
  assert.equal(last.rating, Rating.Again);
  assert.equal(localStorage.getItem(PENDING_KEY), null);
  assert.equal(finalizePending(app), false, 'nothing left to record');
});
