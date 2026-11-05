// The sign-in Worker against the fake GitHub: accounts, sessions, the paths a
// session may reach, what a browser needs to read the answers, and what happens
// when GitHub itself fails. Node's fetch ignores CORS, so the headers are
// asserted directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeGitHub, resp, sha } from './fake-github.mjs';
import worker, { handle, routeFor } from '../server/src/worker.js';
import { hashKey, keyMatches, signSession, readSession, sameFamilyCode, toBase64url, fromBase64url } from '../server/src/auth.js';

const BASE = 'https://court-sense.example.workers.dev';
const ORIGIN = 'https://jeremys-apps.github.io';
const LOCAL = 'http://localhost:8000';
const SECRET = 'test-session-secret-0123456789';
const SIGNED_OUT = 'You are signed out. Sign in again in Settings.';
const SERVER_DOWN = 'Sync is not working on the server. Your progress is safe on this device.';
const env = (over = {}) => ({
  GITHUB_TOKEN: 'github_pat_worker',
  SESSION_SECRET: SECRET,
  FAMILY_CODE: 'Pickle Court Forever',
  DATA_REPO: 'me/piq-data',
  BRANCH: 'main',
  ALLOWED_ORIGINS: `${ORIGIN}, ${LOCAL}`,
  ...over,
});
// Stands in for the 32-byte key the device derives from a password.
const keyOf = (n) => toBase64url(new Uint8Array(32).fill(n));

async function call(gh, method, path, { body, raw, session, origin = ORIGIN, env: e = env(), headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (session) h.Authorization = `Bearer ${session}`;
  const init = { method, headers: h };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }
  return handle(new Request(BASE + path, init), e, { fetchImpl: gh.fetchImpl ?? gh });
}

async function account(gh, id, name, n = 1) {
  const res = await call(gh, 'POST', '/accounts', { body: { id, name, key: keyOf(n), family_code: 'Pickle Court Forever' } });
  assert.equal(res.status, 201, `sign-up for ${id}`);
  return (await res.json()).session;
}

const schema = JSON.parse(readFileSync(new URL('../schemas/account.schema.json', import.meta.url)));

test('sign-up with the family code writes an account record that holds no password or key', async () => {
  const gh = fakeGitHub();
  const res = await call(gh, 'POST', '/accounts', { body: { id: 'mary-ann', name: ' Mary Ann ', key: keyOf(7), family_code: '  pickle   COURT forever ' } });
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.deepEqual(out.person, { id: 'mary-ann', name: 'Mary Ann' }, 'the name is trimmed');
  assert.match(out.session, /^v1\.mary-ann\.[A-Za-z0-9_-]{43}$/);
  const rec = JSON.parse(gh.store.get('accounts/mary-ann.json').text);
  for (const k of schema.required) assert.ok(k in rec, `the record has ${k}`);
  for (const k of Object.keys(rec)) assert.ok(k in schema.properties, `${k} is in the schema`);
  for (const [k, prop] of Object.entries(schema.properties)) if (prop.pattern) assert.match(rec[k], new RegExp(prop.pattern), k);
  assert.equal(rec.schema_version, 1);
  assert.ok(!Number.isNaN(Date.parse(rec.created_at)));
  assert.ok(!JSON.stringify(rec).includes(keyOf(7)), 'the key itself is not stored');
  assert.equal(await keyMatches(rec, keyOf(7)), true);
  assert.equal(await keyMatches(rec, keyOf(8)), false);
  const put = JSON.parse(gh.calls.find((c) => c.method === 'PUT').bodyText);
  assert.equal(put.message, 'account: mary-ann');
  assert.equal(put.branch, 'main');
  assert.ok(!('sha' in put), 'create-only: a write without a sha cannot replace a record');
});

