// Court Sense entry point: load settings, the person using this device and
// their progress, and the deck, then route. On a device where nobody has
// signed in, the sign-in screen comes first and is the only way in.

import { installRendererStyles } from './court/theme.js';
import { loadSettings } from './store/settings.js';
import { loadPeople, currentPerson, hasLegacyProgress } from './store/people.js';
import { activatePerson } from './people.js';
import { makeScheduler } from './srs/scheduler.js';
import { loadDeck, indexDeck } from './deck.js';
import { renderHome, renderCards, renderPreview, renderSettings, renderProgress, renderSignIn, renderSignInPage } from './ui/views.js';
import { runSession, finalizePending } from './ui/session.js';
import { canSync, syncNow, syncedAt } from './sync.js';
import { sessionFor } from './store/account.js';

const root = document.getElementById('app');

export const app = {
  settings: null,
  scheduler: null,
  people: null, // everyone who uses this device
  person: null, // the one using it now
  progress: null, // that person's record on this device
  index: null,
  deckSource: null,
  deckError: null,
  sync: { state: 'idle', message: '' },
  autoSync: null, // set at boot; views call it after a person switch
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
  } else if (name === 'signin') {
    renderSignInPage(root, app, decodeURIComponent(a ?? ''));
  } else if (name === 'progress') {
    renderProgress(root, app);
  } else if (name === 'cards') {
    renderCards(root, app);
  } else if (name === 'preview') {
    app.teardown = renderPreview(root, app, decodeURIComponent(a ?? ''), b, c === 'm')?.destroy ?? null;
  } else {
    renderHome(root, app);
  }
}

async function autoSync() {
  if (!app.settings.autoSync || !canSync(app)) return;
  app.sync = { state: 'running', message: 'Syncing...' };
  try {
    await syncNow(app);
    app.sync = { state: 'ok', message: syncedAt() };
  } catch (e) {
    app.sync = { state: 'error', message: `Sync failed. ${e.message}` };
  }
  if (routeName()[0] === '') route();
}

// Nobody is on this device yet: sign in, or create an account, before anything
// else. On an upgraded device the record kept so far goes to the account signed
// in to. The sign-in ends with a sync, which also loads the deck.
function signInFirst() {
  return new Promise((resolve) => {
    renderSignIn(root, app, { migrating: hasLegacyProgress(), onDone: resolve });
  });
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
  app.autoSync = autoSync;
  app.people = loadPeople();
  const signedInNow = !currentPerson(app.people);
  if (signedInNow) await signInFirst();
  else activatePerson(app, app.people.current);
  // The first sign-in's sync loaded the deck through the Worker unless it failed.
  if (!app.index) {
    const { deck, source, error } = await loadDeck({ session: sessionFor(app.person.id) });
    app.index = indexDeck(deck);
    app.deckSource = source;
    app.deckError = error;
  }
  finalizePending(app); // an answer given last time but never rated
  window.addEventListener('hashchange', route);
  route();
  if (!signedInNow) autoSync(); // a first sign-in has just synced
  registerServiceWorker();
}

boot().catch((e) => {
  root.textContent = `Court Sense could not start: ${e.message}`;
  console.error(e);
});
