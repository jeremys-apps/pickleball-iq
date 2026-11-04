// The device's account module: the key it derives from a password, the sign-in
// calls, the sessions it keeps, and, end to end through the Worker and the fake
// GitHub, two people on their devices, a password reset and a new session key.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_API,
  SESSIONS_KEY,
  LEGACY_SYNC_KEY,
  MIN_PASSWORD_LENGTH,
  deriveKey,
  signIn,
  createAccount,
  sessionFor,
  saveSession,
  clearSession,
  forgetLegacySync,
  makeAccountClient,
} from '../app/src/store/account.js';
import { syncProgress, progressFolder } from '../app/src/store/github-sync.js';
import { emptyProgress, recordReview, mergeProgress } from '../app/src/store/progress.js';
import { makeScheduler, Rating } from '../app/src/srs/scheduler.js';
import { handle } from '../server/src/worker.js';
import { fakeGitHub } from './fake-github.mjs';

const API = 'https://court-sense.example.workers.dev';
const CODE = 'Pickle Court Forever';
const TOO_SHORT = 'Use at least 8 characters.';
const UNREACHABLE = 'Could not reach the sign-in service. Check your connection and try again.';
const SIGNED_OUT = 'You are signed out. Sign in again in Settings.';

const s = makeScheduler({ enableFuzz: false });
const review = (p, id, rating, iso) => {
  const { state } = s.review(p.cards[id]?.fsrs ?? s.newState(new Date(iso)), rating, new Date(iso));
  return recordReview(p, id, state, { rating, reviewed_at: iso });
};
const merge = (a, b) => mergeProgress(a, b, { replay: s.replay });

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] };
}

const workerEnv = (over = {}) => ({
  GITHUB_TOKEN: 'github_pat_worker',
  SESSION_SECRET: 'test-session-secret-0123456789',
  FAMILY_CODE: CODE,
  DATA_REPO: 'me/piq-data',
  BRANCH: 'main',
  ALLOWED_ORIGINS: 'https://jeremys-apps.github.io',
  ...over,
});

// The device's fetch, answered by the Worker, which talks to the fake GitHub.
// getEnv is read on every request, so a test can change a secret midway.
function throughWorker(gh, getEnv = () => workerEnv()) {
  return async (url, init = {}) => {
    assert.ok(String(url).startsWith(`${API}/`), `the device calls only the Worker, not ${url}`);
    return handle(new Request(url, init), getEnv(), { fetchImpl: gh.fetchImpl });
  };
}

// Answers every request with one JSON body and status, recording the calls.
function answering(status, body) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { calls, fetchImpl };
}

test('deriveKey matches PBKDF2 computed independently, and changes with the name and the password', async () => {
  const key = await deriveKey('correct horse battery', 'mary-ann');
  // Python: hashlib.pbkdf2_hmac('sha256', password, b'court-sense/v1/mary-ann', 600000, 32), base64url without padding
  assert.equal(key, 'I4NLW8ncwvjujaSUSOOtylwG1snX0nc8z02aj5CQZMQ');
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await deriveKey('correct horse battery', 'mary-ann'), key, 'the same name and password give the same key');
  assert.notEqual(await deriveKey('correct horse battery', 'mary-anne'), key, 'another name, another key');
  assert.notEqual(await deriveKey('correct horse batterY', 'mary-ann'), key, 'another password, another key');
  assert.equal(
    await deriveKey('Café au lait', 'jeremy'),
    'V1k4Lp5cakDdK9wiYDV-0L0JQpcAZYPZ2PoHAb9HFpM',
    'an accent typed as a separate mark gives the key of the composed letter (NFC), as Python computes it',
  );
  await assert.rejects(deriveKey('correct horse battery', 'mary-ann', null), {
    message: 'Sign-in needs a secure connection. Open the app at its https address.',
  }, 'a page opened over plain http has no Web Crypto');
});