test('sign-up refuses a wrong or missing family code, and nobody signs up while no code is set', async () => {
  const gh = fakeGitHub();
  for (const family_code of ['pickle court', '', undefined, 42]) {
    const res = await call(gh, 'POST', '/accounts', { body: { id: 'anna', name: 'Anna', key: keyOf(1), family_code } });
    assert.equal(res.status, 403, `code ${family_code}`);
    assert.equal((await res.json()).message, 'That family code is not right.');
  }
  const res = await call(gh, 'POST', '/accounts', { body: { id: 'anna', name: 'Anna', key: keyOf(1), family_code: '' }, env: env({ FAMILY_CODE: '' }) });
  assert.equal(res.status, 403);
  assert.equal(gh.calls.length, 0, 'nothing was written');
});

test('sign-up refuses a name that is taken and keeps the first record', async () => {
  const gh = fakeGitHub();
  await account(gh, 'anna', 'Anna', 1);
  const first = gh.store.get('accounts/anna.json').text;
  const res = await call(gh, 'POST', '/accounts', { body: { id: 'anna', name: 'anna', key: keyOf(2), family_code: 'Pickle Court Forever' } });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).message, 'There is already an account with that name. Sign in instead.');
  assert.equal(gh.store.get('accounts/anna.json').text, first);
});

test('a blank or broken account record counts as deleted: sign-in finds no account, and the account is made again over it, keeping the progress', async () => {
  const progress = JSON.stringify({ schema_version: 1, device_id: 'phone-1', updated_at: '2026-11-05T00:00:00.000Z', cards: {}, logs: [] });
  // Emptied on GitHub's website, cut short, or edited by hand: none holds a salt and a hash.
  for (const broken of ['\n', '', '   ', '{', 'null', '[]', '"Anna"', '{}', '{"salt": "x"}', '{"schema_version": 1, "id": "anna", "name": "Anna"}']) {
    const gh = fakeGitHub({ 'accounts/anna.json': broken, 'progress/anna/phone-1.json': progress });
    const what = `over ${JSON.stringify(broken)}`;
    const signIn = await call(gh, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(1) } });
    assert.equal(signIn.status, 404, `sign-in ${what}`);
    assert.equal((await signIn.json()).message, 'No account with that name yet. Check the spelling, or create an account.');
    const wrongCode = await call(gh, 'POST', '/accounts', { body: { id: 'anna', name: 'Anna', key: keyOf(2), family_code: 'pickle court' } });
    assert.equal(wrongCode.status, 403, `the family code still comes first ${what}`);
    assert.equal(gh.store.get('accounts/anna.json').text, broken);

    const made = await call(gh, 'POST', '/accounts', { body: { id: 'anna', name: 'Anna', key: keyOf(2), family_code: 'Pickle Court Forever' } });
    assert.equal(made.status, 201, `sign-up ${what}`);
    const rec = JSON.parse(gh.store.get('accounts/anna.json').text);
    assert.equal(await keyMatches(rec, keyOf(2)), true, `the new record replaced the old file ${what}`);
    const replace = JSON.parse(gh.calls.filter((c) => c.method === 'PUT').pop().bodyText);
    assert.equal(replace.sha, sha(broken), 'replaced by its own sha, so nothing written meanwhile is overwritten');
    assert.equal(replace.message, 'account: anna');
    assert.equal((await call(gh, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(2) } })).status, 200);
    assert.equal(gh.store.get('progress/anna/phone-1.json').text, progress, 'the progress is untouched');
  }
});

test('a broken record is replaced only by its own sha: an account made in the meantime is kept', async () => {
  const gh = fakeGitHub({ 'accounts/anna.json': '\n' });
  const elsewhere = fakeGitHub();
  await account(elsewhere, 'anna', 'Anna', 3);
  const real = elsewhere.store.get('accounts/anna.json').text;
  // Someone else's sign-up lands right after the Worker reads the broken file's sha.
  const fetchImpl = async (url, opts = {}) => {
    const res = await gh.fetchImpl(url, opts);
    if ((opts.method ?? 'GET') === 'GET' && !opts.headers.Accept.includes('raw') && url.includes('/accounts/anna.json')) {
      gh.store.set('accounts/anna.json', { text: real, sha: sha(real) });
    }
    return res;
  };
  const res = await call({ fetchImpl }, 'POST', '/accounts', { body: { id: 'anna', name: 'Anna', key: keyOf(2), family_code: 'Pickle Court Forever' } });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).message, 'There is already an account with that name. Sign in instead.');
  assert.equal(gh.store.get('accounts/anna.json').text, real, 'the account made meanwhile is kept');
});

