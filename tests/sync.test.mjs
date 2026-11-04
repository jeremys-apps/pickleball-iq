// One sync for the person using the device, end to end through the sign-in
// Worker and the fake GitHub: what it merges, what it writes, what it does to
// the deck, and what a refused session or a server failure leaves behind. Node
// has no Cache Storage, so the deck copy lands in the (in-memory) localStorage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeGitHub } from './fake-github.mjs';
import { syncNow, canSync } from '../app/src/sync.js';
import { ACCOUNT_API, saveSession, sessionFor } from '../app/src/store/account.js';
import { emptyProgress, recordReview, loadProgress, saveProgress } from '../app/src/store/progress.js';
import { DECK_CACHE_KEY } from '../app/src/deck.js';
import { DEFAULT_SETTINGS } from '../app/src/store/settings.js';
import { makeScheduler, Rating } from '../app/src/srs/scheduler.js';
import { handle } from '../server/src/worker.js';
import { signSession } from '../server/src/auth.js';

const deck = JSON.parse(readFileSync(new URL('../app/data/deck.sample.json', import.meta.url)));
const s = makeScheduler({ enableFuzz: false });
const review = (p, id, rating, iso) => {
  const { state } = s.review(p.cards[id]?.fsrs ?? s.newState(new Date(iso)), rating, new Date(iso));
  return recordReview(p, id, state, { rating, reviewed_at: iso });
};

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

const SECRET = 'test-session-secret-0123456789';
const workerEnv = (over = {}) => ({
  GITHUB_TOKEN: 'github_pat_worker',
  SESSION_SECRET: SECRET,
  FAMILY_CODE: 'Pickle Court Forever',
  DATA_REPO: 'me/piq-data',
  BRANCH: 'main',
  ALLOWED_ORIGINS: 'https://jeremys-apps.github.io',
  ...over,
});

// The device's fetch, answered by the Worker at its real address, which talks
// to the fake GitHub (or to anything else with a fetchImpl).
const throughWorker = (gh, env = workerEnv()) => async (url, init = {}) => {
  assert.ok(String(url).startsWith(`${ACCOUNT_API}/`), `the device calls only the Worker, not ${url}`);
  return handle(new Request(url, init), env, { fetchImpl: gh.fetchImpl });
};

async function signedIn(storage, id = 'jeremy') {
  const session = await signSession(SECRET, id);
  saveSession(id, session, storage);
  return session;
}

// A data repo where Jeremy's laptop and Anna's phone have synced, plus the deck.
function setup({ withDeck = true } = {}) {
  const laptop = emptyProgress('laptop-22222', 'Laptop', 'jeremy');
  review(laptop, 'c-1', Rating.Good, '2026-11-01T12:00:00.000Z');
  const anna = emptyProgress('phone-333333', 'Phone', 'anna');
  review(anna, 'c-2', Rating.Again, '2026-11-01T13:00:00.000Z');
  const gh = fakeGitHub({
    ...(withDeck ? { 'deck/deck.json': JSON.stringify(deck) } : {}),
    'progress/jeremy/laptop-22222.json': JSON.stringify(laptop),
    'progress/anna/phone-333333.json': JSON.stringify(anna),
  });
  const storage = memoryStorage();
  const app = {
    settings: { ...DEFAULT_SETTINGS, deviceLabel: 'Phone' },
    scheduler: s,
    person: { id: 'jeremy', name: 'Jeremy' },
    progress: emptyProgress('phone-111111', '', 'jeremy'),
    index: null,
    deckSource: 'cache',
    deckError: 'an earlier failure',
  };
  review(app.progress, 'c-3', Rating.Good, '2026-11-02T12:00:00.000Z');
  return { gh, storage, app };
}

// syncNow reads its storage and network from the globals, as in the browser.
async function withGlobals({ storage, fetchImpl }, fn) {
  const realFetch = globalThis.fetch;
  globalThis.localStorage = storage;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.localStorage;
  }
}

test("one sync merges the person's other devices, writes only this device's file, and refreshes the deck", async () => {
  const { gh, storage, app } = setup();
  await signedIn(storage);
  await withGlobals({ storage, fetchImpl: throughWorker(gh) }, () => syncNow(app));

  assert.deepEqual(app.progress.logs.map((l) => l.card_id).sort(), ['c-1', 'c-3'], "the laptop's review merged in");
  assert.equal(app.progress.device_label, 'Phone', 'the device label is copied into the record');
  const puts = gh.calls.filter((c) => c.method === 'PUT');
  assert.deepEqual(
    puts.map((c) => new URL(c.url).pathname),
    ['/repos/me/piq-data/contents/progress/jeremy/phone-111111.json'],
    "only this device's file is written",
  );
  assert.ok(!gh.calls.some((c) => c.url.includes('/progress/anna')), "another person's folder is never read");
  assert.ok(gh.calls.every((c) => c.headers.Authorization === 'Bearer github_pat_worker'), "GitHub sees only the Worker's token");
  const uploaded = JSON.parse(gh.store.get('progress/jeremy/phone-111111.json').text);
  assert.equal(uploaded.person_id, 'jeremy');
  assert.equal(uploaded.logs.length, 2);
  assert.equal(loadProgress(storage, 'jeremy').logs.length, 2, 'the merged record is saved on the device');
  assert.equal(app.deckSource, 'github');
  assert.equal(app.deckError, null, 'a good sync clears an earlier deck error');
  assert.equal(app.index.cards.size, deck.cards.length, 'the pulled deck is indexed');
  assert.deepEqual(JSON.parse(storage.getItem(DECK_CACHE_KEY)), deck, 'the pulled deck is kept for offline use');
});

