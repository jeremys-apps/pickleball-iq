// Review progress for one person on this device, persisted in localStorage.
//
// People (see docs/PRD.md, section 8.12): every person has their own record,
// stored under piq.progress.v1.<person_id>, and a device holds one record per
// person who uses it. The bare key piq.progress.v1 is the record from before
// people existed; the first person named on the device adopts it (people.js).
//
// Sync model (see docs/PRD.md, "Sync"): every device owns one file per person,
// progress/<person_id>/<device_id>.json, and never writes anyone else's. On
// sync a device reads all files in the person's folder and merges them into
// its own state:
//   logs     union by id (append-only, so nothing is ever lost)
//   cards    if both sides reviewed a card, rebuild its state by replaying the
//            merged log; otherwise keep the entry that changed most recently
//   settings newest updated_at wins
// Merging is idempotent and order-independent, so repeated syncs converge. A
// record that names another person is never merged in.

export const STORAGE_KEY = 'piq.progress.v1';
export const DEVICE_KEY = 'piq.device.v1'; // one id per device, shared by every person's record on it
export const SCHEMA_VERSION = 1;

const nowIso = () => new Date().toISOString();

export function newDeviceId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().toLowerCase();
  return 'dev-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

// Where a person's record lives in storage. No person: the pre-people key.
export const progressKey = (personId) => (personId ? `${STORAGE_KEY}.${personId}` : STORAGE_KEY);

// This device's id, created on first use. Every person's record on the device
// carries it, so a person's folder in the data repo holds one file per device.
export function deviceId(storage = globalThis.localStorage) {
  let id = null;
  try {
    id = storage?.getItem(DEVICE_KEY) ?? null;
  } catch {
    /* storage blocked */
  }
  if (id) return id;
  id = newDeviceId();
  try {
    storage?.setItem(DEVICE_KEY, id);
  } catch {
    /* storage blocked: the id lives in this record only */
  }
  return id;
}

export function emptyProgress(deviceId = newDeviceId(), label = '', personId = null) {
  return {
    schema_version: SCHEMA_VERSION,
    ...(personId ? { person_id: personId } : {}),
    device_id: deviceId,
    device_label: label,
    updated_at: nowIso(),
    cards: {},
    logs: [],
    settings: { updated_at: '1970-01-01T00:00:00.000Z' },
  };
}

export function loadProgress(storage = globalThis.localStorage, personId = null) {
  try {
    const raw = storage?.getItem(progressKey(personId));
    if (raw) {
      const p = JSON.parse(raw);
      if (p?.schema_version === SCHEMA_VERSION) {
        if (personId) p.person_id = personId;
        return p;
      }
    }
  } catch (e) {
    console.warn('Progress could not be read; starting fresh.', e);
  }
  const p = emptyProgress(personId ? deviceId(storage) : newDeviceId(), '', personId);
  saveProgress(p, storage);
  return p;
}

export function saveProgress(p, storage = globalThis.localStorage) {
  p.updated_at = nowIso();
  storage?.setItem(progressKey(p.person_id), JSON.stringify(p));
  return p;
}

let logCounter = 0;
export function recordReview(p, cardId, fsrsState, entry = {}) {
  const reviewedAt = entry.reviewed_at ?? nowIso();
  p.cards[cardId] = { ...(p.cards[cardId] ?? {}), fsrs: fsrsState, updated_at: reviewedAt };
  p.logs.push({
    id: `${p.device_id}-${Date.parse(reviewedAt).toString(36)}-${(logCounter++).toString(36)}`,
    card_id: cardId,
    rating: entry.rating,
    reviewed_at: reviewedAt,
    correct: entry.correct ?? null,
    choice: entry.choice ?? null,
    response_ms: entry.response_ms ?? null,
    stage: entry.stage ?? 'A',
    view: entry.view ?? 'first_person',
    device_id: p.device_id,
    ...(entry.auto_rated ? { auto_rated: true } : {}),
    ...(entry.mirrored ? { mirrored: true } : {}),
    ...(Array.isArray(entry.shown) ? { shown: entry.shown } : {}),
  });
  return p;
}

export function setSuspended(p, cardId, suspended) {
  const e = p.cards[cardId];
  if (!e) return p;
  p.cards[cardId] = { ...e, suspended, updated_at: nowIso() };
  return p;
}

const changedAt = (e) => {
  const a = e?.fsrs?.last_review ?? '';
  const b = e?.updated_at ?? '';
  return a > b ? a : b;
};