test('if the account file vanishes between a refused write and the read, the account is created', async () => {
  const gh = fakeGitHub();
  let refused = false;
  const fetchImpl = async (url, opts = {}) => {
    if (opts.method === 'PUT' && !refused) {
      refused = true;
      return resp(422, JSON.stringify({ message: 'Invalid request. "sha" wasn\'t supplied.' }));
    }
    return gh.fetchImpl(url, opts);
  };
  const res = await call({ fetchImpl }, 'POST', '/accounts', { body: { id: 'anna', name: 'Anna', key: keyOf(2), family_code: 'Pickle Court Forever' } });
  assert.equal(res.status, 201);
  assert.equal(await keyMatches(JSON.parse(gh.store.get('accounts/anna.json').text), keyOf(2)), true);
});

test('sign-up and sign-in refuse malformed input without touching GitHub', async () => {
  const gh = fakeGitHub();
  const good = { id: 'anna', name: 'Anna', key: keyOf(1), family_code: 'Pickle Court Forever' };
  const bad = [
    { ...good, id: 'Anna' },
    { ...good, id: '-anna' },
    { ...good, id: 'a'.repeat(41) },
    { ...good, id: '../anna' },
    { ...good, id: ['anna'] },
    { ...good, id: undefined },
    { ...good, name: '   ' },
    { ...good, name: 'x'.repeat(61) },
    { ...good, name: 'Anna\nBen' },
    { ...good, name: 7 },
    { ...good, key: keyOf(1).slice(1) },
    { ...good, key: `${keyOf(1).slice(1)}+` },
    { ...good, key: undefined },
  ];
  for (const body of bad) {
    const res = await call(gh, 'POST', '/accounts', { body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  for (const raw of ['not json', '[1,2]', 'null']) {
    assert.equal((await call(gh, 'POST', '/accounts', { raw, headers: { 'Content-Type': 'application/json' } })).status, 400, raw);
    assert.equal((await call(gh, 'POST', '/sessions', { raw, headers: { 'Content-Type': 'application/json' } })).status, 400, raw);
  }
  assert.equal((await call(gh, 'POST', '/sessions', { body: { id: 'anna' } })).status, 400);
  assert.equal((await call(gh, 'POST', '/sessions', { body: { id: 'Anna', key: keyOf(1) } })).status, 400);
  assert.equal(gh.calls.length, 0);
});

test('sign-in returns a session for the right key, and says whether the name or the password was wrong', async () => {
  const gh = fakeGitHub();
  const fromSignUp = await account(gh, 'anna', 'Anna', 3);
  let res = await call(gh, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(3) } });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual(out.person, { id: 'anna', name: 'Anna' });
  assert.equal((await readSession(SECRET, out.session)).id, 'anna');
  assert.equal(out.session, fromSignUp, 'a session names the person, so every device gets the same one');
  res = await call(gh, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(4) } });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).message, 'That password is not right.');
  res = await call(gh, 'POST', '/sessions', { body: { id: 'ben', key: keyOf(3) } });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).message, 'No account with that name yet. Check the spelling, or create an account.');
  const read = gh.calls.filter((c) => c.method === 'GET').at(-1);
  assert.equal(read.url, 'https://api.github.com/repos/me/piq-data/contents/accounts/ben.json?ref=main');
  assert.equal(read.headers.Accept, 'application/vnd.github.raw+json');
});

