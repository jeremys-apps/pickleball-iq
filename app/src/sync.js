// One sync pass for the person using this device: merge their other devices'
// progress, upload ours, refresh the deck. Other people's folders are not read.

import { loadSyncConfig, isConfigured, makeGitHubClient, syncProgress, pullDeck, progressFolder } from './store/github-sync.js';
import { mergeProgress, saveProgress } from './store/progress.js';
import { indexDeck, cacheDeck } from './deck.js';

export const canSync = () => isConfigured(loadSyncConfig());

export async function syncNow(app) {
  const cfg = loadSyncConfig();
  if (!isConfigured(cfg)) throw new Error('Add your data repository and token in Settings first.');
  const client = makeGitHubClient(cfg);
  if (app.settings.deviceLabel) app.progress.device_label = app.settings.deviceLabel;
  app.progress = await syncProgress(client, app.progress, {
    dir: progressFolder(cfg, app.progress.person_id),
    merge: (a, b) => mergeProgress(a, b, { replay: app.scheduler.replay }),
  });
  saveProgress(app.progress);
  const deck = await pullDeck(client, cfg.deckPath || 'deck/deck.json');
  await cacheDeck(deck);
  app.index = indexDeck(deck);
  app.deckSource = 'github';
  app.deckError = null;
}