test('sign-in and account creation send the name id and the key, never the password', async () => {
  const session = `v1.mary-ann.${'A'.repeat(43)}`;
  const w = answering(200, { session, person: { id: 'mary-ann', name: 'Mary Ann' } });
  const out = await signIn({ id: 'mary-ann', password: 'correct horse battery' }, { api: API, fetchImpl: w.fetchImpl });
  assert.deepEqual(out, { session, person: { id: 'mary-ann', name: 'Mary Ann' } });
  await createAccount({ id: 'mary-ann', name: 'Mary Ann', password: 'correct horse battery', familyCode: 'pickle court' }, { api: API, fetchImpl: w.fetchImpl });
  const [inCall, upCall] = w.calls;
  assert.equal(inCall.url, `${API}/sessions`);
  assert.equal(inCall.init.method, 'POST');
  assert.equal(inCall.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(inCall.init.body), { id: 'mary-ann', key: 'I4NLW8ncwvjujaSUSOOtylwG1snX0nc8z02aj5CQZMQ' });
  assert.equal(upCall.url, `${API}/accounts`);
  assert.equal(upCall.init.method, 'POST');
  assert.deepEqual(JSON.parse(upCall.init.body), { id: 'mary-ann', name: 'Mary Ann', key: 'I4NLW8ncwvjujaSUSOOtylwG1snX0nc8z02aj5CQZMQ', family_code: 'pickle court' });
  for (const c of w.calls) assert.ok(!c.init.body.includes('correct horse'), 'no password leaves the device');
  const d = answering(200, { session, person: { id: 'mary-ann', name: 'Mary Ann' } });
  await signIn({ id: 'mary-ann', password: 'correct horse battery' }, { fetchImpl: d.fetchImpl });
  assert.equal(d.calls[0].url, `${ACCOUNT_API}/sessions`, 'the deployed Worker by default');
  assert.equal(ACCOUNT_API, 'https://court-sense.jeremys-apps.workers.dev');
});

test('a password under 8 characters is refused before any request', async () => {
  const w = answering(200, { session: 'x', person: { id: 'anna', name: 'Anna' } });
  const opts = { api: API, fetchImpl: w.fetchImpl };
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  for (const password of ['', 'seven77', '       ', '\u{1F3D3}\u{1F3D3}\u{1F3D3}\u{1F3D3}', undefined, null]) {
    await assert.rejects(signIn({ id: 'anna', password }, opts), { message: TOO_SHORT }, `sign-in with ${JSON.stringify(password)}`);
    await assert.rejects(createAccount({ id: 'anna', name: 'Anna', password, familyCode: CODE }, opts), { message: TOO_SHORT });
  }
  assert.equal(w.calls.length, 0, 'nothing was sent; four emoji are four characters');
  await signIn({ id: 'anna', password: 'eight888' }, opts);
  assert.equal(w.calls.length, 1, 'eight characters are enough');
});

test("the Worker's messages reach the caller with their status; no connection gives the sign-in service message", async () => {
  const opts = (fetchImpl) => ({ api: API, fetchImpl });
  const who = { id: 'anna', password: 'anna password 1' };
  const fresh = { ...who, name: 'Anna', familyCode: 'wrong code' };
  const cases = [
    [() => signIn(who, opts(answering(404, { message: 'No account with that name yet. Check the spelling, or create an account.' }).fetchImpl)), 404, 'No account with that name yet. Check the spelling, or create an account.'],
    [() => signIn(who, opts(answering(401, { message: 'That password is not right.' }).fetchImpl)), 401, 'That password is not right.'],
    [() => signIn(who, opts(answering(429, { message: 'Too many tries. Wait a minute and try again.' }).fetchImpl)), 429, 'Too many tries. Wait a minute and try again.'],
    [() => createAccount(fresh, opts(answering(403, { message: 'That family code is not right.' }).fetchImpl)), 403, 'That family code is not right.'],
    [() => createAccount(fresh, opts(answering(409, { message: 'There is already an account with that name. Sign in instead.' }).fetchImpl)), 409, 'There is already an account with that name. Sign in instead.'],
    [() => signIn(who, opts(answering(502, { message: 'Sync is not working on the server. Your progress is safe on this device.' }).fetchImpl)), 502, 'Sync is not working on the server. Your progress is safe on this device.'],
    [() => signIn(who, opts(answering(502, '<html>Bad gateway</html>').fetchImpl)), 502, UNREACHABLE],
    [() => signIn(who, opts(answering(200, { ok: true }).fetchImpl)), 200, UNREACHABLE],
    [() => signIn(who, opts(async () => { throw new TypeError('Failed to fetch'); })), 0, UNREACHABLE],
  ];
  for (const [run, status, message] of cases) {
    await assert.rejects(run(), (e) => {
      assert.equal(e.message, message);
      assert.equal(e.status, status);
      return true;
    });
  }
});