test("a signed-in person gets the deck and their own folder through the Worker's token, which never comes back", async () => {
  const gh = fakeGitHub({
    'deck/deck.json': '{"cards":[]}',
    'progress/anna/phone-333333.json': '{"a":1}',
    'progress/anna/laptop-22222.json': '{"a":2}',
    'progress/ben/phone-444444.json': '{}',
  });
  const anna = await account(gh, 'anna', 'Anna');
  let res = await call(gh, 'GET', '/contents/deck/deck.json?ref=other-branch', { session: anna, headers: { Accept: 'application/vnd.github.raw+json' } });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{"cards":[]}');
  let up = gh.calls.at(-1);
  assert.equal(up.url, 'https://api.github.com/repos/me/piq-data/contents/deck/deck.json?ref=main', "the Worker's branch, not the client's");
  assert.equal(up.headers.Authorization, 'Bearer github_pat_worker');
  assert.equal(up.headers['User-Agent'], 'court-sense-worker');
  assert.equal(up.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(up.headers.Accept, 'application/vnd.github.raw+json');
  for (const [, v] of res.headers) assert.ok(!v.includes('github_pat_worker'));

  res = await call(gh, 'GET', '/contents/progress/anna?ref=main', { session: anna, headers: { Accept: 'application/vnd.github.raw+json' } });
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.deepEqual(list.map((f) => f.name).sort(), ['laptop-22222.json', 'phone-333333.json']);
  for (const f of list) assert.deepEqual(Object.keys(f).sort(), ['name', 'path', 'sha', 'type'], 'download links and URLs are dropped');
  assert.equal(gh.calls.at(-1).headers.Accept, 'application/vnd.github+json', 'a listing is asked for as JSON whatever the client sent');

  res = await call(gh, 'GET', '/contents/progress/anna/phone-333333.json', { session: anna });
  assert.equal(await res.text(), '{"a":1}');
  res = await call(gh, 'GET', '/contents/progress/anna/tablet-555555.json', { session: anna });
  assert.equal(res.status, 404, 'a file not there yet is a 404, which the app reads as empty');
  const ben = await account(gh, 'ben-two', 'Ben Two');
  res = await call(gh, 'GET', '/contents/progress/ben-two', { session: ben });
  assert.equal(res.status, 404, 'so is a folder not there yet');
});

test("nobody reaches another person's folder, the account records or the pipeline's files", async () => {
  const gh = fakeGitHub({ 'progress/ben/phone-444444.json': '{}', 'work/tips/x.jsonl': '', 'content/cards.json': '[]' });
  const anna = await account(gh, 'anna', 'Anna');
  const before = gh.calls.length;
  const refused = [
    ['GET', '/contents/progress/ben'],
    ['GET', '/contents/progress/ben/phone-444444.json'],
    ['PUT', '/contents/progress/ben/phone-444444.json'],
    ['GET', '/contents/progress'],
    ['GET', '/contents/progress/anna/'],
    ['GET', '/contents/accounts/anna.json'],
    ['GET', '/contents/work/tips/x.jsonl'],
    ['GET', '/contents/content/cards.json'],
    ['PUT', '/contents/deck/deck.json'],
    ['GET', '/contents/progress/anna/%2E%2E/ben/phone-444444.json'],
    ['GET', '/contents/progress/anna/../ben/phone-444444.json'],
    ['GET', '/contents/progress%2Fben'],
    ['GET', '/contents/progress/anna/sub/phone-333333.json'],
    ['GET', '/contents/progress/anna/PHONE-333333.json'],
    ['GET', '/contents/progress/anna/phone.json'],
    ['GET', '/contents/progress/anna/phone-333333.txt'],
    ['GET', '/contents/progress/anna/%E0%A4%A.json'],
  ];
  for (const [method, path] of refused) {
    const res = await call(gh, method, path, { session: anna, ...(method === 'PUT' ? { raw: '{}' } : {}) });
    assert.equal(res.status, 403, `${method} ${path}`);
  }
  assert.equal(gh.calls.length, before, 'none of them reached GitHub');
});

test("a PUT into your own folder is forwarded byte for byte, and GitHub's conflict answers come back", async () => {
  const gh = fakeGitHub();
  const anna = await account(gh, 'anna', 'Anna');
  const path = '/contents/progress/anna/phone-333333.json';
  const body = JSON.stringify({ message: 'progress: anna, Phone', content: Buffer.from('{"x":"é"}').toString('base64'), branch: 'main' });
  let res = await call(gh, 'PUT', path, { session: anna, raw: body, headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 201);
  const stored = gh.store.get('progress/anna/phone-333333.json');
  assert.deepEqual(await res.json(), { content: { path: 'progress/anna/phone-333333.json', sha: stored.sha } }, 'only the path and sha come back');
  assert.equal(gh.calls.at(-1).bodyText, body, 'byte for byte');
  assert.equal(stored.text, '{"x":"é"}');
  res = await call(gh, 'PUT', path, { session: anna, raw: JSON.stringify({ message: 'm', content: '', branch: 'main', sha: sha('stale') }) });
  assert.equal(res.status, 409);
  assert.match((await res.json()).message, /sha/);
  res = await call(gh, 'PUT', path, { session: anna, raw: JSON.stringify({ message: 'm', content: '', branch: 'main' }) });
  assert.equal(res.status, 422);
});

test('a missing, forged or old session is refused, the deck included, and GitHub is not asked', async () => {
  const gh = fakeGitHub({ 'deck/deck.json': '{}' });
  const anna = await signSession(SECRET, 'anna');
  const forged = `v1.ben.${anna.split('.')[2]}`;
  const oldKey = await signSession('an earlier session secret', 'anna');
  const sig = anna.split('.')[2];
  const flipped = `v1.anna.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`; // changes signature bytes
  // The last of 43 characters carries two unused bits: flipping one keeps the bytes but not the canonical text.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const padding = `v1.anna.${sig.slice(0, -1)}${ALPHABET[ALPHABET.indexOf(sig[42]) ^ 1]}`;
  assert.deepEqual(fromBase64url(padding.split('.')[2]), fromBase64url(sig), 'same bytes');
  for (const auth of [undefined, 'Bearer', 'Bearer garbage', `Bearer ${forged}`, `Bearer ${oldKey}`, `Bearer ${flipped}`, `Bearer ${padding}`, `Basic ${anna}`, `Bearer ${anna}.extra`]) {
    const res = await call(gh, 'GET', '/contents/deck/deck.json', { headers: auth ? { Authorization: auth } : {} });
    assert.equal(res.status, 401, String(auth));
    assert.equal((await res.json()).message, SIGNED_OUT);
  }
  assert.equal(gh.calls.length, 0);
});

test('a session outlives a password reset, and the progress it reaches is untouched', async () => {
  const gh = fakeGitHub({ 'progress/anna/phone-333333.json': '{"kept":true}' });
  const session = await account(gh, 'anna', 'Anna', 1);
  gh.store.delete('accounts/anna.json'); // Jeremy resets the password
  let res = await call(gh, 'GET', '/contents/progress/anna', { session });
  assert.equal(res.status, 200, 'devices already signed in keep syncing');
  res = await call(gh, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(1) } });
  assert.equal(res.status, 404, 'the old password no longer signs in');
  const again = await account(gh, 'anna', 'Anna', 2);
  res = await call(gh, 'GET', '/contents/progress/anna/phone-333333.json', { session: again });
  assert.equal(await res.text(), '{"kept":true}', 'the account created again reads the same folder');
  res = await call(gh, 'GET', '/contents/progress/anna/phone-333333.json', { session });
  assert.equal(res.status, 200, 'and the old session still works');
  assert.equal((await call(gh, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(2) } })).status, 200);
});

