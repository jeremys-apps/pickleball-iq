// Sync logic against an in-memory fake of the GitHub contents API. This checks
// our request shapes and the multi-device flow, not GitHub itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGitHubClient, syncProgress, pullDeck, progressFolder } from '../app/src/store/github-sync.js';
import { emptyProgress, recordReview, mergeProgress } from '../app/src/store/progress.js';
import { makeScheduler, Rating } from '../app/src/srs/scheduler.js';
import { fakeGitHub, resp, sha } from './fake-github.mjs';

const s = makeScheduler({ enableFuzz: false });
const review = (p, id, rating, iso) => {
  const { state } = s.review(p.cards[id]?.fsrs ?? s.newState(new Date(iso)), rating, new Date(iso));
  return recordReview(p, id, state, { rating, reviewed_at: iso });
};
const merge = (a, b) => mergeProgress(a, b, { replay: s.replay });
const cfg = { owner: 'me', repo: 'piq-data', branch: 'main', token: 'github_pat_test' };

test('phone and laptop converge through per-device files', async () => {
  const gh = fakeGitHub();
  const client = makeGitHubClient(cfg, gh.fetchImpl);
  let phone = emptyProgress('phone-111111', 'Jeremy’s phone');
  let laptop = emptyProgress('laptop-22222', 'Laptop');
  review(phone, 'c-1', Rating.Good, '2026-09-27T12:00:00.000Z');
  phone = await syncProgress(client, phone, { merge });
  review(laptop, 'c-2', Rating.Good, '2026-09-27T20:00:00.000Z');
  laptop = await syncProgress(client, laptop, { merge });
  phone = await syncProgress(client, phone, { merge });
  assert.equal(phone.logs.length, 2);
  assert.equal(laptop.logs.length, 2);
  assert.deepEqual(Object.keys(phone.cards).sort(), ['c-1', 'c-2']);
  assert.deepEqual([...gh.store.keys()].sort(), ['progress/laptop-22222.json', 'progress/phone-111111.json']);
  assert.equal(JSON.parse(gh.store.get('progress/phone-111111.json').text).device_label, 'Jeremy’s phone', 'UTF-8 survives base64');
  const call = gh.calls[0];
  assert.equal(call.headers.Authorization, 'Bearer github_pat_test');
  assert.equal(call.headers['X-GitHub-Api-Version'], '2022-11-28');
});

test('two people on one data repo sync in separate folders and never see each other’s reviews', async () => {
  const gh = fakeGitHub({ 'progress/old-device.json': JSON.stringify(emptyProgress('old-device', 'Before people')) });
  const client = makeGitHubClient(cfg, gh.fetchImpl);
  let jPhone = emptyProgress('phone-111111', 'Phone', 'jeremy');
  let jLaptop = emptyProgress('laptop-22222', 'Laptop', 'jeremy');
  let aPhone = emptyProgress('phone-333333', 'Phone', 'anna');
  review(jPhone, 'c-1', Rating.Good, '2026-10-05T12:00:00.000Z');
  review(aPhone, 'c-1', Rating.Again, '2026-10-05T12:05:00.000Z');
  const folder = (p) => progressFolder(cfg, p.person_id);
  assert.equal(folder(aPhone), 'progress/anna');
  assert.equal(progressFolder({ progressDir: 'sync/progress' }, 'anna'), 'sync/progress/anna');
  assert.equal(progressFolder(cfg, null), 'progress', 'a record from before people existed stays in the root folder');
  jPhone = await syncProgress(client, jPhone, { dir: folder(jPhone), merge });
  aPhone = await syncProgress(client, aPhone, { dir: folder(aPhone), merge });
  jLaptop = await syncProgress(client, jLaptop, { dir: folder(jLaptop), merge });
  assert.deepEqual([...gh.store.keys()].sort(), ['progress/anna/phone-333333.json', 'progress/jeremy/laptop-22222.json', 'progress/jeremy/phone-111111.json', 'progress/old-device.json']);
  assert.equal(jLaptop.logs.length, 1, 'Jeremy’s laptop sees his phone');
  assert.equal(jLaptop.logs[0].device_id, 'phone-111111');
  assert.equal(jLaptop.cards['c-1'].fsrs.reps, 1);
  assert.equal(aPhone.logs.length, 1, 'Anna sees only her own');
  assert.equal(aPhone.cards['c-1'].fsrs.lapses, 0);
  assert.equal(aPhone.logs[0].rating, Rating.Again);
  const puts = gh.calls.filter((c) => c.method === 'PUT');
  assert.match(puts.at(-1).url, /progress\/jeremy\/laptop-22222\.json$/);
  assert.equal(JSON.parse(puts.at(-1).body).message, 'progress: jeremy, Laptop');
  assert.equal(JSON.parse(gh.store.get('progress/anna/phone-333333.json').text).person_id, 'anna');
});

