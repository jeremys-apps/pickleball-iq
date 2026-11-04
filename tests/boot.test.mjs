// Boot on a device where nobody has signed in, through main.js itself: the
// sign-in screen comes first, and after the first sign-in Home shows the deck
// that sign-in's sync loaded, without loading another or syncing again.
// main.js boots when it is imported, so this file imports it once, in its own
// process, with the sign-in Worker and a fake GitHub behind the page's fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  /* jsdom not installed */
}
const skip = !JSDOM && 'run npm install to enable UI tests';

const deck = JSON.parse(readFileSync(new URL('../app/data/deck.sample.json', import.meta.url)));

async function until(cond, what, ms = 10000) {
  for (let i = 0; i < ms / 10 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond(), `timed out waiting for ${what}`);
}

test('first launch: Sign in comes first, and after the first sign-in Home shows the deck its sync loaded, with no second load or sync', { skip }, async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'http://localhost:8000/', pretendToBeVisual: true });
  const w = dom.window;
  const mm = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.matchMedia = mm;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    localStorage: w.localStorage,
    getComputedStyle: w.getComputedStyle.bind(w),
    requestAnimationFrame: w.requestAnimationFrame.bind(w),
    cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
    FormData: w.FormData,
    location: w.location,
    matchMedia: mm,
  });

  const [{ fakeGitHub }, { handle }, { ACCOUNT_API }] = await Promise.all([import('./fake-github.mjs'), import('../server/src/worker.js'), import('../app/src/store/account.js')]);
  const gh = fakeGitHub({ 'deck/deck.json': JSON.stringify(deck) });
  const env = {
    GITHUB_TOKEN: 'github_pat_worker',
    SESSION_SECRET: 'test-session-secret-0123456789',
    FAMILY_CODE: 'Pickle Court Forever',
    DATA_REPO: 'me/piq-data',
    BRANCH: 'main',
    ALLOWED_ORIGINS: 'http://localhost:8000',
  };
  const elsewhere = [];
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith(`${ACCOUNT_API}/`)) {
      elsewhere.push(String(url));
      throw new TypeError('Failed to fetch');
    }
    return handle(new Request(url, init), env, { fetchImpl: gh.fetchImpl });
  };

  const { app } = await import('../app/src/main.js');
  const root = document.getElementById('app');
  await until(() => root.querySelector('h1')?.textContent === 'Sign in', 'the sign-in screen');
  assert.equal(app.index, null, 'nothing loads before someone signs in');
  assert.equal(gh.calls.length, 0);
  assert.ok(![...root.querySelectorAll('main button')].some((b) => /Cancel|Start/.test(b.textContent)), 'no way past it without an account');

  [...root.querySelectorAll('main a')].find((a) => a.textContent === 'Create an account').click();
  for (const [name, value] of Object.entries({ username: 'Mary Ann', password: 'mary ann password', familyCode: 'pickle court forever' })) {
    root.querySelector(`input[name="${name}"]`).value = value;
  }
  root.querySelector('main form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => root.querySelector('h1')?.textContent === 'Today', 'Home');
  await new Promise((r) => setTimeout(r, 300)); // room for a second load or sync, if boot started one

  assert.equal(app.person.id, 'mary-ann');
  assert.equal(app.deckSource, 'github');
  assert.equal(app.index.cards.size, deck.cards.length);
  assert.match(root.textContent, new RegExp(`${deck.cards.length}in the deck`));
  const gets = (path) => gh.calls.filter((c) => c.method === 'GET' && new URL(c.url).pathname.endsWith(`/contents/${path}`)).length;
  assert.equal(gets('deck/deck.json'), 1, 'the deck is loaded once, by the sync that ends the sign-in');
  assert.equal(gets('progress/mary-ann'), 1, 'and synced once');
  assert.deepEqual(elsewhere, [], 'not even the sample deck is fetched');
  assert.ok(!/Not signed in|sample deck/.test(root.textContent), 'Home has no sign-in or sample banner');
  assert.match(app.sync.message, /^Synced at /);
});