test('sessions are kept per person and cleared one at a time; the old token settings can be forgotten', () => {
  const storage = memoryStorage({ [LEGACY_SYNC_KEY]: '{"owner":"me","token":"github_pat_old"}', 'piq.settings.v1': '{"batchSize":10}' });
  assert.equal(SESSIONS_KEY, 'piq.sessions.v1');
  assert.equal(LEGACY_SYNC_KEY, 'piq.sync.v1');
  assert.equal(sessionFor('anna', storage), null);
  saveSession('anna', 'v1.anna.one', storage);
  saveSession('ben', 'v1.ben.two', storage);
  saveSession('anna', 'v1.anna.three', storage);
  assert.equal(sessionFor('anna', storage), 'v1.anna.three', 'a new session replaces the old one');
  assert.equal(sessionFor('ben', storage), 'v1.ben.two');
  assert.deepEqual(JSON.parse(storage.getItem(SESSIONS_KEY)), { anna: 'v1.anna.three', ben: 'v1.ben.two' });
  clearSession('anna', storage);
  assert.equal(sessionFor('anna', storage), null);
  assert.equal(sessionFor('ben', storage), 'v1.ben.two', 'only that person');
  clearSession('nobody', storage);
  clearSession('ben', storage);
  assert.equal(storage.getItem(SESSIONS_KEY), null, 'nobody left, nothing stored');
  for (const junk of ['not json', '["v1.anna.x"]', '{"anna":5}', 'null']) {
    storage.setItem(SESSIONS_KEY, junk);
    assert.equal(sessionFor('anna', storage), null, `unreadable sessions (${junk}) mean none`);
  }
  saveSession('anna', 'v1.anna.four', storage);
  assert.equal(sessionFor('anna', storage), 'v1.anna.four', 'saving over unreadable sessions works');
  forgetLegacySync(storage);
  assert.equal(storage.getItem(LEGACY_SYNC_KEY), null, 'the old token is gone');
  assert.equal(storage.getItem('piq.settings.v1'), '{"batchSize":10}', 'device settings stay');
  forgetLegacySync(storage);
  assert.equal(sessionFor('ben', memoryStorage()), null);
});

test('end to end: Anna signs up on her phone, her laptop sees its review, and Ben never sees hers', async () => {
  const gh = fakeGitHub();
  const fetchImpl = throughWorker(gh);
  const opts = { api: API, fetchImpl };
  const anna = await createAccount({ id: 'anna', name: 'Anna', password: 'anna password 1', familyCode: '  pickle court FOREVER' }, opts);
  assert.deepEqual(anna.person, { id: 'anna', name: 'Anna' });
  let phone = emptyProgress('phone-333333', 'Phone', 'anna');
  review(phone, 'c-1', Rating.Good, '2026-11-04T12:00:00.000Z');
  phone = await syncProgress(makeAccountClient(anna.session, opts), phone, { dir: progressFolder(null, 'anna'), merge });

  const onLaptop = await signIn({ id: 'anna', password: 'anna password 1' }, opts);
  assert.equal(onLaptop.person.name, 'Anna');
  let laptop = emptyProgress('laptop-444444', 'Laptop', 'anna');
  laptop = await syncProgress(makeAccountClient(onLaptop.session, opts), laptop, { dir: 'progress/anna', merge });
  assert.equal(laptop.logs.length, 1, "the laptop has the phone's review");
  assert.equal(laptop.logs[0].device_id, 'phone-333333');
  assert.equal(laptop.cards['c-1'].fsrs.reps, 1);

  const ben = await createAccount({ id: 'ben', name: 'Ben', password: 'ben password 2', familyCode: CODE }, opts);
  const before = gh.calls.length;
  let benPhone = emptyProgress('phone-555555', 'Phone', 'ben');
  review(benPhone, 'c-2', Rating.Again, '2026-11-04T13:00:00.000Z');
  benPhone = await syncProgress(makeAccountClient(ben.session, opts), benPhone, { dir: 'progress/ben', merge });
  assert.equal(benPhone.logs.length, 1, 'Ben has only his own review');
  assert.ok(gh.calls.slice(before).every((c) => !c.url.includes('/progress/anna')), "Ben's sync never reaches Anna's folder");
  const benClient = makeAccountClient(ben.session, opts);
  await assert.rejects(benClient.list('progress/anna'), (e) => e.status === 403);
  await assert.rejects(benClient.getText('progress/anna/phone-333333.json'), (e) => e.status === 403);
  await assert.rejects(benClient.putText('progress/anna/phone-555555.json', '{}', { message: 'x' }), (e) => e.status === 403);

  assert.deepEqual([...gh.store.keys()].sort(), [
    'accounts/anna.json',
    'accounts/ben.json',
    'progress/anna/laptop-444444.json',
    'progress/anna/phone-333333.json',
    'progress/ben/phone-555555.json',
  ]);
  assert.ok(!gh.store.get('accounts/anna.json').text.includes('anna password'), 'the record holds no password');
  const upstream = gh.calls.find((c) => c.method === 'PUT' && c.url.endsWith('progress/anna/phone-333333.json'));
  assert.equal(upstream.headers.Authorization, 'Bearer github_pat_worker', "GitHub sees the Worker's token, not the session");
  assert.equal(JSON.parse(upstream.bodyText).message, 'progress: anna, Phone', 'the device still writes the commit message');
});

