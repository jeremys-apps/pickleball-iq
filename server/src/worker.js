// Court Sense sign-in Worker. It holds the only GitHub token. People create an
// account with the family code and sign in with a key their device derives from
// the password; a session then reaches the deck and that person's own progress
// folder, nothing else. Those requests pass to GitHub's contents API unchanged,
// so the app syncs exactly as it did against GitHub itself.
//
// Secrets (npx wrangler secret put): GITHUB_TOKEN, SESSION_SECRET, FAMILY_CODE.
// Vars (wrangler.toml): DATA_REPO, BRANCH, ALLOWED_ORIGINS. Optional binding:
// SIGN_IN_LIMIT, a rate limit on sign-in and sign-up per address.
//
// Bodies of the deck and progress files are never parsed (GETs stream, a PUT is
// forwarded as bytes): progress files grow with the review log, and the free
// plan allows 10 ms of CPU per request.

import { hashKey, keyMatches, signSession, readSession, sameFamilyCode, KEY_PATTERN } from './auth.js';
import { gh, readAccount, createAccountRecord, isUpstreamFailure, UpstreamError } from './github.js';

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DEVICE_FILE = /^[a-z0-9-]{6,64}\.json$/;
const DECK_PATH = 'deck/deck.json';
const PROGRESS_DIR = 'progress';
const MAX_NAME_LENGTH = 60;
const RAW = 'application/vnd.github.raw+json';
const LISTING = 'application/vnd.github+json';

export const MESSAGES = Object.freeze({
  signedOut: 'You are signed out. Sign in again in Settings.',
  serverDown: 'Sync is not working on the server. Your progress is safe on this device.',
  badRequest: 'That request was not valid.',
  wrongCode: 'That family code is not right.',
  nameTaken: 'There is already an account with that name. Sign in instead.',
  noAccount: 'No account with that name yet. Check the spelling, or create an account.',
  wrongPassword: 'That password is not right.',
  tooMany: 'Too many tries. Wait a minute and try again.',
  notAllowed: 'Not allowed.',
  notFound: 'Not found.',
});

const isId = (v) => typeof v === 'string' && ID_PATTERN.test(v);
const isKey = (v) => typeof v === 'string' && KEY_PATTERN.test(v);

// What a session may do with a path: read the deck, list or read its own
// folder, and write its own device files. Anything else is null.
export function routeFor(method, path, id) {
  if (!isId(id) || typeof path !== 'string') return null;
  if (method === 'GET' && path === DECK_PATH) return 'deck';
  const folder = `${PROGRESS_DIR}/${id}`;
  if (method === 'GET' && path === folder) return 'list';
  if (path.startsWith(`${folder}/`) && DEVICE_FILE.test(path.slice(folder.length + 1))) {
    if (method === 'GET') return 'file';
    if (method === 'PUT') return 'put';
  }
  return null;
}

export default { fetch: (request, env) => handle(request, env) };

export async function handle(request, env, { fetchImpl = fetch } = {}) {
  const origin = allowedOrigin(request.headers.get('Origin'), env);
  // Every answer carries these, errors included: without them a browser hides
  // the answer, and the app could not tell a wrong password from no connection.
  const cors = { Vary: 'Origin', ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}) };
  const reply = (status, body, extra = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });

  if (request.method === 'OPTIONS') return preflight(cors, origin);
  try {
    if (!env.GITHUB_TOKEN || !env.SESSION_SECRET || !env.DATA_REPO) return reply(502, { message: MESSAGES.serverDown });
    const { pathname } = new URL(request.url);
    if (pathname === '/accounts' || pathname === '/sessions') {
      if (request.method !== 'POST') return reply(405, { message: MESSAGES.notAllowed });
      if (env.SIGN_IN_LIMIT) {
        const { success } = await env.SIGN_IN_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
        if (!success) return reply(429, { message: MESSAGES.tooMany });
      }
      return pathname === '/accounts' ? await signUp(request, env, fetchImpl, reply) : await signIn(request, env, fetchImpl, reply);
    }
    if (pathname.startsWith('/contents/')) return await contents(request, env, fetchImpl, pathname, reply, cors);
    return reply(404, { message: MESSAGES.notFound });
  } catch (e) {
    // GitHub refused the Worker's token, failed or could not be reached.
    if (!(e instanceof UpstreamError)) console.error('court-sense:', e?.message ?? e);
    return reply(502, { message: MESSAGES.serverDown });
  }
}