test("when GitHub refuses the Worker's token or fails, the answer is 502 and never a 401", async () => {
  const session = await signSession(SECRET, 'anna');
  for (const status of [401, 403, 500, 503]) {
    const failing = async () => resp(status, JSON.stringify({ message: 'Bad credentials' }));
    const answers = [
      await call(failing, 'GET', '/contents/deck/deck.json', { session }),
      await call(failing, 'GET', '/contents/progress/anna', { session }),
      await call(failing, 'GET', '/contents/progress/anna/phone-333333.json', { session }),
      await call(failing, 'PUT', '/contents/progress/anna/phone-333333.json', { session, raw: '{}' }),
      await call(failing, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(1) } }),
      await call(failing, 'POST', '/accounts', { body: { id: 'anna', name: 'Anna', key: keyOf(1), family_code: 'Pickle Court Forever' } }),
    ];
    for (const res of answers) {
      assert.equal(res.status, 502, `GitHub ${status}`);
      assert.equal((await res.json()).message, SERVER_DOWN);
    }
  }
  const quietError = console.error;
  console.error = () => {};
  try {
    const unreachable = async () => {
      throw new TypeError('fetch failed');
    };
    assert.equal((await call(unreachable, 'GET', '/contents/deck/deck.json', { session })).status, 502);
    // A sign-up meets a file under the name, and GitHub's answer about it cannot
    // be read: nothing is replaced. (An account file that reads as anything but
    // a record holds no account; see the blank-record test.)
    const puts = [];
    const unreadable = async (url, opts = {}) => {
      if (opts.method === 'PUT') {
        puts.push(url);
        return resp(422, JSON.stringify({ message: 'Invalid request. "sha" wasn\'t supplied.' }));
      }
      return resp(200, 'not json');
    };
    const res = await call(unreadable, 'POST', '/accounts', { body: { id: 'anna', name: 'Anna', key: keyOf(1), family_code: 'Pickle Court Forever' } });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).message, SERVER_DOWN);
    assert.equal(puts.length, 1, 'only the refused create; no replacing write');
  } finally {
    console.error = quietError;
  }
});

