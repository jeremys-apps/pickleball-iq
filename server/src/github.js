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

// GitHub's JSON answers carry a file's content in base64 broken into lines.
function b64DecodeUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
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

// An account file holds a record with a salt and a hash. Anything else (blank,
// cut short, or edited by hand) holds no account, as if the file were deleted:
// emptying it on GitHub's website resets the password just as deleting it does.
function parseAccount(text) {
  try {
    const a = JSON.parse(text);
    return a && typeof a === 'object' && typeof a.salt === 'string' && typeof a.hash === 'string' ? a : null;
  } catch {
    return null;
  }
}

// The account record for an id, or null when there is none.
export async function readAccount(env, id, fetchImpl) {
  const res = await gh(env, `${ACCOUNTS_DIR}/${id}.json`, { accept: 'application/vnd.github.raw+json' }, fetchImpl);
  if (res.status === 404) return null;
  if (!res.ok) throw new UpstreamError(res.status);
  return parseAccount(await res.text());
}

// Writes a new account record. A write without a sha cannot replace a file, so
// GitHub refuses it when the name has one. A real record there means the name
// is taken: 'exists'. A file that holds no account is replaced by its own sha.
// The decision and the sha come from one answer, so they describe the same
// file, and a record written in the meantime is never overwritten (its new sha
// makes GitHub refuse the write). An answer that cannot be read replaces
// nothing: the Worker answers 502.
export async function createAccountRecord(env, record, fetchImpl) {
  const path = `${ACCOUNTS_DIR}/${record.id}.json`;
  const text = `${JSON.stringify(record, null, 2)}\n`;
  const write = (sha) =>
    gh(env, path, { method: 'PUT', body: JSON.stringify({ message: `account: ${record.id}`, content: b64EncodeUtf8(text), branch: env.BRANCH || 'main', ...(sha ? { sha } : {}) }) }, fetchImpl);
  let res = await write();
  if (res.status === 409 || res.status === 422) {
    const file = await gh(env, path, {}, fetchImpl);
    if (file.status === 404) {
      res = await write(); // gone in the meantime: create it
    } else {
      if (!file.ok) throw new UpstreamError(file.status);
      const { sha, content } = await file.json();
      if (typeof sha !== 'string' || typeof content !== 'string') throw new Error('GitHub gave no sha or content for an account file');
      if (parseAccount(b64DecodeUtf8(content))) return 'exists';
      res = await write(sha);
    }
    if (res.status === 409 || res.status === 422) return 'exists';
  }
  if (!res.ok) throw new UpstreamError(res.status);
  return 'created';
}
