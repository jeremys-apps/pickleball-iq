// An in-memory fake of the GitHub contents API, shared by the sync and Worker
// tests. It checks request shapes and multi-device flows, not GitHub itself.
import { createHash } from 'node:crypto';

export const sha = (t) => createHash('sha1').update(t).digest('hex');
export const resp = (status, body) => new Response(body, { status });

export function fakeGitHub(initial = {}) {
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
