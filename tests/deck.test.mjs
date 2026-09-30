// The offline deck copy: Cache Storage first, localStorage as the migration
// source and as the fallback where the Cache API is missing. Node has no Cache
// Storage, so an in-memory stub stands in for `caches`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheDeck, readCachedDeck, loadDeck, DECK_CACHE_KEY, DECK_CACHE_NAME, DECK_CACHE_REQUEST } from '../app/src/deck.js';
import { saveSyncConfig } from '../app/src/store/github-sync.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] };
}

// caches.open(name) -> { put, match, delete }; bodies kept as text like the real thing.
function fakeCaches() {
  const names = new Map();
  const caches = {
    async open(name) {
      if (!names.has(name)) names.set(name, new Map());
      const entries = names.get(name);
      return {
        async put(req, res) {
          entries.set(String(req), await res.text());
        },
        async match(req) {
          return entries.has(String(req)) ? new Response(entries.get(String(req))) : undefined;
        },
        async delete(req) {
          return entries.delete(String(req));
        },
      };
    },
    async keys() {
      return [...names.keys()];
    },
  };
  const stored = () => names.get(DECK_CACHE_NAME)?.get(DECK_CACHE_REQUEST) ?? null;
  return { caches, names, stored };
}

const quiet = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
};

const deck = { schema_version: 1, cards: [{ id: 'c-1' }], scenes: [], principles: [] };
const newer = { ...deck, cards: [{ id: 'c-1' }, { id: 'c-2' }] };

test('the copy is written to and read from Cache Storage; localStorage stays empty', async () => {
  const { caches, names, stored } = fakeCaches();
  const storage = memoryStorage();
  assert.equal(await cacheDeck(deck, { caches, storage }), 'cache-storage');
  assert.deepEqual([...names.keys()], [DECK_CACHE_NAME]);
  assert.deepEqual(JSON.parse(stored()), deck);
  assert.deepEqual(storage.keys(), [], 'nothing in localStorage');
  assert.deepEqual(await readCachedDeck({ caches, storage }), deck);
  assert.ok(!DECK_CACHE_NAME.startsWith('court-sense-'), 'sw.js deletes court-sense-* caches on activate');
});

test('a copy left in localStorage moves into Cache Storage on first read', async () => {
  const { caches, stored } = fakeCaches();
  const storage = memoryStorage();
  storage.setItem(DECK_CACHE_KEY, JSON.stringify(deck));
  assert.deepEqual(await readCachedDeck({ caches, storage }), deck);
  assert.deepEqual(JSON.parse(stored()), deck, 'moved into the cache');
  assert.equal(storage.getItem(DECK_CACHE_KEY), null, 'key removed');
  assert.deepEqual(await readCachedDeck({ caches, storage }), deck, 'still readable after the move');
});

test('a fresh write drops the old localStorage copy', async () => {
  const { caches, stored } = fakeCaches();
  const storage = memoryStorage();
  storage.setItem(DECK_CACHE_KEY, JSON.stringify(deck));
  await cacheDeck(newer, { caches, storage });
  assert.equal(storage.getItem(DECK_CACHE_KEY), null);
  assert.deepEqual(JSON.parse(stored()), newer);
  assert.deepEqual(await readCachedDeck({ caches, storage }), newer);
});

test('without the Cache API the copy stays in localStorage', async () => {
  const storage = memoryStorage();
  assert.equal(await cacheDeck(deck, { caches: undefined, storage }), 'local-storage');
  assert.deepEqual(JSON.parse(storage.getItem(DECK_CACHE_KEY)), deck);
  assert.deepEqual(await readCachedDeck({ caches: undefined, storage }), deck);
  assert.equal(await readCachedDeck({ caches: undefined, storage: memoryStorage() }), null, 'nothing saved');
});

test('a Cache API that refuses to open falls back to localStorage', async () => {
  const blocked = {
    async open() {
      throw new Error('SecurityError: storage is blocked');
    },
  };
  const storage = memoryStorage();
  assert.equal(await quiet(() => cacheDeck(deck, { caches: blocked, storage })), 'local-storage');
  assert.deepEqual(await quiet(() => readCachedDeck({ caches: blocked, storage })), deck);
});

test('a corrupt localStorage copy is discarded, not migrated', async () => {
  const { caches, stored } = fakeCaches();
  const storage = memoryStorage();
  storage.setItem(DECK_CACHE_KEY, '{not json');
  assert.equal(await readCachedDeck({ caches, storage }), null);
  assert.equal(stored(), null);
  assert.equal(storage.getItem(DECK_CACHE_KEY), null);
});

test('loadDeck: GitHub, then the saved copy, then the sample', async () => {
  const sample = { schema_version: 1, cards: [{ id: 'sample' }] };
  const sampleFetch = async (path) => {
    assert.equal(path, 'data/deck.sample.json');
    return new Response(JSON.stringify(sample));
  };

  // Nothing configured, nothing saved: the sample.
  let r = await loadDeck({ storage: memoryStorage(), caches: fakeCaches().caches, fetchImpl: sampleFetch });
  assert.equal(r.source, 'sample');
  assert.deepEqual(r.deck, sample);
  assert.equal(r.error, null);

  // Nothing configured, a saved copy: the copy, and no fetch at all.
  let f = fakeCaches();
  let storage = memoryStorage();
  await cacheDeck(deck, { caches: f.caches, storage });
  r = await loadDeck({ storage, caches: f.caches, fetchImpl: async () => assert.fail('no fetch expected') });
  assert.equal(r.source, 'cache');
  assert.deepEqual(r.deck, deck);

  // Configured and reachable: GitHub, and the copy is refreshed into Cache Storage.
  f = fakeCaches();
  storage = memoryStorage();
  storage.setItem(DECK_CACHE_KEY, JSON.stringify(deck));
  saveSyncConfig({ owner: 'me', repo: 'piq-data', branch: 'main', token: 'github_pat_test' }, storage);
  const github = async (url, opts) => {
    assert.match(url, /\/repos\/me\/piq-data\/contents\/deck%2Fdeck\.json|\/repos\/me\/piq-data\/contents\/deck\/deck\.json/);
    assert.ok(opts.headers.Accept.includes('raw'));
    return new Response(JSON.stringify(newer), { status: 200 });
  };
  r = await loadDeck({ storage, caches: f.caches, fetchImpl: github });
  assert.equal(r.source, 'github');
  assert.deepEqual(r.deck, newer);
  assert.deepEqual(JSON.parse(f.stored()), newer, 'Cache Storage holds the pulled deck');
  assert.equal(storage.getItem(DECK_CACHE_KEY), null, 'old localStorage copy gone');

  // Configured but unreachable: the saved copy, with the error reported.
  const offline = async () => {
    throw new TypeError('Failed to fetch');
  };
  r = await loadDeck({ storage, caches: f.caches, fetchImpl: offline });
  assert.equal(r.source, 'cache');
  assert.deepEqual(r.deck, newer);
  assert.match(r.error, /Failed to fetch/);
});
