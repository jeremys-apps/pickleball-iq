// Sync logic against an in-memory fake of the GitHub contents API. This checks
// our request shapes and the multi-device flow, not GitHub itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeGitHubClient, syncProgress, pullDeck, progressFolder } from '../app/src/store/github-sync.js';
import { emptyProgress, recordReview, mergeProgress } from '../app/src/store/progress.js';
import { makeScheduler, Rating } from '../app/src/srs/scheduler.js';

const sha = (t) => createHash('sha1').update(t).digest('hex');
const resp = (status, body) => new Response(body, { status });

function fakeGitHub(initial = {}) {
  const store = new Map(Object.entries(initial).map(([p, t]) => [p, { text: t, sha: sha(t) }]));
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    calls.push({ url, method, headers: opts.headers, body: opts.body });
    const u = new URL(url);
    const m = u.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/?(.*)$/);
    const path = decodeURIComponent(m[1]);
    if (method === 'GET') {
      if (store.has(path)) {
        const f = store.get(path);
        if (opts.headers.Accept.includes('raw')) return resp(200, f.text);
        return resp(200, JSON.stringify({ type: 'file', name: path.split('/').pop(), path, sha: f.sha }));
      }
      const kids = [...store.keys()].filter((k) => k.startsWith(path + '/'));
      if (kids.length) return resp(200, JSON.stringify(kids.map((k) => ({ type: 'file', name: k.split('/').pop(), path: k, sha: store.get(k).sha }))));
      return resp(404, JSON.stringify({ message: 'Not Found' }));
    }
    const body = JSON.parse(opts.body);
    const existing = store.get(path);
    if (existing && body.sha !== existing.sha) return resp(409, JSON.stringify({ message: 'sha does not match' }));
    if (!existing && body.sha) return resp(422, JSON.stringify({ message: 'sha given for a new file' }));
    const text = Buffer.from(body.content, 'base64').toString('utf8');
    store.set(path, { text, sha: sha(text) });
    return resp(existing ? 200 : 201, JSON.stringify({ content: { path } }));
  };
  return { fetchImpl, store, calls };
}

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