test('every answer to an allowed origin carries the CORS headers, errors included, and forwarded answers are never cached', async () => {
  const gh = fakeGitHub({ 'deck/deck.json': '{}' });
  const anna = await account(gh, 'anna', 'Anna');
  const no = { limit: async () => ({ success: false }) };
  const answers = {
    201: await call(gh, 'POST', '/accounts', { body: { id: 'ben', name: 'Ben', key: keyOf(1), family_code: 'Pickle Court Forever' } }),
    200: await call(gh, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(1) } }),
    400: await call(gh, 'POST', '/sessions', { body: {} }),
    401: await call(gh, 'GET', '/contents/deck/deck.json'),
    403: await call(gh, 'GET', '/contents/progress/ben', { session: anna }),
    404: await call(gh, 'POST', '/sessions', { body: { id: 'cara', key: keyOf(1) } }),
    405: await call(gh, 'GET', '/accounts'),
    409: await call(gh, 'POST', '/accounts', { body: { id: 'anna', name: 'Anna', key: keyOf(1), family_code: 'Pickle Court Forever' } }),
    429: await call(gh, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(1) }, env: env({ SIGN_IN_LIMIT: no }) }),
    502: await call(async () => resp(500, '{}'), 'GET', '/contents/deck/deck.json', { session: anna }),
  };
  for (const [status, res] of Object.entries(answers)) {
    assert.equal(res.status, Number(status));
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN, `${status} carries the origin`);
    assert.match(res.headers.get('Vary') ?? '', /Origin/, `${status} varies by origin`);
  }
  const local = await call(gh, 'GET', '/contents/deck/deck.json', { session: anna, origin: LOCAL });
  assert.equal(local.headers.get('Access-Control-Allow-Origin'), LOCAL, 'the dev server is allowed too');
  const elsewhere = await call(gh, 'GET', '/contents/deck/deck.json', { session: anna, origin: 'https://example.com' });
  assert.equal(elsewhere.headers.get('Access-Control-Allow-Origin'), null, 'another site gets no CORS header, so its browser hides the answer');
  const forwarded = [
    await call(gh, 'GET', '/contents/deck/deck.json', { session: anna }),
    await call(gh, 'GET', '/contents/progress/anna', { session: anna }),
    await call(gh, 'PUT', '/contents/progress/anna/phone-333333.json', { session: anna, raw: JSON.stringify({ message: 'm', content: '', branch: 'main' }) }),
    await call(gh, 'GET', '/contents/progress/anna/phone-333333.json', { session: anna }),
    await call(gh, 'GET', '/contents/progress/anna/tablet-555555.json', { session: anna }),
  ];
  for (const res of forwarded) assert.equal(res.headers.get('Cache-Control'), 'no-store', `${res.status} is not cached`);
});