// True when a record belongs to someone other than the given person. Records
// from before people existed name nobody and belong to whoever reads them.
export const isAnotherPerson = (p, personId) => !!(p?.person_id && personId && p.person_id !== personId);

// Merge remote into local. local.device_id and person_id are kept, and a
// record of another person is left out. replay(logs) -> fsrs state is supplied
// by the scheduler so this module stays free of FSRS details.
export function mergeProgress(local, remote, { replay } = {}) {
  if (!remote || remote.schema_version !== SCHEMA_VERSION) return local;
  if (isAnotherPerson(remote, local.person_id)) return local;
  const out = structuredCloneSafe(local);

  const byId = new Map(out.logs.map((l) => [l.id, l]));
  for (const l of remote.logs ?? []) if (!byId.has(l.id)) byId.set(l.id, l);
  out.logs = [...byId.values()].sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at) || a.id.localeCompare(b.id));

  const logsByCard = new Map();
  for (const l of out.logs) {
    if (!logsByCard.has(l.card_id)) logsByCard.set(l.card_id, []);
    logsByCard.get(l.card_id).push(l);
  }

  const ids = new Set([...Object.keys(local.cards ?? {}), ...Object.keys(remote.cards ?? {})]);
  for (const id of ids) {
    const a = local.cards?.[id];
    const b = remote.cards?.[id];
    if (!a || !b) {
      out.cards[id] = structuredCloneSafe(a ?? b);
      continue;
    }
    const newer = changedAt(b) > changedAt(a) ? b : a;
    const entry = structuredCloneSafe(newer);
    const logs = logsByCard.get(id) ?? [];
    const devices = new Set(logs.map((l) => l.device_id));
    if (replay && devices.size > 1) {
      const rebuilt = replay(logs);
      if (rebuilt) entry.fsrs = rebuilt;
    }
    out.cards[id] = entry;
  }

  const ls = local.settings ?? {};
  const rs = remote.settings ?? {};
  out.settings = structuredCloneSafe((rs.updated_at ?? '') > (ls.updated_at ?? '') ? rs : ls);
  out.updated_at = [local.updated_at, remote.updated_at].sort().pop();
  return out;
}

// Size of the stored copy in bytes, for the Settings readout. localStorage is
// capped near 5 MB on iOS Safari and shared by everything on the origin; when
// this passes about 2 MB, progress moves to IndexedDB (plan Track E3).
export function progressSizeBytes(p) {
  return new TextEncoder().encode(JSON.stringify(p)).length;
}

export function formatBytes(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

export function exportProgress(p) {
  return JSON.stringify(p, null, 2);
}

export function importProgress(text, personId = null) {
  const p = JSON.parse(text);
  if (p?.schema_version !== SCHEMA_VERSION || typeof p.cards !== 'object' || !Array.isArray(p.logs)) {
    throw new Error('This file is not a Court Sense progress export (schema_version 1).');
  }
  if (isAnotherPerson(p, personId)) {
    throw new Error(`This export belongs to ${p.person_id}, not to ${personId}. Switch to that person before importing it.`);
  }
  return p;
}

// Calendar day in local time (a UTC date would roll over mid-evening in Utah).
export function localDay(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// Number of cards whose first-ever review happened on the given local day.
export function newIntroducedOn(p, day = new Date()) {
  const d = localDay(day);
  const first = new Map();
  for (const l of p.logs) if (!first.has(l.card_id)) first.set(l.card_id, localDay(l.reviewed_at));
  let n = 0;
  for (const v of first.values()) if (v === d) n++;
  return n;
}

function structuredCloneSafe(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

// An answer given but not yet rated. Saved at answer time so closing the app
// before rating loses nothing; finalizePending() records it on the next start.
// Kept per person (pending.person_id), so an answer waits for the person who
// gave it even if someone else uses the device in between.
export const PENDING_KEY = 'piq.pending.v1';

export const pendingKey = (personId) => (personId ? `${PENDING_KEY}.${personId}` : PENDING_KEY);

export function savePending(pending, storage = globalThis.localStorage) {
  try {
    storage?.setItem(pendingKey(pending.person_id), JSON.stringify(pending));
  } catch {
    /* storage full or unavailable: the card simply comes back */
  }
}

export function clearPending(storage = globalThis.localStorage, personId = null) {
  try {
    storage?.removeItem(pendingKey(personId));
  } catch {
    /* ignore */
  }
}

export function takePending(storage = globalThis.localStorage, personId = null) {
  let p = null;
  try {
    p = JSON.parse(storage?.getItem(pendingKey(personId)) ?? 'null');
  } catch {
    p = null;
  }
  clearPending(storage, personId);
  return p;
}