test('a password reset loses nothing: signed-in devices keep syncing, and the account made again has every review', async () => {
  const gh = fakeGitHub();
  const opts = { api: API, fetchImpl: throughWorker(gh) };
  const anna = await createAccount({ id: 'anna', name: 'Anna', password: 'anna password 1', familyCode: CODE }, opts);
  const client = makeAccountClient(anna.session, opts);
  let phone = emptyProgress('phone-333333', 'Phone', 'anna');
  let laptop = emptyProgress('laptop-444444', 'Laptop', 'anna');
  review(phone, 'c-1', Rating.Good, '2026-11-04T12:00:00.000Z');
  phone = await syncProgress(client, phone, { dir: 'progress/anna', merge });
  review(laptop, 'c-2', Rating.Good, '2026-11-04T12:30:00.000Z');
  laptop = await syncProgress(client, laptop, { dir: 'progress/anna', merge });

  gh.store.delete('accounts/anna.json'); // Jeremy resets her password
  review(phone, 'c-3', Rating.Hard, '2026-11-05T08:00:00.000Z');
  phone = await syncProgress(client, phone, { dir: 'progress/anna', merge });
  review(laptop, 'c-4', Rating.Easy, '2026-11-05T09:00:00.000Z');
  laptop = await syncProgress(client, laptop, { dir: 'progress/anna', merge });
  assert.equal(laptop.logs.length, 4, 'both devices kept syncing through the reset');

  await assert.rejects(signIn({ id: 'anna', password: 'anna password 9' }, opts), { message: 'No account with that name yet. Check the spelling, or create an account.' });
  const again = await createAccount({ id: 'anna', name: 'Anna', password: 'anna password 9', familyCode: CODE }, opts);
  let tablet = emptyProgress('tablet-666666', 'Tablet', 'anna');
  tablet = await syncProgress(makeAccountClient(again.session, opts), tablet, { dir: 'progress/anna', merge });
  assert.deepEqual(Object.keys(tablet.cards).sort(), ['c-1', 'c-2', 'c-3', 'c-4'], 'the new tablet holds every review from both devices');
  assert.equal(tablet.logs.length, 4);
  await assert.rejects(signIn({ id: 'anna', password: 'anna password 1' }, opts), { message: 'That password is not right.' });
  assert.equal((await signIn({ id: 'anna', password: 'anna password 9' }, opts)).person.id, 'anna');
});

test('a new session key: a sync answered 401 keeps the record, and signing in again uploads the review made offline', async () => {
  const gh = fakeGitHub();
  let env = workerEnv();
  const opts = { api: API, fetchImpl: throughWorker(gh, () => env) };
  const anna = await createAccount({ id: 'anna', name: 'Anna', password: 'anna password 1', familyCode: CODE }, opts);
  let laptop = emptyProgress('laptop-444444', 'Laptop', 'anna');
  review(laptop, 'c-1', Rating.Good, '2026-11-04T12:00:00.000Z');
  laptop = await syncProgress(makeAccountClient(anna.session, opts), laptop, { dir: 'progress/anna', merge });
  review(laptop, 'c-2', Rating.Good, '2026-11-04T18:00:00.000Z'); // offline

  env = workerEnv({ SESSION_SECRET: 'a-new-session-secret-for-everyone' }); // Jeremy changes the session key
  await assert.rejects(syncProgress(makeAccountClient(anna.session, opts), laptop, { dir: 'progress/anna', merge }), (e) => {
    assert.equal(e.status, 401);
    assert.match(e.message, /\(401\)\. You are signed out\. Sign in again in Settings\.$/);
    return true;
  });
  assert.equal(laptop.logs.length, 2, 'the record still has the review made offline');
  assert.equal(JSON.parse(gh.store.get('progress/anna/laptop-444444.json').text).logs.length, 1, 'nothing was written');

  const again = await signIn({ id: 'anna', password: 'anna password 1' }, opts);
  assert.notEqual(again.session, anna.session, 'a new key signs a new session');
  laptop = await syncProgress(makeAccountClient(again.session, opts), laptop, { dir: 'progress/anna', merge });
  assert.equal(JSON.parse(gh.store.get('progress/anna/laptop-444444.json').text).logs.length, 2, 'the offline review is uploaded');
  assert.equal(SIGNED_OUT, 'You are signed out. Sign in again in Settings.');
});