async function signUp(request, env, fetchImpl, reply) {
  const body = await readJson(request);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const nameOk = name.length > 0 && name.length <= MAX_NAME_LENGTH && !/[\u0000-\u001f\u007f]/.test(name);
  if (!isId(body?.id) || !nameOk || !isKey(body?.key)) return reply(400, { message: MESSAGES.badRequest });
  if (!(await sameFamilyCode(body.family_code, env.FAMILY_CODE))) return reply(403, { message: MESSAGES.wrongCode });
  const { salt, hash } = await hashKey(body.key);
  const record = { schema_version: 1, id: body.id, name, created_at: new Date().toISOString(), salt, hash };
  if ((await createAccountRecord(env, record, fetchImpl)) === 'exists') return reply(409, { message: MESSAGES.nameTaken });
  return reply(201, { session: await signSession(env.SESSION_SECRET, body.id), person: { id: body.id, name } });
}

async function signIn(request, env, fetchImpl, reply) {
  const body = await readJson(request);
  if (!isId(body?.id) || !isKey(body?.key)) return reply(400, { message: MESSAGES.badRequest });
  const account = await readAccount(env, body.id, fetchImpl);
  if (!account) return reply(404, { message: MESSAGES.noAccount });
  if (!(await keyMatches(account, body.key))) return reply(401, { message: MESSAGES.wrongPassword });
  const name = typeof account.name === 'string' && account.name ? account.name : body.id;
  return reply(200, { session: await signSession(env.SESSION_SECRET, body.id), person: { id: body.id, name } });
}

async function contents(request, env, fetchImpl, pathname, reply, cors) {
  if (request.method !== 'GET' && request.method !== 'PUT') return reply(405, { message: MESSAGES.notAllowed });
  const session = await readSession(env.SESSION_SECRET, bearer(request));
  if (!session) return reply(401, { message: MESSAGES.signedOut });
  const path = decodePath(pathname.slice('/contents/'.length));
  const route = routeFor(request.method, path, session.id);
  if (!route) return reply(403, { message: MESSAGES.notAllowed });

  // GitHub's own answers allow reuse for 60 seconds; a listing reused right
  // after a write would carry an old sha.
  const noStore = { 'Cache-Control': 'no-store' };
  const up =
    route === 'put'
      ? await gh(env, path, { method: 'PUT', body: await request.arrayBuffer() }, fetchImpl)
      : await gh(env, path, { accept: route === 'list' ? LISTING : RAW }, fetchImpl);
  if (isUpstreamFailure(up.status)) throw new UpstreamError(up.status);
  if (!up.ok) return reply(up.status, { message: up.status === 404 ? MESSAGES.notFound : await messageOf(up) }, noStore);
  if (route === 'put') {
    const out = await up.json();
    return reply(up.status, { content: { path: out?.content?.path ?? path, sha: out?.content?.sha } }, noStore);
  }
  if (route === 'list') {
    const items = await up.json();
    const listing = Array.isArray(items) ? items.map(({ name, path: p, sha, type }) => ({ name, path: p, sha, type })) : [];
    return reply(200, listing, noStore);
  }
  return new Response(up.body, {
    status: 200,
    headers: { ...cors, 'Content-Type': up.headers.get('Content-Type') ?? 'application/json', ...noStore },
  });
}

function preflight(cors, origin) {
  if (!origin) return new Response(null, { status: 204, headers: cors });
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type, X-GitHub-Api-Version',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function allowedOrigin(origin, env) {
  if (!origin) return null;
  const allowed = String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

const bearer = (request) => /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1] ?? null;

// The path after /contents/, decoded segment by segment; null when malformed.
function decodePath(rest) {
  try {
    return rest.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

async function readJson(request) {
  try {
    const v = await request.json();
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function messageOf(res) {
  try {
    return (await res.json()).message ?? '';
  } catch {
    return '';
  }
}
