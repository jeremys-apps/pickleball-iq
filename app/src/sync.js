// One sync pass for the person using this device, through the sign-in Worker:
// merge their other devices' progress, upload ours, refresh the deck. Other
// people's folders are not read, and the Worker refuses them anyway.

import { syncProgress, pullDeck, progressFolder } from './store/github-sync.js';
import { sessionFor, clearSession, makeAccountClient } from './store/account.js';
import { mergeProgress, saveProgress } from './store/progress.js';
import { indexDeck, cacheDeck } from './deck.js';

export const SIGNED_OUT = 'You are signed out. Sign in again in Settings.';

export const canSync = (app) => !!(app?.person && sessionFor(app.person.id));

export const syncedAt = (d = new Date()) => `Synced at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;

// A 401 means the Worker no longer accepts this person's session (its key
// changed): the session is forgotten and the record stays as it is, unsynced
// reviews included, to upload after the next sign-in. Anything else, a server
// failure included, changes nothing on the device.
export async function syncNow(app, { storage = globalThis.localStorage, api, fetchImpl = globalThis.fetch } = {}) {
  const id = app.person?.id;
  const session = id ? sessionFor(id, storage) : null;
  if (!session) throw new Error('Sign in first.');
  const client = makeAccountClient(session, { ...(api ? { api } : {}), fetchImpl });
  if (app.settings.deviceLabel) app.progress.device_label = app.settings.deviceLabel;
  try {
    app.progress = await syncProgress(client, app.progress, {
      dir: progressFolder(null, id),
      merge: (a, b) => mergeProgress(a, b, { replay: app.scheduler.replay }),
    });
    saveProgress(app.progress, storage);
    const deck = await pullDeck(client);
    await cacheDeck(deck, { storage });
    app.index = indexDeck(deck);
    app.deckSource = 'github';
    app.deckError = null;
  } catch (e) {
    if (e.status !== 401) throw e;
    clearSession(id, storage);
    const out = new Error(SIGNED_OUT);
    out.status = 401;
    throw out;
  }
}