test('missing deck gives a message that says what to do', async () => {
  const client = makeGitHubClient(cfg, fakeGitHub().fetchImpl);
  await assert.rejects(() => pullDeck(client), /Run build-deck/);
});

test('rejected token produces a clear error', async () => {
  const client = makeGitHubClient(cfg, async () => resp(401, JSON.stringify({ message: 'Bad credentials' })));
  await assert.rejects(() => client.getText('deck/deck.json'), /token was rejected/);
});

test('a given base replaces the GitHub address; reads still name the branch and writes carry it in the body', async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (opts.method === 'PUT') return resp(201, JSON.stringify({ content: { path: 'p', sha: 'abc' } }));
    return resp(200, url.includes('.json') ? '{}' : '[]');
  };
  const base = 'https://court-sense.example.workers.dev/contents';
  const client = makeGitHubClient({ base, token: 'v1.anna.sig', hints: {} }, fetchImpl);
  await client.getText('progress/anna/phone 1.json');
  await client.list('progress/anna');
  await client.putText('progress/anna/phone-333333.json', '{}', { message: 'progress: anna, Phone' });
  assert.deepEqual(
    calls.map((c) => c.url),
    [`${base}/progress/anna/phone%201.json?ref=main`, `${base}/progress/anna?ref=main`, `${base}/progress/anna/phone-333333.json`],
  );
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer v1.anna.sig', 'the session goes where the token went');
  assert.equal(calls[1].opts.headers.Accept, 'application/vnd.github+json');
  assert.deepEqual(JSON.parse(calls[2].opts.body), { message: 'progress: anna, Phone', content: Buffer.from('{}').toString('base64'), branch: 'main' });
});

test("empty hints leave the service's own message alone, and every failure carries its status", async () => {
  const base = 'https://court-sense.example.workers.dev/contents';
  const answer = (status, body) => async () => resp(status, typeof body === 'string' ? body : JSON.stringify(body));
  const signedOut = makeGitHubClient({ base, token: 'v1.anna.sig', hints: {} }, answer(401, { message: 'You are signed out. Sign in again in Settings.' }));
  await assert.rejects(signedOut.getText('deck/deck.json'), { message: 'Reading deck/deck.json failed (401). You are signed out. Sign in again in Settings.', status: 401 });
  const forbidden = makeGitHubClient({ base, token: 'v1.ben.sig', hints: {} }, answer(403, { message: 'Not allowed.' }));
  await assert.rejects(forbidden.list('progress/anna'), { message: 'Listing progress/anna failed (403). Not allowed.', status: 403 });
  const silent = makeGitHubClient({ base, token: 'v1.anna.sig', hints: {} }, answer(500, 'not json'));
  await assert.rejects(silent.putText('progress/anna/a.json', '{}', { message: 'm' }), { message: 'Writing progress/anna/a.json failed (500).', status: 500 });
  const github = makeGitHubClient(cfg, answer(401, { message: 'Bad credentials' }));
  await assert.rejects(github.getText('deck/deck.json'), {
    message: 'Reading deck/deck.json failed (401). The token was rejected. Create a new one and paste it in Settings. Bad credentials',
    status: 401,
  });
});

