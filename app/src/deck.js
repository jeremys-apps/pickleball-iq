// Deck loading: your private data repo first, then the last copy saved on this
// device, then the bundled sample deck.

import { loadSyncConfig, isConfigured, makeGitHubClient, pullDeck } from './store/github-sync.js';

export const DECK_CACHE_KEY = 'piq.deck.cache.v1';

export function cacheDeck(deck, storage = globalThis.localStorage) {
  try {
    storage?.setItem(DECK_CACHE_KEY, JSON.stringify(deck));
  } catch (e) {
    // localStorage is typically capped near 5 MB. Move the cache to IndexedDB if decks grow past ~2 MB.
    console.warn('Deck is too large to keep an offline copy in localStorage.', e);
  }
}

export async function loadDeck({ storage = globalThis.localStorage, fetchImpl = globalThis.fetch, samplePath = 'data/deck.sample.json' } = {}) {
  const cfg = loadSyncConfig(storage);
  let error = null;
  if (isConfigured(cfg)) {
    try {
      const deck = await pullDeck(makeGitHubClient(cfg, fetchImpl), cfg.deckPath || 'deck/deck.json');
      cacheDeck(deck, storage);
      return { deck, source: 'github', error };
    } catch (e) {
      error = e.message;
    }
  }
  const cached = storage?.getItem(DECK_CACHE_KEY);
  if (cached) {
    try {
      return { deck: JSON.parse(cached), source: 'cache', error };
    } catch {
      /* fall through to the sample */
    }
  }
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
