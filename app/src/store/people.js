// The people who use this device, and which of them is using it now.
//
// A person is a name and an id. The id is the name as a slug ("Mary Ann" ->
// mary-ann), and it is the person's folder in the data repo, so the same name
// typed on two devices lands in one folder and the two records merge. Ids are
// permanent, like card ids: progress files refer to them. The display name is
// just what was typed.
//
// Stored in localStorage under piq.people.v1:
//   { current: 'jeremy', people: [{ id: 'jeremy', name: 'Jeremy', created_at: iso }] }

import { STORAGE_KEY, PENDING_KEY, DEVICE_KEY, SCHEMA_VERSION, progressKey, pendingKey } from './progress.js';

export const PEOPLE_KEY = 'piq.people.v1';
export const MAX_ID_LENGTH = 40;

const nowIso = () => new Date().toISOString();

// "Mary Ann" -> "mary-ann", "José" -> "jose". Empty when the name has no plain letter or digit.
export function slugify(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/, '');
}

const emptyRegistry = () => ({ current: null, people: [] });

export function loadPeople(storage = globalThis.localStorage) {
  let reg = null;
  try {
    reg = JSON.parse(storage?.getItem(PEOPLE_KEY) ?? 'null');
  } catch {
    reg = null;
  }
  if (!reg || !Array.isArray(reg.people)) return emptyRegistry();
  const people = reg.people.filter((p) => p && typeof p.id === 'string' && p.id && typeof p.name === 'string');
  const current = people.some((p) => p.id === reg.current) ? reg.current : (people[0]?.id ?? null);
  return { current, people };
}

export function savePeople(reg, storage = globalThis.localStorage) {
  try {
    storage?.setItem(PEOPLE_KEY, JSON.stringify(reg));
  } catch (e) {
    console.warn('The list of people could not be saved.', e);
  }
  return reg;
}

export const currentPerson = (reg) => reg.people.find((p) => p.id === reg.current) ?? null;
export const personById = (reg, id) => reg.people.find((p) => p.id === id) ?? null;

// Adds a person by name, or finds the one whose id the name gives. Returns a
// new registry; the caller decides whether to switch to them.
export function addPerson(reg, name) {
  const trimmed = String(name ?? '').trim();
  const id = slugify(trimmed);
  if (!id) throw new Error('Type a name with at least one plain letter or digit.');
  const existing = personById(reg, id);
  if (existing) return { reg, person: existing, created: false };
  const person = { id, name: trimmed, created_at: nowIso() };
  return { reg: { ...reg, people: [...reg.people, person] }, person, created: true };
}

export function setCurrent(reg, id) {
  if (!personById(reg, id)) throw new Error(`No person with id ${id} on this device.`);
  return { ...reg, current: id };
}

// Takes a person off this device along with their record here. Copies synced
// to the data repo are untouched. The person using the device now stays.
export function removePerson(reg, id, storage = globalThis.localStorage) {
  if (id === reg.current) throw new Error('Switch to someone else before removing the person using this device.');
  if (!personById(reg, id)) return reg;
  try {
    storage?.removeItem(progressKey(id));
    storage?.removeItem(pendingKey(id));
  } catch {
    /* storage blocked */
  }
  return { ...reg, people: reg.people.filter((p) => p.id !== id) };
}

// A record from before people existed, waiting for a name.
export function hasLegacyProgress(storage = globalThis.localStorage) {
  try {
    return !!storage?.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

// The first person named on an upgraded device takes over the record and any
// unrated answer kept under the pre-people keys, and the device keeps its id,
// so its file in the data repo keeps its name. Returns true when a record moved.
export function adoptLegacyProgress(personId, storage = globalThis.localStorage) {
  let moved = false;
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw && !storage.getItem(progressKey(personId))) {
      let p = null;
      try {
        p = JSON.parse(raw);
      } catch {
        p = null;
      }
      if (p?.schema_version === SCHEMA_VERSION) {
        p.person_id = personId;
        storage.setItem(progressKey(personId), JSON.stringify(p));
        if (p.device_id && !storage.getItem(DEVICE_KEY)) storage.setItem(DEVICE_KEY, p.device_id);
        moved = true;
      }
      storage.removeItem(STORAGE_KEY);
    }
    const pending = storage?.getItem(PENDING_KEY);
    if (pending && !storage.getItem(pendingKey(personId))) {
      storage.setItem(pendingKey(personId), pending);
      storage.removeItem(PENDING_KEY);
    }
  } catch (e) {
    console.warn('The earlier record could not be moved.', e);
  }
  return moved;
}