test('requests take the shapes the contents API documents', async () => {
  const gh = fakeGitHub({ 'progress/jeremy/a.json': '{"x":1}', 'my notes/a b.json': '{}' });
  const client = makeGitHubClient(cfg, gh.fetchImpl);
  assert.equal(await client.getText('progress/jeremy/a.json'), '{"x":1}');
  const files = await client.list('progress/jeremy');
  await client.putText('progress/jeremy/b.json', 'Jeremy’s phone', { message: 'progress: jeremy, Phone' });
  await client.putText('progress/jeremy/a.json', '{"x":2}', { sha: files[0].sha, message: 'progress: jeremy' });
  assert.equal(await client.getText('my notes/a b.json'), '{}');
  const [get, list, create, update, spaced] = gh.calls;
  const base = 'https://api.github.com/repos/me/piq-data/contents';
  assert.equal(get.url, `${base}/progress/jeremy/a.json?ref=main`, 'reads name the branch');
  assert.equal(get.method, 'GET');
  assert.equal(get.headers.Accept, 'application/vnd.github.raw+json', 'files come back raw');
  assert.equal(get.headers.Authorization, 'Bearer github_pat_test');
  assert.equal(get.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(list.url, `${base}/progress/jeremy?ref=main`);
  assert.equal(list.headers.Accept, 'application/vnd.github+json', 'listings come back as JSON');
  assert.equal(create.url, `${base}/progress/jeremy/b.json`, 'writes carry the branch in the body, not the URL');
  assert.equal(create.method, 'PUT');
  assert.equal(create.headers['Content-Type'], 'application/json');
  const created = JSON.parse(create.body);
  assert.deepEqual(Object.keys(created).sort(), ['branch', 'content', 'message'], 'a new file has no sha');
  assert.equal(created.branch, 'main');
  assert.equal(created.message, 'progress: jeremy, Phone');
  assert.equal(Buffer.from(created.content, 'base64').toString('utf8'), 'Jeremy’s phone', 'UTF-8 survives base64');
  assert.equal(JSON.parse(update.body).sha, files[0].sha, 'an update names the sha it replaces');
  assert.equal(spaced.url, `${base}/my%20notes/a%20b.json?ref=main`, 'each path segment is encoded');
});

test('a file that changed between the listing and the write is written after one refresh', async () => {
  const path = 'progress/jeremy/phone-111111.json';
  const mine = emptyProgress('phone-111111', 'Phone', 'jeremy');
  const gh = fakeGitHub({ [path]: JSON.stringify(mine) });
  let raced = false;
  const fetchImpl = async (url, opts = {}) => {
    if (opts.method === 'PUT' && !raced) {
      raced = true; // another tab on this device wrote the file first
      const other = JSON.stringify({ ...mine, device_label: 'Other tab' });
      gh.store.set(path, { text: other, sha: sha(other) });
    }
    return gh.fetchImpl(url, opts);
  };
  review(mine, 'c-1', Rating.Good, '2026-11-01T12:00:00.000Z');
  await syncProgress(makeGitHubClient(cfg, fetchImpl), mine, { dir: 'progress/jeremy', merge });
  const puts = gh.calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 2, 'one refused write, then one with the fresh sha');
  assert.notEqual(JSON.parse(puts[0].body).sha, JSON.parse(puts[1].body).sha);
  assert.equal(JSON.parse(gh.store.get(path).text).logs.length, 1, 'the review landed');
});

test('a file that keeps changing under the write fails after one refresh, with the conflict in the error', async () => {
  const path = 'progress/jeremy/phone-111111.json';
  const mine = emptyProgress('phone-111111', 'Phone', 'jeremy');
  const gh = fakeGitHub({ [path]: JSON.stringify(mine) });
  let n = 0;
  const fetchImpl = async (url, opts = {}) => {
    if (opts.method === 'PUT') {
      const other = JSON.stringify({ ...mine, device_label: `Other tab ${++n}` });
      gh.store.set(path, { text: other, sha: sha(other) });
    }
    return gh.fetchImpl(url, opts);
  };
  await assert.rejects(() => syncProgress(makeGitHubClient(cfg, fetchImpl), mine, { dir: 'progress/jeremy', merge }), /\(409\)/);
  assert.equal(gh.calls.filter((c) => c.method === 'PUT').length, 2, 'it refreshes once, not forever');
});
