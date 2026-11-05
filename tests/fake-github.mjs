// An in-memory fake of the GitHub contents API, shared by the sync and Worker
// tests. It checks request shapes and multi-device flows, not GitHub itself.
// Like GitHub, it answers a write with a stale sha with 409, a write without a
// sha over an existing file with 422, lists folders with more fields than the
// app uses, download links included, and answers a file asked for as JSON with
// its sha and its content in base64, broken into lines.
import { createHash } from 'node:crypto';

export const sha = (t) => createHash('sha1').update(t).digest('hex');
export const resp = (status, body) => new Response(body, { status });

const entry = (path, f) => ({
  type: 'file',
  name: path.split('/').pop(),
  path,
  sha: f.sha,
  size: f.text.length,
  url: `https://api.github.com/repos/me/piq-data/contents/${path}?ref=main`,
  html_url: `https://github.com/me/piq-data/blob/main/${path}`,
  download_url: `https://raw.githubusercontent.com/me/piq-data/main/${path}?token=SHORT-LIVED-TOKEN`,
});

export function fakeGitHub(initial = {}) {
  const store = new Map(Object.entries(initial).map(([p, t]) => [p, { text: t, sha: sha(t) }]));
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    // Bodies arrive as text from the app and as bytes from the Worker.
    const bodyText = opts.body == null ? undefined : typeof opts.body === 'string' ? opts.body : new TextDecoder().decode(opts.body);
    calls.push({ url, method, headers: opts.headers, body: opts.body, bodyText });
    const u = new URL(url);
    const m = u.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/?(.*)$/);
    const path = decodeURIComponent(m[1]);
    if (method === 'GET') {
      if (store.has(path)) {
        const f = store.get(path);
        if (opts.headers.Accept.includes('raw')) return resp(200, f.text);
        const content = (Buffer.from(f.text, 'utf8').toString('base64').match(/.{1,60}/g) ?? []).join('\n');
        return resp(200, JSON.stringify({ ...entry(path, f), encoding: 'base64', content: content && `${content}\n` }));
      }
      const kids = [...store.keys()].filter((k) => k.startsWith(path + '/'));
      if (kids.length) return resp(200, JSON.stringify(kids.map((k) => entry(k, store.get(k)))));
      return resp(404, JSON.stringify({ message: 'Not Found' }));
    }
    const body = JSON.parse(bodyText);
    const existing = store.get(path);
    if (existing && body.sha === undefined) return resp(422, JSON.stringify({ message: 'Invalid request. "sha" wasn\'t supplied.' }));
    if (existing && body.sha !== existing.sha) return resp(409, JSON.stringify({ message: 'sha does not match' }));
    if (!existing && body.sha) return resp(422, JSON.stringify({ message: 'sha given for a new file' }));
    const text = Buffer.from(body.content, 'base64').toString('utf8');
    const f = { text, sha: sha(text) };
    store.set(path, f);
    return resp(existing ? 200 : 201, JSON.stringify({ content: entry(path, f), commit: { sha: sha(`commit ${path} ${text}`), message: body.message } }));
  };
  return { fetchImpl, store, calls };
}
