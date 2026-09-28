// Court Sense entry point: load settings, progress and deck, then route.

import { installRendererStyles } from './court/theme.js';
import { loadProgress } from './store/progress.js';
import { loadSettings } from './store/settings.js';
import { makeScheduler } from './srs/scheduler.js';
import { loadDeck, indexDeck } from './deck.js';
import { renderHome, renderCards, renderPreview, renderSettings } from './ui/views.js';
import { runSession, finalizePending } from './ui/session.js';
import { canSync, syncNow } from './sync.js';

const root = document.getElementById('app');

export const app = {
  settings: null,
  scheduler: null,
  progress: null,
  index: null,
  deckSource: null,
  deckError: null,
  sync: { state: 'idle', message: '' },
  teardown: null,
};

const routeName = () => window.location.hash.replace(/^#\/?/, '').split('/');

function route() {
  app.teardown?.();
  app.teardown = null;
  const [name, a, b, c] = routeName();
  if (name === 'session') {
    app.teardown = runSession(root, app, { onBatchEnd: () => autoSync() }).destroy;
  } else if (name === 'settings') {
    renderSettings(root, app);
  } else if (name === 'cards') {
    renderCards(root, app);
  } else if (name === 'preview') {
    app.teardown = renderPreview(root, app, decodeURIComponent(a ?? ''), b, c === 'm')?.destroy ?? null;
  } else {
    renderHome(root, app);
  }
}

async function autoSync() {
  if (!app.settings.autoSync || !canSync()) return;
  app.sync = { state: 'running', message: 'Syncing...' };
  try {
    await syncNow(app);
    app.sync = { state: 'ok', message: `Synced at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` };
  } catch (e) {
    app.sync = { state: 'error', message: `Sync failed. ${e.message}` };
  }
  if (routeName()[0] === '') route();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline support is unavailable.', e));
  }
}

async function boot() {
  installRendererStyles();
  app.settings = loadSettings();
  app.scheduler = makeScheduler({ requestRetention: app.settings.requestRetention, maximumInterval: app.settings.maxIntervalDays });
  app.progress = loadProgress();
  const { deck, source, error } = await loadDeck();
  app.index = indexDeck(deck);
  app.deckSource = source;
  app.deckError = error;
  finalizePending(app); // an answer given last time but never rated
  window.addEventListener('hashchange', route);
  route();
  autoSync();
  registerServiceWorker();
}

boot().catch((e) => {
  root.textContent = `Court Sense could not start: ${e.message}`;
  console.error(e);
});