test('a preflight from an allowed origin gets the methods and headers; from anywhere else it gets none', async () => {
  const gh = fakeGitHub();
  const preflight = (origin) =>
    handle(
      new Request(`${BASE}/contents/deck/deck.json`, {
        method: 'OPTIONS',
        headers: { ...(origin ? { Origin: origin } : {}), 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,x-github-api-version,content-type' },
      }),
      env(),
      { fetchImpl: gh.fetchImpl },
    );
  const res = await preflight(ORIGIN);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  for (const m of ['GET', 'PUT', 'POST', 'OPTIONS']) assert.match(res.headers.get('Access-Control-Allow-Methods'), new RegExp(m));
  for (const h of ['Authorization', 'Accept', 'Content-Type', 'X-GitHub-Api-Version']) assert.match(res.headers.get('Access-Control-Allow-Headers'), new RegExp(h));
  assert.equal(res.headers.get('Access-Control-Max-Age'), '86400');
  for (const origin of ['https://example.com', undefined]) {
    const other = await preflight(origin);
    assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(other.headers.get('Access-Control-Allow-Methods'), null);
  }
  assert.equal(gh.calls.length, 0);
});

test('the sign-in rate limit answers 429 when it says no, counts by address, and limits nothing else', async () => {
  const gh = fakeGitHub({ 'deck/deck.json': '{}' });
  const anna = await account(gh, 'anna', 'Anna');
  const before = gh.calls.length;
  const limiter = {
    keys: [],
    allow: false,
    async limit({ key }) {
      this.keys.push(key);
      return { success: this.allow };
    },
  };
  const e = env({ SIGN_IN_LIMIT: limiter });
  let res = await call(gh, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(1) }, env: e, headers: { 'CF-Connecting-IP': '203.0.113.9' } });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).message, 'Too many tries. Wait a minute and try again.');
  res = await call(gh, 'POST', '/accounts', { body: { id: 'ben', name: 'Ben', key: keyOf(1), family_code: 'Pickle Court Forever' }, env: e, headers: { 'CF-Connecting-IP': '203.0.113.9' } });
  assert.equal(res.status, 429);
  assert.deepEqual(limiter.keys, ['203.0.113.9', '203.0.113.9']);
  assert.equal(gh.calls.length, before, 'a refused try never reaches GitHub');
  assert.equal((await call(gh, 'GET', '/contents/deck/deck.json', { session: anna, env: e })).status, 200, 'syncing is not limited');
  assert.equal(limiter.keys.length, 2);
  limiter.allow = true;
  assert.equal((await call(gh, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(1) }, env: e })).status, 200);
  assert.equal((await call(gh, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(1) } })).status, 200, 'without the binding nothing is limited');
});

test('unknown routes and methods are refused; a Worker missing its settings answers 502 instead of guessing', async () => {
  const gh = fakeGitHub();
  const session = await signSession(SECRET, 'anna');
  assert.equal((await call(gh, 'GET', '/accounts')).status, 405);
  assert.equal((await call(gh, 'PUT', '/sessions', { raw: '{}' })).status, 405);
  assert.equal((await call(gh, 'DELETE', '/contents/progress/anna/phone-333333.json', { session })).status, 405);
  assert.equal((await call(gh, 'POST', '/contents/progress/anna/phone-333333.json', { session, raw: '{}' })).status, 405);
  assert.equal((await call(gh, 'GET', '/')).status, 404);
  assert.equal((await call(gh, 'GET', '/contents')).status, 404);
  for (const missing of ['GITHUB_TOKEN', 'SESSION_SECRET', 'DATA_REPO']) {
    const e = env({ [missing]: '' });
    assert.equal((await call(gh, 'POST', '/sessions', { body: { id: 'anna', key: keyOf(1) }, env: e })).status, 502, missing);
    assert.equal((await call(gh, 'GET', '/contents/deck/deck.json', { session, env: e })).status, 502, missing);
  }
  assert.equal(gh.calls.length, 0);
});

