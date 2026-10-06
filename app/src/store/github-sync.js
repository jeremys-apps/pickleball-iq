// Sync through a PRIVATE GitHub repo using the REST contents API.
//
// Layout of the data repo (for example you/pickleball-iq-data):
//   deck/deck.json                         built by `python pipeline/piq.py build-deck`
//   progress/<person_id>/<device_id>.json  one folder per person, one file per
//                                          device; a device writes only its own
//                                          file and reads only its person's folder
//
// Token: a fine-grained personal access token limited to that one repository,
// with Contents: Read and write. It is stored in this browser's localStorage,
// so use an expiring token and revoke it if a device is lost.
//
// STATUS: written against the documented API but not yet exercised against
// GitHub. Phase 3 in docs/PRD.md covers testing it.

export const SYNC_KEY = 'piq.sync.v1';
const API = 'https://api.github.com';

export function loadSyncConfig(storage = globalThis.localStorage) {
  try {
    return JSON.parse(storage?.getItem(SYNC_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function saveSyncConfig(cfg, storage = globalThis.localStorage) {
  storage?.setItem(SYNC_KEY, JSON.stringify(cfg));
}

export const isConfigured = (cfg) => !!(cfg?.owner && cfg?.repo && cfg?.token);

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

export function makeGitHubClient({ owner, repo, branch = 'main', token }, fetchImpl = globalThis.fetch) {
  const headers = (accept) => ({
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
  });
  const url = (path) => `${API}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`;

  async function check(res, what) {
    if (res.ok) return res;
    let detail = '';
    try {
      detail = (await res.json()).message ?? '';
    } catch {
      /* ignore */
    }
    const hint =
      res.status === 401
        ? 'The token was rejected. Create a new one and paste it in Settings.'
        : res.status === 403
          ? 'The token lacks access. It needs Contents: Read and write on this repository.'
          : res.status === 404
            ? 'Not found. Check the owner, repository, branch and path.'
            : '';
    throw new Error(`${what} failed (${res.status}). ${hint} ${detail}`.trim());
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
      const res = await fetchImpl(`${API}/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
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
