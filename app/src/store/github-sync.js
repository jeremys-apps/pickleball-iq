// Sync through a PRIVATE GitHub repo using the REST contents API, which the app
// reaches through the sign-in Worker (server/). The Worker holds the only GitHub
// token and passes a signed-in person's requests through, for the deck and that
// person's own folder only; the device sends its session where a token would go
// (store/account.js).
//
// Layout of the data repo (for example you/pickleball-iq-data):
//   deck/deck.json                         built by `python pipeline/piq.py build-deck`
//   progress/<person_id>/<device_id>.json  one folder per person, one file per
//                                          device; a device writes only its own
//                                          file and reads only its person's folder
//   accounts/<person_id>.json              written by the Worker at sign-up
//
// STATUS: tested against a fake GitHub (tests/fake-github.mjs), and the Worker
// against real GitHub on 2026-11-03. Phase 3 in docs/PRD.md covers the first
// real syncs.

const API = 'https://api.github.com';

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

// Text added to a failure, by status, when the credential is a GitHub token.
const TOKEN_HINTS = Object.freeze({
  401: 'The token was rejected. Create a new one and paste it in Settings.',
  403: 'The token lacks access. It needs Contents: Read and write on this repository.',
  404: 'Not found. Check the owner, repository, branch and path.',
});

// base is where the contents API lives: GitHub's own by default, or the sign-in
// Worker's /contents, which answers the same requests. hints are added to a
// failure's message by status; the Worker's own messages need none. A failure
// carries its status, so a caller can tell a refused session from no network.
export function makeGitHubClient(
  { owner, repo, branch = 'main', token, base = `${API}/repos/${owner}/${repo}/contents`, hints = TOKEN_HINTS },
  fetchImpl = globalThis.fetch,
) {
  const headers = (accept) => ({
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
  });
  const url = (path) => `${base}/${encodePath(path)}?ref=${encodeURIComponent(branch)}`;

  async function check(res, what) {
    if (res.ok) return res;
    let detail = '';
    try {
      detail = (await res.json()).message ?? '';
    } catch {
      /* ignore */
    }
    const err = new Error([`${what} failed (${res.status}).`, hints[res.status], detail].filter(Boolean).join(' '));
    err.status = res.status;
    throw err;
  }

  return {
    // File contents as text, or null if the file does not exist.
    async getText(path) {
      const res = await fetchImpl(url(path), { headers: headers('application/vnd.github.raw+json') });
      if (res.status === 404) return null;
      await check(res, `Reading ${path}`);
      return res.text();
    },
    // Directory listing: [{name, path, sha, type}], or [] if the directory does not exist.
    async list(dir) {
      const res = await fetchImpl(url(dir), { headers: headers('application/vnd.github+json') });
      if (res.status === 404) return [];
      await check(res, `Listing ${dir}`);
      const body = await res.json();
      return Array.isArray(body) ? body : [];
    },
    // Create or update a file. sha is required when updating.
    async putText(path, text, { sha, message }) {
      const res = await fetchImpl(`${base}/${encodePath(path)}`, {
        method: 'PUT',
        headers: { ...headers('application/vnd.github+json'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: b64EncodeUtf8(text), branch, ...(sha ? { sha } : {}) }),
      });
      await check(res, `Writing ${path}`);
      return res.json();
    },
  };
}

export async function pullDeck(client, path = 'deck/deck.json') {
  const text = await client.getText(path);
  if (text == null) throw new Error(`No deck at ${path} in the data repository yet. Run build-deck and push it.`);
  return JSON.parse(text);
}

// The folder a person's files live in: progress/<person_id>. With no person
// (records from before people existed) it is the root progress folder.
export const progressFolder = (cfg, personId) => (personId ? `${cfg?.progressDir || 'progress'}/${personId}` : cfg?.progressDir || 'progress');

// Read every device file in the folder, merge into local, then write our own
// file. Subfolders (other people, when dir is the root) are skipped.
export async function syncProgress(client, local, { dir = 'progress', merge }) {
  const files = await client.list(dir);
  const ownName = `${local.device_id}.json`;
  let merged = local;
  for (const f of files) {
    if (f.type !== 'file' || !f.name.endsWith('.json')) continue;
    const text = await client.getText(f.path);
    if (!text) continue;
    merged = merge(merged, JSON.parse(text));
  }
  const own = files.find((f) => f.name === ownName);
  const put = async (sha) =>
    client.putText(`${dir}/${ownName}`, JSON.stringify(merged), {
      sha,
      message: `progress: ${[local.person_id, local.device_label || local.device_id].filter(Boolean).join(', ')}`,
    });
  try {
    await put(own?.sha);
  } catch (e) {
    // Our own file changed underneath us (for example two tabs). Refresh its sha once.
    if (!/\((409|422)\)/.test(String(e.message))) throw e;
    const again = (await client.list(dir)).find((f) => f.name === ownName);
    await put(again?.sha);
  }
  return merged;
}
