// The Worker's side of the GitHub contents API: its own token, its own branch,
// and the User-Agent GitHub requires (a browser sends one itself; a Worker does
// not).

const API = 'https://api.github.com';
export const ACCOUNTS_DIR = 'accounts';

// GitHub refused the Worker's own token or failed. The Worker answers 502 for
// these, never 401, so a server problem never signs a device out.
export class UpstreamError extends Error {
  constructor(status) {
    super(`GitHub answered ${status}`);
    this.status = status;
  }
}

export const isUpstreamFailure = (status) => status === 401 || status === 403 || status >= 500;

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

function b64EncodeUtf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// A contents API request for a path in the data repo. Reads name the branch in
// the query; writes carry it in their body.
export function gh(env, path, { method = 'GET', accept = 'application/vnd.github+json', body } = {}, fetchImpl = fetch) {
  const ref = method === 'GET' ? `?ref=${encodeURIComponent(env.BRANCH || 'main')}` : '';
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'court-sense-worker',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetchImpl(`${API}/repos/${env.DATA_REPO}/contents/${encodePath(path)}${ref}`, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}

// The account record for an id, or null when there is none.
export async function readAccount(env, id, fetchImpl) {
  const res = await gh(env, `${ACCOUNTS_DIR}/${id}.json`, { accept: 'application/vnd.github.raw+json' }, fetchImpl);
  if (res.status === 404) return null;
  if (!res.ok) throw new UpstreamError(res.status);
  return JSON.parse(await res.text());
}

// Writes a new account record. A write without a sha cannot replace a file, so
// GitHub refuses it when the name is taken: 'exists'.
export async function createAccountRecord(env, record, fetchImpl) {
  const text = `${JSON.stringify(record, null, 2)}\n`;
  const body = JSON.stringify({ message: `account: ${record.id}`, content: b64EncodeUtf8(text), branch: env.BRANCH || 'main' });
  const res = await gh(env, `${ACCOUNTS_DIR}/${record.id}.json`, { method: 'PUT', body }, fetchImpl);
  if (res.status === 409 || res.status === 422) return 'exists';
  if (!res.ok) throw new UpstreamError(res.status);
  return 'created';
}
