// Who is using the app: name the first person on a device, switch between the
// people on it. The registry and the records live in store/; this module moves
// the app between them.

import { savePeople, addPerson, setCurrent, personById, adoptLegacyProgress } from './store/people.js';
import { loadProgress } from './store/progress.js';

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