test('a sync whose deck pull fails has still merged, saved and uploaded the progress', async () => {
  const { gh, storage, app } = setup({ withDeck: false });
  await signedIn(storage);
  await assert.rejects(() => withGlobals({ storage, fetchImpl: throughWorker(gh) }, () => syncNow(app)), /No deck at deck\/deck\.json/);
  assert.ok(gh.store.has('progress/jeremy/phone-111111.json'), 'the upload happened before the deck pull');
  assert.equal(loadProgress(storage, 'jeremy').logs.length, 2);
  assert.equal(app.deckSource, 'cache', 'the deck in use is left as it was');
  assert.equal(app.index, null);
  assert.ok(sessionFor('jeremy', storage), 'a missing deck does not sign anyone out');
});

test('with nobody signed in nothing is sent, the progress is left alone, and the error says to sign in', async () => {
  const { gh, storage, app } = setup();
  storage.setItem('piq.sync.v1', JSON.stringify({ owner: 'me', repo: 'piq-data', branch: 'main', token: 'github_pat_test' }));
  await signedIn(storage, 'anna');
  await assert.rejects(() => withGlobals({ storage, fetchImpl: throughWorker(gh) }, () => syncNow(app)), { message: 'Sign in first.' });
  assert.equal(gh.calls.length, 0, "old token settings and another person's session are not used");
  assert.equal(app.progress.logs.length, 1);
});

test('canSync needs a person and their own session on this device', async () => {
  const storage = memoryStorage();
  await withGlobals({ storage, fetchImpl: undefined }, async () => {
    assert.equal(canSync({ person: null }), false);
    assert.equal(canSync(undefined), false);
    assert.equal(canSync({ person: { id: 'jeremy' } }), false);
    await signedIn(storage, 'anna');
    assert.equal(canSync({ person: { id: 'jeremy' } }), false, "another person's session does not count");
    await signedIn(storage, 'jeremy');
    assert.equal(canSync({ person: { id: 'jeremy' } }), true);
  });
});

test('a sync refused with 401 forgets the session, keeps the record and its unsynced review, and says to sign in again', async () => {
  const { gh, storage, app } = setup();
  await signedIn(storage);
  await signedIn(storage, 'anna');
  saveProgress(app.progress, storage);
  const newKey = workerEnv({ SESSION_SECRET: 'a-new-session-key-for-everyone' });
  await assert.rejects(
    () => withGlobals({ storage, fetchImpl: throughWorker(gh, newKey) }, () => syncNow(app)),
    (e) => {
      assert.equal(e.message, 'You are signed out. Sign in again in Settings.');
      assert.equal(e.status, 401);
      return true;
    },
  );
  assert.equal(sessionFor('jeremy', storage), null, 'his session is gone');
  assert.ok(sessionFor('anna', storage), "another person's session on the device stays");
  assert.deepEqual(app.progress.logs.map((l) => l.card_id), ['c-3'], 'the unsynced review is still in the record');
  assert.equal(loadProgress(storage, 'jeremy').logs.length, 1, 'and saved on the device');
  assert.ok(!gh.store.has('progress/jeremy/phone-111111.json'), 'nothing was written');
  assert.equal(app.deckSource, 'cache', 'the deck in use is left as it was');
});

test('a sync that meets a server failure (502) keeps the session and the record', async () => {
  const { storage, app } = setup();
  const session = await signedIn(storage);
  const refused = { fetchImpl: async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }) };
  await assert.rejects(
    () => withGlobals({ storage, fetchImpl: throughWorker(refused) }, () => syncNow(app)),
    (e) => {
      assert.equal(e.status, 502);
      assert.match(e.message, /\(502\)\. Sync is not working on the server\. Your progress is safe on this device\.$/);
      return true;
    },
  );
  assert.equal(sessionFor('jeremy', storage), session, 'GitHub refusing the Worker signs nobody out');
  assert.equal(app.progress.logs.length, 1);
  assert.equal(app.deckSource, 'cache');
});
