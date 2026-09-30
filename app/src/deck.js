// Deck loading: your private data repo first, then the last copy saved on this
// device, then the bundled sample deck.
//
// The saved copy lives in Cache Storage, not localStorage (D23): a full-corpus
// deck runs to several MB, and localStorage is capped near 5 MB on iOS Safari
// and shared with progress. localStorage is kept only as the migration source
// and as the fallback where the Cache API is missing (tests, old browsers,
// insecure origins, some private windows).

import { loadSyncConfig, isConfigured, makeGitHubClient, pullDeck } from './store/github-sync.js';

export const DECK_CACHE_KEY = 'piq.deck.cache.v1'; // localStorage: migration source and no-Cache-API fallback
export const DECK_CACHE_NAME = 'piq-data-v1'; // must not start with 'court-sense-': sw.js deletes those on activate
export const DECK_CACHE_REQUEST = './piq-cache/deck.json'; // synthetic key inside Cache Storage; never fetched

async function openCache(caches) {
  if (!caches?.open) return null;
  try {
    return await caches.open(DECK_CACHE_NAME);
  } catch (e) {
    // Blocked storage and some private windows throw here; the copy then stays in localStorage.
    console.warn('Cache Storage is unavailable; keeping the deck copy in localStorage.', e);
    return null;
  }
}

const asResponse = (text) => new Response(text, { headers: { 'Content-Type': 'application/json' } });

function removeLocalCopy(storage) {
  try {
    storage?.removeItem(DECK_CACHE_KEY);
  } catch {
    /* storage blocked */
  }
}

// Saves the offline copy. Returns where it went: 'cache-storage', 'local-storage' or null.
export async function cacheDeck(deck, { caches = globalThis.caches, storage = globalThis.localStorage } = {}) {
  const text = JSON.stringify(deck);
  const cache = await openCache(caches);
  if (cache) {
    try {
      await cache.put(DECK_CACHE_REQUEST, asResponse(text));
      removeLocalCopy(storage); // an older copy in localStorage is dead weight once the cache holds one
      return 'cache-storage';
    } catch (e) {
      console.warn('The deck copy could not be written to Cache Storage.', e);
    }
  }
  try {
    storage?.setItem(DECK_CACHE_KEY, text);
    return 'local-storage';
  } catch (e) {
    console.warn('Deck is too large to keep an offline copy in localStorage.', e);
    return null;
  }
}

// The saved copy, or null. With Cache Storage present, a copy an earlier version
// left in localStorage is moved into the cache on first read and the key removed.
export async function readCachedDeck({ caches = globalThis.caches, storage = globalThis.localStorage } = {}) {
  const cache = await openCache(caches);
  if (cache) {
    try {
      const hit = await cache.match(DECK_CACHE_REQUEST);
      if (hit) return await hit.json();
    } catch (e) {
      console.warn('The deck copy in Cache Storage could not be read.', e);
    }
  }
  let text = null;
  try {
    text = storage?.getItem(DECK_CACHE_KEY) ?? null;
  } catch {
    /* storage blocked */
  }
  if (!text) return null;
  let deck;
  try {
    deck = JSON.parse(text);
  } catch {
    removeLocalCopy(storage);
    return null;
  }
  if (cache) {
    try {
      await cache.put(DECK_CACHE_REQUEST, asResponse(text));
      removeLocalCopy(storage);
    } catch (e) {
      console.warn('The deck copy could not be moved to Cache Storage.', e);
    }
  }
  return deck;
}

export async function loadDeck({ storage = globalThis.localStorage, caches = globalThis.caches, fetchImpl = globalThis.fetch, samplePath = 'data/deck.sample.json' } = {}) {
  const cfg = loadSyncConfig(storage);
  let error = null;
  if (isConfigured(cfg)) {
    try {
      const deck = await pullDeck(makeGitHubClient(cfg, fetchImpl), cfg.deckPath || 'deck/deck.json');
      await cacheDeck(deck, { caches, storage });
      return { deck, source: 'github', error };
    } catch (e) {
      error = e.message;
    }
  }
  const cached = await readCachedDeck({ caches, storage });
  if (cached) return { deck: cached, source: 'cache', error };
  const res = await fetchImpl(samplePath);
  return { deck: await res.json(), source: 'sample', error };
}

export function indexDeck(deck) {
  const byId = (arr) => new Map((arr ?? []).map((x) => [x.id, x]));
  return {
    deck,
    cards: byId(deck.cards),
    scenes: byId(deck.scenes),
    principles: byId(deck.principles),
    speakers: deck.speakers ?? {},
    episodes: deck.episodes ?? {},
    shows: deck.shows ?? {},
  };
}
