import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProgress, recordReview, mergeProgress, loadProgress, saveProgress, importProgress, exportProgress, newIntroducedOn, STORAGE_KEY } from '../app/src/store/progress.js';
import { makeScheduler, Rating } from '../app/src/srs/scheduler.js';

const s = makeScheduler({ enableFuzz: false });
const review = (p, id, rating, iso) => {
  const prev = p.cards[id]?.fsrs ?? s.newState(new Date(iso));
  const { state } = s.review(prev, rating, new Date(iso));
  return recordReview(p, id, state, { rating, reviewed_at: iso, correct: rating > 1 });
};

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

test('load creates and persists a fresh store', () => {
  const st = memoryStorage();
  const p = loadProgress(st);
  assert.ok(p.device_id);
  assert.ok(st.getItem(STORAGE_KEY));
  assert.equal(loadProgress(st).device_id, p.device_id);
});

test('merge unions logs and keeps each device id', () => {
  const phone = emptyProgress('phone-aaaaaa');
  const laptop = emptyProgress('laptop-bbbbbb');
  review(phone, 'c-1', Rating.Good, '2026-09-27T12:00:00.000Z');
  review(laptop, 'c-2', Rating.Good, '2026-09-27T20:00:00.000Z');
  const m = mergeProgress(phone, laptop, { replay: s.replay });
  assert.equal(m.device_id, 'phone-aaaaaa');
  assert.equal(m.logs.length, 2);
  assert.ok(m.cards['c-1'] && m.cards['c-2']);
});

test('merge is idempotent and order-independent for card states', () => {
  const a = emptyProgress('aaaaaaaa');
  const b = emptyProgress('bbbbbbbb');
  review(a, 'c-1', Rating.Good, '2026-09-27T12:00:00.000Z');
  review(b, 'c-1', Rating.Good, '2026-09-27T12:20:00.000Z');
  review(b, 'c-1', Rating.Again, '2026-09-29T09:00:00.000Z');
  const ab = mergeProgress(a, b, { replay: s.replay });
  const ba = mergeProgress(b, a, { replay: s.replay });
  const aba = mergeProgress(ab, b, { replay: s.replay });
  assert.deepEqual(ab.cards['c-1'].fsrs, ba.cards['c-1'].fsrs);
  assert.deepEqual(aba.cards, ab.cards);
  assert.equal(ab.logs.length, 3);
  assert.equal(aba.logs.length, 3);
});

test('reviews on two devices are both reflected after merge', () => {
  const a = emptyProgress('aaaaaaaa');
  const b = emptyProgress('bbbbbbbb');
  review(a, 'c-1', Rating.Good, '2026-09-27T12:00:00.000Z');
  review(b, 'c-1', Rating.Again, '2026-09-27T12:30:00.000Z'); // reviewed from a stale copy
  const m = mergeProgress(a, b, { replay: s.replay });
  const expected = s.replay(m.logs.filter((l) => l.card_id === 'c-1'));
  assert.deepEqual(m.cards['c-1'].fsrs, expected);
  assert.equal(m.cards['c-1'].fsrs.reps, 2);
});

test('export and import round trip; bad files are rejected', () => {
  const p = emptyProgress('aaaaaaaa');
  review(p, 'c-1', Rating.Good, '2026-09-27T12:00:00.000Z');
  assert.deepEqual(importProgress(exportProgress(p)), p);
  assert.throws(() => importProgress('{"hello":1}'));
});

test('counts cards introduced today in local time', () => {
  const p = emptyProgress('aaaaaaaa');
  const now = new Date();
  review(p, 'c-1', Rating.Good, now.toISOString());
  review(p, 'c-1', Rating.Good, new Date(now.getTime() + 60000).toISOString());
  assert.equal(newIntroducedOn(p, now), 1);
});
