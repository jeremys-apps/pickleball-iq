// Who is using the app: sign people in, name the first person on a device,
// switch between the people on it. The registry and the records live in store/;
// this module moves the app between them.

import { savePeople, addPerson, setCurrent, personById, adoptLegacyProgress, slugify } from './store/people.js';
import { loadProgress } from './store/progress.js';
import { signIn, createAccount, saveSession, forgetLegacySync } from './store/account.js';
import { syncNow, syncedAt } from './sync.js';

// Make a person current and load their record into the app.
export function activatePerson(app, id, storage = globalThis.localStorage) {
  const person = personById(app.people, id);
  if (!person) throw new Error(`No person with id ${id} on this device.`);
  app.people = savePeople(setCurrent(app.people, id), storage);
  app.person = person;
  app.progress = loadProgress(storage, id);
  return person;
}

// Add a person by name, or find the one that name already means, and switch to
// them. On an upgraded device the first person named takes over the record
// kept before people existed.
export function startPerson(app, name, storage = globalThis.localStorage) {
  const { reg, person } = addPerson(app.people, name);
  app.people = savePeople(reg, storage);
  adoptLegacyProgress(person.id, storage);
  return activatePerson(app, person.id, storage);
}

// The account id a typed name gives: its slug, the person's id everywhere. A
// name that gives none is a mistake in the name field.
function accountId(name) {
  const id = slugify(String(name ?? '').trim());
  if (!id) throw Object.assign(new Error('Type a name with at least one plain letter or digit.'), { field: 'name' });
  return id;
}

const accountOpts = ({ api, fetchImpl }) => ({ ...(api ? { api } : {}), ...(fetchImpl ? { fetchImpl } : {}) });

// After the Worker accepts: keep the session, delete the old token settings,
// make the person current (adopting a pre-people record on an upgraded device),
// then sync, which merges their other devices' reviews and loads the deck. A
// failed sync keeps the sign-in and says why in app.sync.
async function signedIn(app, { session, person }, { storage = globalThis.localStorage, api, fetchImpl } = {}) {
  saveSession(person.id, session, storage);
  forgetLegacySync(storage);
  startPerson(app, slugify(person.name) === person.id ? person.name : person.id, storage);
  try {
    await syncNow(app, { storage, api, ...(fetchImpl ? { fetchImpl } : {}) });
    app.sync = { state: 'ok', message: syncedAt() };
  } catch (e) {
    app.sync = { state: 'error', message: `Sync failed. ${e.message}` };
  }
  return app.person;
}

// -> the person, now current on this device
export async function signInPerson(app, { name, password }, opts = {}) {
  const id = accountId(name);
  return signedIn(app, await signIn({ id, password }, accountOpts(opts)), opts);
}

// -> the person, now current on this device
export async function createPersonAccount(app, { name, password, familyCode }, opts = {}) {
  const id = accountId(name);
  return signedIn(app, await createAccount({ id, name: String(name).trim(), password, familyCode }, accountOpts(opts)), opts);
}
