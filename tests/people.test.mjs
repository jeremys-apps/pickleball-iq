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
import { readFileSync } from 'node:fs';
import { signInPerson, createPersonAccount } from '../app/src/people.js';
import { LEGACY_SYNC_KEY, createAccount, saveSession, sessionFor } from '../app/src/store/account.js';
import { DEFAULT_SETTINGS } from '../app/src/store/settings.js';
import { handle } from '../server/src/worker.js';
import { fakeGitHub } from './fake-github.mjs';

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

test('removing a person also forgets their session on this device', () => {
  const st = memoryStorage();
  let { reg } = addPerson(loadPeople(st), 'Jeremy');
  reg = setCurrent(reg, 'jeremy');
  ({ reg } = addPerson(reg, 'Anna'));
  saveSession('jeremy', 'v1.jeremy.one', st);
  saveSession('anna', 'v1.anna.two', st);
  removePerson(reg, 'anna', st);
  assert.equal(sessionFor('anna', st), null);
  assert.equal(sessionFor('jeremy', st), 'v1.jeremy.one', 'the person using the device stays signed in');
});

// Sign-in and account creation, end to end through the Worker and a fake GitHub.
const API = 'https://court-sense.example.workers.dev';
const CODE = 'Pickle Court Forever';
const deck = JSON.parse(readFileSync(new URL('../app/data/deck.sample.json', import.meta.url)));
const workerEnv = (over = {}) => ({
  GITHUB_TOKEN: 'github_pat_worker',
  SESSION_SECRET: 'test-session-secret-0123456789',
  FAMILY_CODE: CODE,
  DATA_REPO: 'me/piq-data',
  BRANCH: 'main',
  ALLOWED_ORIGINS: 'https://jeremys-apps.github.io',
  ...over,
});
const throughWorker = (gh, env = workerEnv()) => async (url, init = {}) => {
  assert.ok(String(url).startsWith(`${API}/`), `the device calls only the Worker, not ${url}`);
  return handle(new Request(url, init), env, { fetchImpl: gh.fetchImpl });
};
// The app as main.js builds it, before anyone is current.
const newApp = (st) => ({
  settings: { ...DEFAULT_SETTINGS },
  scheduler: s,
  people: loadPeople(st),
  person: null,
  progress: null,
  index: null,
  deckSource: 'sample',
  deckError: null,
  sync: { state: 'idle', message: '' },
});

test('signing in on an upgraded device adopts the old record and device id, keeps the session, forgets the token, and syncs', async () => {
  const st = memoryStorage();
  const old = emptyProgress('62542482-f797-4b4a-bcd2-75d2eba15e5d', 'Phone');
  review(old, 'c-1', Rating.Good, '2026-10-05T12:00:00.000Z');
  st.setItem(STORAGE_KEY, JSON.stringify(old));
  st.setItem(LEGACY_SYNC_KEY, JSON.stringify({ owner: 'me', repo: 'piq-data', branch: 'main', token: 'github_pat_old' }));
  const laptop = emptyProgress('laptop-22222', 'Laptop', 'jeremy');
  review(laptop, 'c-2', Rating.Good, '2026-10-06T12:00:00.000Z');
  const gh = fakeGitHub({ 'deck/deck.json': JSON.stringify(deck), 'progress/jeremy/laptop-22222.json': JSON.stringify(laptop) });
  const fetchImpl = throughWorker(gh);
  await createAccount({ id: 'jeremy', name: 'Jeremy', password: 'jeremy password', familyCode: CODE }, { api: API, fetchImpl });

  const app = newApp(st);
  const person = await signInPerson(app, { name: ' Jeremy ', password: 'jeremy password' }, { storage: st, api: API, fetchImpl });
  assert.equal(person.id, 'jeremy');
  assert.equal(app.person.id, 'jeremy');
  assert.equal(loadPeople(st).current, 'jeremy');
  assert.equal(app.progress.device_id, old.device_id, 'the device keeps its id, so its file keeps its name');
  assert.equal(st.getItem(STORAGE_KEY), null, 'the old record moved to Jeremy');
  assert.ok(sessionFor('jeremy', st), 'the session is kept on the device');
  assert.equal(st.getItem(LEGACY_SYNC_KEY), null, 'the old token is deleted');
  assert.deepEqual(app.progress.logs.map((l) => l.card_id).sort(), ['c-1', 'c-2'], 'the sync merged the review from the laptop');
  assert.ok(gh.store.has(`progress/jeremy/${old.device_id}.json`), 'and uploaded the file of this device under its old id');
  assert.equal(app.deckSource, 'github', 'the deck came through the Worker');
  assert.equal(app.index.cards.size, deck.cards.length);
  assert.equal(app.deckError, null);
  assert.equal(app.sync.state, 'ok');
  assert.match(app.sync.message, /^Synced at /);
});

