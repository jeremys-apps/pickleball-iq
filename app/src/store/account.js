// The device's side of the sign-in Worker: the key a password becomes, the
// sign-in and sign-up calls, and the session kept for each person on this
// device. No DOM, and nothing runs at import.
//
// The password never leaves the device. It is stretched into a key (PBKDF2 with
// SHA-256, 600,000 rounds, salted with the person's id), and the Worker keeps
// only a salted hash of that key. Changing any of these parameters changes every
// key, so it would need a new salt label (v2) and every account made again.
//
// A session names one person and lets this device reach the deck and that
// person's progress folder through the Worker. It does not expire; a 401 from
// the Worker means it no longer works.

import { makeGitHubClient } from './github-sync.js';

export const ACCOUNT_API = 'https://court-sense.jeremys-apps.workers.dev'; // index.html's connect-src lists it
export const SESSIONS_KEY = 'piq.sessions.v1';
export const LEGACY_SYNC_KEY = 'piq.sync.v1'; // the old per-device token settings
export const MIN_PASSWORD_LENGTH = 8;

const SALT_LABEL = 'court-sense/v1/';
const ITERATIONS = 600000;

export const ACCOUNT_MESSAGES = Object.freeze({
  tooShort: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  unreachable: 'Could not reach the sign-in service. Check your connection and try again.',
  insecure: 'Sign-in needs a secure connection. Open the app at its https address.',
});

const encoder = new TextEncoder();

function toBase64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// field: the one a person would correct (name, password or familyCode), when
// one field is at fault, so the screen can show the message there.
function accountError(message, status, field) {
  const e = new Error(message);
  if (status !== undefined) e.status = status;
  if (field) e.field = field;
  return e;
}

// The field each of the Worker's refusals is about, by status.
const SIGN_IN_FIELDS = Object.freeze({ 404: 'name', 401: 'password' });
const SIGN_UP_FIELDS = Object.freeze({ 403: 'familyCode', 409: 'name' });

// The key for a password: 32 bytes, base64url without padding (43 characters).
// Web Crypto exists only in secure contexts (https, or localhost).
export async function deriveKey(password, id, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw accountError(ACCOUNT_MESSAGES.insecure);
  const material = await subtle.importKey('raw', encoder.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(`${SALT_LABEL}${id}`), iterations: ITERATIONS },
    material,
    256,
  );
  return toBase64url(new Uint8Array(bits));
}

// Characters as a person counts them: an emoji is one, an accented letter one.
function checkPassword(password) {
  if (typeof password !== 'string' || [...password.normalize('NFC')].length < MIN_PASSWORD_LENGTH) {
    throw accountError(ACCOUNT_MESSAGES.tooShort, undefined, 'password');
  }
}

// POSTs to the Worker. Its own messages say what went wrong, and fields names
// the field each refusal is about; anything else, no answer included, is the
// sign-in service being out of reach. The error carries the status, 0 when
// nothing answered.
async function post(path, body, { api = ACCOUNT_API, fetchImpl = globalThis.fetch } = {}, fields = {}) {
  let res;
  try {
    res = await fetchImpl(`${api}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw accountError(ACCOUNT_MESSAGES.unreachable, 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not the Worker's answer */
  }
  if (!res.ok) {
    const fromWorker = typeof data?.message === 'string' && data.message;
    throw accountError(fromWorker ? data.message : ACCOUNT_MESSAGES.unreachable, res.status, fromWorker ? fields[res.status] : undefined);
  }
  const person = data?.person;
  if (typeof data?.session !== 'string' || typeof person?.id !== 'string') throw accountError(ACCOUNT_MESSAGES.unreachable, res.status);
  return { session: data.session, person: { id: person.id, name: typeof person.name === 'string' && person.name ? person.name : person.id } };
}

// -> { session, person: { id, name } }
export async function signIn({ id, password }, opts = {}) {
  checkPassword(password);
  return post('/sessions', { id, key: await deriveKey(password, id) }, opts, SIGN_IN_FIELDS);
}

// -> { session, person: { id, name } }
export async function createAccount({ id, name, password, familyCode }, opts = {}) {
  checkPassword(password);
  return post('/accounts', { id, name, key: await deriveKey(password, id), family_code: familyCode }, opts, SIGN_UP_FIELDS);
}

function readSessions(storage) {
  try {
    const all = JSON.parse(storage?.getItem(SESSIONS_KEY) ?? 'null');
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

export function sessionFor(id, storage = globalThis.localStorage) {
  const all = readSessions(storage);
  const session = Object.hasOwn(all, id) ? all[id] : null;
  return typeof session === 'string' && session ? session : null;
}

export function saveSession(id, session, storage = globalThis.localStorage) {
  const all = readSessions(storage);
  all[id] = session;
  storage?.setItem(SESSIONS_KEY, JSON.stringify(all));
}

export function clearSession(id, storage = globalThis.localStorage) {
  const all = readSessions(storage);
  if (!Object.hasOwn(all, id)) return;
  delete all[id];
  if (Object.keys(all).length) storage.setItem(SESSIONS_KEY, JSON.stringify(all));
  else storage.removeItem(SESSIONS_KEY);
}

// Deletes the old per-device token settings, once a sign-in replaces them.
export function forgetLegacySync(storage = globalThis.localStorage) {
  storage?.removeItem(LEGACY_SYNC_KEY);
}

// A contents-API client that reaches the deck and the person's own folder
// through the Worker, with the session where the token used to go.
export function makeAccountClient(session, { api = ACCOUNT_API, fetchImpl = globalThis.fetch } = {}) {
  return makeGitHubClient({ base: `${api}/contents`, token: session, hints: {} }, fetchImpl);
}