test('routeFor allows exactly the deck, your own folder and your own device files', () => {
  assert.equal(routeFor('GET', 'deck/deck.json', 'anna'), 'deck');
  assert.equal(routeFor('PUT', 'deck/deck.json', 'anna'), null);
  assert.equal(routeFor('GET', 'progress/anna', 'anna'), 'list');
  assert.equal(routeFor('PUT', 'progress/anna', 'anna'), null);
  assert.equal(routeFor('GET', 'progress/anna/62542482-f797-4b4a-bcd2-75d2eba15e5d.json', 'anna'), 'file');
  assert.equal(routeFor('PUT', 'progress/anna/62542482-f797-4b4a-bcd2-75d2eba15e5d.json', 'anna'), 'put');
  assert.equal(routeFor('DELETE', 'progress/anna/phone-333333.json', 'anna'), null);
  assert.equal(routeFor('GET', 'progress/ben', 'anna'), null);
  assert.equal(routeFor('GET', 'progress/anna-b/phone-333333.json', 'anna'), null, 'a longer name sharing the prefix is someone else');
  assert.equal(routeFor('GET', 'progress/anna/x/phone-333333.json', 'anna'), null);
  assert.equal(routeFor('GET', `progress/anna/${'a'.repeat(65)}.json`, 'anna'), null);
  assert.equal(routeFor('GET', 'progress/anna/abcde.json', 'anna'), null, 'device ids have six characters or more');
  assert.equal(routeFor('GET', 'deck/deck.json', 'Anna'), null, 'a malformed id reaches nothing');
  assert.equal(routeFor('GET', 'deck/deck.json', undefined), null);
});

test('auth helpers: salted key hashes, signed sessions and the family code', async () => {
  const salt = toBase64url(new Uint8Array(16).fill(9));
  const a = await hashKey(keyOf(1), salt);
  assert.deepEqual(a, await hashKey(keyOf(1), salt), 'the same key and salt give the same hash');
  assert.notEqual(a.hash, (await hashKey(keyOf(1))).hash, 'a fresh salt gives another hash');
  assert.notEqual(a.hash, (await hashKey(keyOf(2), salt)).hash);
  assert.match(a.hash, /^[A-Za-z0-9_-]{43}$/);
  assert.match((await hashKey(keyOf(1))).salt, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(await keyMatches({ salt, hash: a.hash }, keyOf(1)), true);
  for (const [acct, key] of [[{ salt, hash: a.hash }, 'short'], [{ salt, hash: a.hash }, undefined], [{}, keyOf(1)], [null, keyOf(1)], [{ salt, hash: 'x' }, keyOf(1)]]) {
    assert.equal(await keyMatches(acct, key), false);
  }
  const s = await signSession('k1', 'mary-ann');
  assert.deepEqual(await readSession('k1', s), { id: 'mary-ann' });
  assert.equal(await readSession('k2', s), null, 'a changed secret signs everyone out');
  assert.equal(await readSession('k1', s.replace('v1.', 'v2.')), null);
  assert.equal(await readSession('k1', s.replace('mary-ann', 'mary-anne')), null);
  assert.equal(await readSession('', s), null);
  assert.equal(await readSession('k1', null), null);
  assert.equal(await sameFamilyCode('  Pickle\tCOURT  forever', 'pickle court forever'), true);
  assert.equal(await sameFamilyCode('pickle court', 'pickle court forever'), false);
  assert.equal(await sameFamilyCode('', ''), false, 'an unset code lets nobody in');
  assert.equal(await sameFamilyCode('anything', undefined), false);
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.deepEqual(fromBase64url(toBase64url(all)), all, 'base64url round-trips every byte');
});

test("the module's default export is the Worker's fetch handler", async () => {
  assert.equal(typeof worker.fetch, 'function');
  const res = await worker.fetch(new Request(`${BASE}/sessions`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env());
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('the Worker answers only at its own address: wrangler.toml turns preview addresses off', () => {
  // An uploaded version would otherwise keep answering at its preview address
  // with the secrets it was uploaded with, where a new SESSION_SECRET cuts nobody off.
  const config = readFileSync(new URL('../server/wrangler.toml', import.meta.url), 'utf8');
  const topLevel = config.split(/^\[/m)[0];
  assert.match(topLevel, /^workers_dev\s*=\s*true\s*$/m, 'the Worker keeps its workers.dev address');
  assert.match(topLevel, /^preview_urls\s*=\s*false\s*$/m, 'preview addresses are off, as a top-level setting');
});
