// People on a device: names become ids, each person has their own record and
// unrated answer, the first person on an upgraded device adopts the old record,
// and nothing of one person ever merges into another.
import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, loadPeople, savePeople, addPerson, setCurrent, removePerson, currentPerson, hasLegacyProgress, adoptLegacyProgress } from '../app/src/store/people.js';
import {
  emptyProgress,
  recordReview,
  loadProgress,
  saveProgress,
  mergeProgress,
  importProgress,
  exportProgress,
  savePending,
  takePending,
  progressKey,
  pendingKey,
  deviceId,
  STORAGE_KEY,
  PENDING_KEY,
  DEVICE_KEY,
} from '../app/src/store/progress.js';
import { makeScheduler, Rating } from '../app/src/srs/scheduler.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const s = makeScheduler({ enableFuzz: false });
const review = (p, id, rating, iso) => {
  const { state } = s.review(p.cards[id]?.fsrs ?? s.newState(new Date(iso)), rating, new Date(iso));
  return recordReview(p, id, state, { rating, reviewed_at: iso, correct: rating > 1 });
};

test('a name becomes a plain id, the same on every device', () => {
  assert.equal(slugify('Jeremy'), 'jeremy');
  assert.equal(slugify('  Mary Ann '), 'mary-ann');
  assert.equal(slugify('José'), 'jose');
  assert.equal(slugify('Ben!'), 'ben');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify('a'.repeat(50)).length, 40);
});

test('the registry adds, finds, switches and removes people, and always has a current one', () => {
  const st = memoryStorage();
  assert.deepEqual(loadPeople(st), { current: null, people: [] });
  let { reg, person, created } = addPerson(loadPeople(st), 'Jeremy');
  assert.equal(created, true);
  assert.equal(person.id, 'jeremy');
  reg = setCurrent(reg, 'jeremy');
  ({ reg, person, created } = addPerson(reg, 'jeremy '));
  assert.equal(created, false, 'the same name is the same person');
  assert.equal(reg.people.length, 1);
  ({ reg } = addPerson(reg, 'Anna'));
  savePeople(reg, st);
  const back = loadPeople(st);
  assert.deepEqual(
    back.people.map((p) => p.id),
    ['jeremy', 'anna'],
  );
  assert.equal(currentPerson(back).name, 'Jeremy');
  assert.throws(() => removePerson(back, 'jeremy', st), /Switch to someone else/);
  assert.throws(() => addPerson(back, '!!!'), /plain letter or digit/);
  assert.throws(() => setCurrent(back, 'nobody'));
  // Anna's record on this device goes with her.
  saveProgress(emptyProgress('dev', '', 'anna'), st);
  savePending({ person_id: 'anna', card_id: 'c-1' }, st);
  const after = removePerson(back, 'anna', st);
  assert.deepEqual(
    after.people.map((p) => p.id),
    ['jeremy'],
  );
  assert.equal(st.getItem(progressKey('anna')), null);
  assert.equal(st.getItem(pendingKey('anna')), null);
  savePeople({ current: 'gone', people: after.people }, st);
  assert.equal(loadPeople(st).current, 'jeremy', 'a missing current falls back to the first person');
});

test('each person has their own record and unrated answer on a device, which has one id', () => {
  const st = memoryStorage();
  const j = loadProgress(st, 'jeremy');
  const a = loadProgress(st, 'anna');
  assert.equal(j.person_id, 'jeremy');
  assert.equal(a.person_id, 'anna');
  assert.equal(j.device_id, a.device_id, 'one device id, shared by every record on the device');
  assert.equal(st.getItem(DEVICE_KEY), j.device_id);
  review(j, 'c-1', Rating.Good, '2026-10-05T12:00:00.000Z');
  saveProgress(j, st);
  assert.equal(loadProgress(st, 'jeremy').logs.length, 1);
  assert.equal(loadProgress(st, 'anna').logs.length, 0, 'a review by one person does not touch the other');
  assert.ok(st.getItem(progressKey('jeremy')) && st.getItem(progressKey('anna')));
  assert.equal(st.getItem(STORAGE_KEY), null, 'nothing under the pre-people key');
  savePending({ person_id: 'jeremy', card_id: 'c-2', rating: 1 }, st);
  assert.equal(takePending(st, 'anna'), null, 'an unrated answer waits for the person who gave it');
  assert.equal(takePending(st, 'jeremy').card_id, 'c-2');
  assert.equal(takePending(st, 'jeremy'), null);
});

test('the first person named on an upgraded device adopts the old record, the pending answer and the device id', () => {
  const st = memoryStorage();
  const old = emptyProgress('62542482-f797-4b4a-bcd2-75d2eba15e5d', 'Phone');
  review(old, 'c-1', Rating.Good, '2026-10-05T12:00:00.000Z');
  st.setItem(STORAGE_KEY, JSON.stringify(old));
  st.setItem(PENDING_KEY, JSON.stringify({ card_id: 'c-2', rating: 3 }));
  assert.equal(hasLegacyProgress(st), true);
  assert.equal(adoptLegacyProgress('jeremy', st), true);
  assert.equal(hasLegacyProgress(st), false);
  const p = loadProgress(st, 'jeremy');
  assert.equal(p.person_id, 'jeremy');
  assert.equal(p.device_id, old.device_id, 'the device keeps its id, so its file in the data repo keeps its name');
  assert.equal(p.logs.length, 1);
  assert.equal(deviceId(st), old.device_id);
  assert.equal(takePending(st, 'jeremy').card_id, 'c-2');
  assert.equal(st.getItem(PENDING_KEY), null);
  assert.equal(adoptLegacyProgress('anna', st), false, 'nothing is left for the next person');
  assert.equal(loadProgress(st, 'anna').logs.length, 0);
  assert.equal(loadProgress(st, 'anna').device_id, old.device_id);
});

test('merge and import refuse another person’s record; a record from before people existed is accepted', () => {
  const j = emptyProgress('dev-a', '', 'jeremy');
  const a = emptyProgress('dev-b', '', 'anna');
  review(a, 'c-1', Rating.Good, '2026-10-05T12:00:00.000Z');
  const m = mergeProgress(j, a, { replay: s.replay });
  assert.equal(m.logs.length, 0);
  assert.equal(m.person_id, 'jeremy');
  assert.throws(() => importProgress(exportProgress(a), 'jeremy'), /belongs to anna/);
  assert.equal(importProgress(exportProgress(a), 'anna').logs.length, 1);
  const legacy = emptyProgress('dev-c');
  review(legacy, 'c-1', Rating.Good, '2026-10-05T12:00:00.000Z');
  const merged = mergeProgress(j, legacy, { replay: s.replay });
  assert.equal(merged.logs.length, 1);
  assert.equal(merged.person_id, 'jeremy', 'and takes the reader’s name');
  assert.equal(importProgress(exportProgress(legacy), 'jeremy').logs.length, 1);
});
