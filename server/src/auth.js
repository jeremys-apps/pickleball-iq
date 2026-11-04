// Passwords, sessions and the family code, with Web Crypto only, so the same
// code runs in a Cloudflare Worker and in Node's tests.
//
// The device stretches a password into a 32-byte key (PBKDF2, 600,000 rounds)
// before sending it, because a Worker on the free plan gets 10 ms of CPU per
// request; the Worker keeps only a salted SHA-256 of that key. A session is a
// signed token that names the person. It does not expire and stays valid until
// SESSION_SECRET changes, so deleting or re-creating an account record (a
// password reset) never signs a device out.

const encoder = new TextEncoder();

export const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url without padding
const SESSION_PATTERN = /^v1\.([a-z0-9][a-z0-9-]{0,39})\.([A-Za-z0-9_-]{43})$/;

export function toBase64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const randomBase64url = (n) => toBase64url(crypto.getRandomValues(new Uint8Array(n)));

const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

// Same length and same bytes, without stopping at the first difference.
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const sameText = (a, b) => sameBytes(encoder.encode(a), encoder.encode(b));

// { salt, hash }: SHA-256 of the salt bytes followed by the key bytes, both base64url.
export async function hashKey(key, salt = randomBase64url(16)) {
  const s = fromBase64url(salt);
  const k = fromBase64url(key);
  const joined = new Uint8Array(s.length + k.length);
  joined.set(s);
  joined.set(k, s.length);
  return { salt, hash: toBase64url(await sha256(joined)) };
}

export async function keyMatches(account, key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return false;
  if (typeof account?.salt !== 'string' || typeof account?.hash !== 'string') return false;
  const { hash } = await hashKey(key, account.salt);
  return sameText(hash, account.hash);
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}

export async function signSession(secret, id) {
  const body = `v1.${id}`;
  return `${body}.${toBase64url(await hmac(secret, body))}`;
}

// { id } for a session this secret signed, else null. The signature is compared
// as canonical text, so a variant that decodes to the same bytes is refused too.
export async function readSession(secret, token) {
  const m = typeof token === 'string' ? SESSION_PATTERN.exec(token) : null;
  if (!m || !secret) return null;
  return sameText(toBase64url(await hmac(secret, `v1.${m[1]}`)), m[2]) ? { id: m[1] } : null;
}

// Phones capitalize and space freely, so case and runs of spaces do not matter.
const normalizeCode = (code) => (typeof code === 'string' ? code.trim().toLowerCase().replace(/\s+/g, ' ') : '');

export async function sameFamilyCode(given, expected) {
  const want = normalizeCode(expected);
  if (!want) return false; // no code set: nobody can create an account
  return sameBytes(await sha256(encoder.encode(normalizeCode(given))), await sha256(encoder.encode(want)));
}