test('creating an account again after a reset brings back the progress already in its folder', async () => {
  const st = memoryStorage();
  const phone = emptyProgress('phone-333333', 'Phone', 'anna');
  review(phone, 'c-1', Rating.Good, '2026-11-01T12:00:00.000Z');
  // The account record was deleted to reset the password; the folder was not touched.
  const gh = fakeGitHub({ 'deck/deck.json': JSON.stringify(deck), 'progress/anna/phone-333333.json': JSON.stringify(phone) });
  const app = newApp(st);
  const person = await createPersonAccount(app, { name: 'Anna', password: 'a new password', familyCode: 'pickle court forever' }, { storage: st, api: API, fetchImpl: throughWorker(gh) });
  assert.deepEqual(person, app.person);
  assert.equal(person.name, 'Anna');
  assert.ok(gh.store.has('accounts/anna.json'), 'the account record is written');
  assert.ok(sessionFor('anna', st));
  assert.deepEqual(app.progress.logs.map((l) => l.card_id), ['c-1'], 'the review from the phone is on the new device');
  assert.equal(app.deckSource, 'github');
  assert.equal(app.sync.state, 'ok');
});

test('a sync that fails after signing in keeps the sign-in and says why', async () => {
  const st = memoryStorage();
  const gh = fakeGitHub(); // no deck in the data repo yet
  const app = newApp(st);
  await createPersonAccount(app, { name: 'Ben', password: 'ben password 2', familyCode: CODE }, { storage: st, api: API, fetchImpl: throughWorker(gh) });
  assert.equal(app.person.id, 'ben');
  assert.ok(sessionFor('ben', st), 'still signed in');
  assert.equal(app.sync.state, 'error');
  assert.match(app.sync.message, /^Sync failed\. No deck at deck\/deck\.json/);
  assert.ok(gh.store.has(`progress/ben/${app.progress.device_id}.json`), 'the progress part of the sync still ran');
  assert.equal(app.deckSource, 'sample', 'the deck in use is unchanged');
});

test('a refused sign-in changes nothing on the device, and bad input never leaves it', async () => {
  const st = memoryStorage();
  const gh = fakeGitHub();
  const fetchImpl = throughWorker(gh);
  await createAccount({ id: 'anna', name: 'Anna', password: 'anna password 1', familyCode: CODE }, { api: API, fetchImpl });
  const app = newApp(st);
  const opts = { storage: st, api: API, fetchImpl };
  await assert.rejects(signInPerson(app, { name: 'Anna', password: 'not the password' }, opts), { message: 'That password is not right.' });
  await assert.rejects(signInPerson(app, { name: 'Zed', password: 'any password' }, opts), { message: 'No account with that name yet. Check the spelling, or create an account.' });
  await assert.rejects(createPersonAccount(app, { name: 'Anna', password: 'anna password 1', familyCode: CODE }, opts), { message: 'There is already an account with that name. Sign in instead.' });
  await assert.rejects(createPersonAccount(app, { name: 'Cy', password: 'cy password 3', familyCode: 'not the code' }, opts), { message: 'That family code is not right.' });
  assert.equal(app.person, null, 'nobody became current');
  assert.deepEqual(loadPeople(st).people, []);
  assert.equal(sessionFor('anna', st), null);
  const none = async (url) => assert.fail(`no request expected, got ${url}`);
  const quiet = { storage: st, api: API, fetchImpl: none };
  await assert.rejects(signInPerson(app, { name: '!!!', password: 'long enough' }, quiet), { message: 'Type a name with at least one plain letter or digit.' });
  await assert.rejects(createPersonAccount(app, { name: 'Anna', password: 'short', familyCode: CODE }, quiet), { message: 'Use at least 8 characters.' });
  await assert.rejects(signInPerson(app, { name: '', password: '' }, quiet), { message: 'Type a name with at least one plain letter or digit.' });
});
