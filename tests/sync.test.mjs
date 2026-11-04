// One sync for the person using the device, end to end against the fake GitHub:
// what it merges, what it writes, and what it does to the deck. Node has no
// Cache Storage, so the deck copy lands in the (in-memory) localStorage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeGitHub } from './fake-github.mjs';
import { saveSyncConfig } from '../app/src/store/github-sync.js';
import { syncNow } from '../app/src/sync.js';
import { emptyProgress, recordReview, loadProgress } from '../app/src/store/progress.js';
import { DECK_CACHE_KEY } from '../app/src/deck.js';
import { DEFAULT_SETTINGS } from '../app/src/store/settings.js';
import { makeScheduler, Rating } from '../app/src/srs/scheduler.js';

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

// syncNow reads its settings, storage and network from the globals, as in the browser.
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
  saveSyncConfig({ owner: 'me', repo: 'piq-data', branch: 'main', token: 'github_pat_test' }, storage);
  await withGlobals({ storage, fetchImpl: gh.fetchImpl }, () => syncNow(app));

  assert.deepEqual(app.progress.logs.map((l) => l.card_id).sort(), ['c-1', 'c-3'], "the laptop's review merged in");
  assert.equal(app.progress.device_label, 'Phone', 'the device label is copied into the record');
  const puts = gh.calls.filter((c) => c.method === 'PUT');
  assert.deepEqual(
    puts.map((c) => new URL(c.url).pathname),
    ['/repos/me/piq-data/contents/progress/jeremy/phone-111111.json'],
    "only this device's file is written",
  );
  assert.ok(!gh.calls.some((c) => c.url.includes('/progress/anna')), "another person's folder is never read");
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
  saveSyncConfig({ owner: 'me', repo: 'piq-data', branch: 'main', token: 'github_pat_test' }, storage);
  await assert.rejects(() => withGlobals({ storage, fetchImpl: gh.fetchImpl }, () => syncNow(app)), /No deck at deck\/deck\.json/);
  assert.ok(gh.store.has('progress/jeremy/phone-111111.json'), 'the upload happened before the deck pull');
  assert.equal(loadProgress(storage, 'jeremy').logs.length, 2);
  assert.equal(app.deckSource, 'cache', 'the deck in use is left as it was');
  assert.equal(app.index, null);
});

test('without sync settings nothing is sent and the progress is left alone', async () => {
  const { gh, storage, app } = setup();
  await assert.rejects(() => withGlobals({ storage, fetchImpl: gh.fetchImpl }, () => syncNow(app)), /Settings first/);
  assert.equal(gh.calls.length, 0);
  assert.equal(app.progress.logs.length, 1);
});
