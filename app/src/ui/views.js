// Home, card browser, card preview, settings, and the sign-in screen, which is
// the first screen on a device where nobody has signed in.

import { h } from './dom.js';
import { topbar, count } from './chrome.js';
import { planBatch, finalizePending } from './session.js';
import { mountCard } from './card-view.js';
import { stageFor, STAGES, makeScheduler, applyAidPreference, MATURE_AID_CHOICES } from '../srs/scheduler.js';
import { saveSettings } from '../store/settings.js';
import { exportProgress, importProgress, mergeProgress, saveProgress, emptyProgress, progressSizeBytes, formatBytes } from '../store/progress.js';
import { removePerson, savePeople, personById } from '../store/people.js';
import { activatePerson, signInPerson, createPersonAccount } from '../people.js';
import { syncNow, canSync } from '../sync.js';
import { canMirror } from '../court/mirror.js';
import { makeNamer } from '../names.js';
import { timedTrend, topicStats, drillPlan } from '../stats.js';

const TYPE_LABEL = {
  scenario_mc: 'Court decision',
  timed_decision: 'Timed read',
  text_mc: 'Quick choice',
  why: 'Why',
  form_cue: 'Form cue',
  drill_recall: 'Drill',
};

// "Time to choose on timed cards": multiplies only the clock after the freeze.
export const CHOOSE_TIME_CHOICES = Object.freeze([
  [1, 'As designed'],
  [1.25, '1.25 times'],
  [1.5, '1.5 times'],
  [2, 'Twice as long'],
]);

// Switch the app to another person on this device: their record, any answer
// they left unrated, and a sync of their folder.
export function switchPerson(app, id) {
  activatePerson(app, id);
  finalizePending(app);
  app.autoSync?.();
  return app.person;
}

// Whose record Home shows, with a way to change it: "Playing as Jeremy. Switch
// to Anna or Ben." With nobody else on the device, a link to add someone.
function whoLine(root, app) {
  if (!app.person) return null;
  const others = (app.people?.people ?? []).filter((p) => p.id !== app.person.id);
  const links = others.flatMap((p, i) => [
    i === 0 ? '' : i === others.length - 1 ? ' or ' : ', ',
    h(
      'a',
      {
        href: '#/',
        onclick: (e) => {
          e.preventDefault();
          switchPerson(app, p.id);
          renderHome(root, app);
        },
      },
      p.name,
    ),
  ]);
  return h('p', { class: 'note who' }, `Playing as ${app.person.name}. `, ...(others.length ? ['Switch to ', ...links, '.'] : [h('a', { href: '#/settings' }, 'Add a person'), '.']));
}

export function renderHome(root, app) {
  const plan = planBatch(app.index, app.progress, app.settings);
  const parts = [
    h('h1', {}, 'Today'),
    whoLine(root, app),
    h('div', { class: 'counts' }, count(plan.dueCount, 'due now'), count(plan.newCount, 'new cards'), count(app.index.deck.cards.length, 'in the deck')),
  ];
  if (plan.items.length && !plan.practice) {
    parts.push(
      h('div', {}, h('a', { class: 'btn primary', href: '#/session' }, 'Start')),
      h('p', { class: 'note' }, `Cards come in batches of ${app.settings.batchSize}. Keep going for as many batches as you like.`),
    );
  } else if (plan.practice) {
    parts.push(
      h('p', {}, nextDueText(app)),
      h('div', {}, h('a', { class: 'btn', href: '#/session' }, 'Practice ahead')),
      h('p', { class: 'note' }, 'Practice ahead brings back the cards due soonest. They count as reviews.'),
    );
  } else {
    parts.push(h('p', {}, 'The deck is empty.'));
  }
  const cue = app.progress.settings?.last_cue;
  if (cue?.text) parts.push(h('div', { class: 'takeaway' }, h('p', { class: 'note' }, 'Take this to the court'), h('p', { class: 'focus-cue' }, cue.text)));
  if (app.deckSource === 'sample') {
    parts.push(h('p', { class: 'banner' }, 'This is the sample deck: a few cards written to exercise the app. Sign in to load the real deck.'));
  }
  if (app.deckError) {
    parts.push(h('p', { class: 'banner warn' }, `Your deck could not be loaded, so ${app.deckSource === 'cache' ? 'the copy saved on this device' : 'the sample deck'} is in use. ${app.deckError}`));
  }
  if (!canSync(app)) parts.push(h('p', { class: 'banner' }, 'Not signed in, so nothing syncs. ', h('a', { href: '#/settings' }, 'Open Settings to sign in'), '.'));
  if (app.sync?.message) parts.push(h('p', { class: 'note' }, app.sync.message));
  parts.push(
    h('p', { class: 'note' }, h('a', { href: '#/cards' }, `Browse all ${app.index.deck.cards.length} cards`), ' or see your ', h('a', { href: '#/progress' }, 'progress and drills'), '.'),
  );
  root.replaceChildren(topbar(), h('main', { class: 'page' }, h('section', { class: 'today' }, ...parts)));
}

const pct = (v) => `${Math.round(v * 100)}%`;
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

// Progress: are timed reads getting faster, which topics are weak, and which
// drill to practice. Everything is derived from the review log (stats.js).
export function renderProgress(root, app) {
  const { index, progress, scheduler } = app;
  const rows = topicStats(index, progress, { scheduler });
  const timedIds = new Set(index.deck.cards.filter((c) => c.type === 'timed_decision').map((c) => c.id));
  const overall = timedTrend(progress.logs.filter((l) => timedIds.has(l.card_id)));
  const headline = overall
    ? `Timed reads: ${secs(overall.earlyMedianMs)} at first, ${secs(overall.lateMedianMs)} lately, over ${overall.n} clocked reviews${overall.timeouts ? `, ${overall.timeouts} timed out` : ''}.`
    : 'Timed reads: not enough clocked reviews yet. Reviews of timed cards past the new stage count; new cards have no clock.';
  const cell = (text, num = false) => h('td', { class: num ? 'num' : null }, text);
  const table = h(
    'table',
    { class: 'stats' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Topic'), h('th', { class: 'num' }, 'Seen'), h('th', { class: 'num' }, 'Right'), h('th', { class: 'num' }, 'Retention'), h('th', { class: 'num' }, 'Lapses'), h('th', {}, 'Timed reads'))),
    h(
      'tbody',
      {},
      rows.map((r) =>
        h(
          'tr',
          {},
          cell(r.topic.replaceAll('_', ' ')),
          cell(`${r.seen}/${r.cards}`, true),
          cell(r.accuracy == null ? '-' : pct(r.accuracy), true),
          cell(r.retrievability == null ? '-' : pct(r.retrievability), true),
          cell(String(r.lapses), true),
          cell(r.timed ? `${secs(r.timed.earlyMedianMs)} to ${secs(r.timed.lateMedianMs)}` : '-'),
        ),
      ),
    ),
  );
  const drills = drillPlan(index, progress, { scheduler });
  const drillBlocks = drills.length
    ? drills.map((d) =>
        h(
          'section',
          { class: 'drill' },
          h('p', { class: 'focus-cue' }, d.drill.statement),
          h('p', {}, d.drill.action),
          h(
            'ul',
            { class: 'note' },
            d.trains.length
              ? d.trains.map((t) =>
                  h('li', {}, `${t.principle.statement} `, t.retrievability == null ? '(not seen yet)' : `(retention ${pct(t.retrievability)}${t.lapses ? `, ${t.lapses} ${t.lapses === 1 ? 'lapse' : 'lapses'}` : ''})`),
                )
              : h('li', {}, 'Not linked to a principle yet.'),
          ),
          h('p', { class: 'note' }, d.cards.map((c, i) => [i ? ', ' : 'Cards: ', h('a', { href: `#/preview/${encodeURIComponent(c.id)}` }, promptAsShown(app, c))])),
        ),
      )
    : [h('p', { class: 'note' }, 'No drills in the deck yet.')];
  root.replaceChildren(
    topbar(),
    h(
      'main',
      { class: 'page progress' },
      h('h1', {}, 'Progress'),
      h('p', {}, headline),
      h('p', { class: 'note' }, "Weakest topics first. Retention is the scheduler's estimate of what you would recall right now."),
      table,
      h('h2', {}, 'Drills'),
      h('p', { class: 'note' }, 'What to practice, starting with the drill whose lesson you are most likely to forget.'),
      ...drillBlocks,
    ),
  );
}

function nextDueText(app) {
  let min = null;
  for (const e of Object.values(app.progress.cards)) {
    if (e.suspended || !e.fsrs?.due) continue;
    const d = new Date(e.fsrs.due);
    if (!min || d < min) min = d;
  }
  if (!min) return 'All caught up.';
  return `All caught up. The next review is due ${min.toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' })}.`;
}

// A card's question as the card shows it, people's full names included.
const promptAsShown = (app, c) => makeNamer(app.index.people, c).name(c.prompt);

export function renderCards(root, app) {
  const items = app.index.deck.cards.map((c) => {
    const e = app.progress.cards[c.id];
    const status = !e ? 'New' : e.suspended ? 'Suspended' : `Due ${new Date(e.fsrs.due).toLocaleDateString()}`;
    return h('li', {}, h('a', { href: `#/preview/${encodeURIComponent(c.id)}` }, promptAsShown(app, c)), h('span', { class: 'note' }, ` ${TYPE_LABEL[c.type]}. ${status}.`));
  });
  root.replaceChildren(
    topbar(),
    h('main', { class: 'page' }, h('h1', {}, 'Cards'), h('p', { class: 'note' }, 'Open any card to preview it. Previews are not recorded.'), h('ul', { class: 'card-list' }, items)),
  );
}

export function renderPreview(root, app, cardId, stageId, mirror = false) {
  const card = app.index.cards.get(cardId);
  if (!card) {
    location.hash = '#/cards';
    return null;
  }
  const stage = applyAidPreference(STAGES[stageId] ?? stageFor(app.progress.cards[cardId]?.fsrs), app.settings.matureAids);
  const levels = { A: 'new', B: 'in review', C: 'mature' };
  const links = Object.entries(levels).flatMap(([id, label], i) => [
    i ? ', ' : '',
    id === stage.id ? h('b', {}, label) : h('a', { href: `#/preview/${encodeURIComponent(cardId)}/${id}${mirror ? '/m' : ''}` }, label),
  ]);
  const base = `#/preview/${encodeURIComponent(cardId)}/${stage.id}`;
  const mirrorLink = canMirror(card) ? [' ', mirror ? h('a', { href: base }, 'Show as authored') : h('a', { href: `${base}/m` }, 'Show mirrored')] : [];
  const host = h('div');
  root.replaceChildren(topbar(), h('main', { class: 'page' }, h('p', { class: 'note' }, 'Preview as a card that is ', ...links, '. Nothing here is recorded.', ...mirrorLink), host));
  return mountCard(host, {
    card,
    index: app.index,
    stage,
    settings: app.settings,
    scheduler: app.scheduler,
    state: app.progress.cards[cardId]?.fsrs,
    mirrored: mirror && canMirror(card),
    showing: mirror ? 1 : 0, // as authored = first showing; mirrored = the next one
    onViewChange: (view) => {
      app.settings = { ...app.settings, courtView: view };
      saveSettings(app.settings);
    },
    onDone: () => {
      location.hash = '#/cards';
    },
  });
}

const clampInt = (v, lo, hi, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const str = (v) => String(v ?? '').trim();

export function renderSettings(root, app) {
  const s = app.settings;
  const signedIn = canSync(app);
  const status = h('p', { class: 'note', role: 'status' });
  const field = (name, label, value, { type = 'text', hint, ...rest } = {}) =>
    h(
      'label',
      {},
      label,
      h('input', { type, name, value: value ?? '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...rest }),
      hint ? h('small', {}, hint) : null,
    );

  const form = h(
    'form',
    { class: 'form', onsubmit: (e) => { e.preventDefault(); save(); status.textContent = 'Settings saved.'; } },
    h(
      'fieldset',
      {},
      h('legend', {}, 'Sessions'),
      field('batchSize', 'Cards per batch', s.batchSize, { type: 'number', min: 3, max: 50, inputmode: 'numeric', hint: 'Each batch ends with a summary. Keep going as long as you like.' }),
      field('newPerDay', 'Limit new cards per day', s.newPerDay, { type: 'number', min: 0, max: 999, inputmode: 'numeric', placeholder: 'No limit', hint: 'Leave blank for no limit. A limit only slows new material; due reviews always come first.' }),
      field('maxIntervalDays', 'Longest gap between reviews, in days', s.maxIntervalDays, { type: 'number', min: 30, max: 3650, inputmode: 'numeric', hint: 'Cards you keep getting right come back at growing gaps, never longer than this.' }),
      h(
        'label',
        {},
        'Camera',
        h(
          'select',
          { name: 'cameraMode' },
          h('option', { value: 'over_shoulder', selected: s.cameraMode !== 'first_person' }, 'Over your shoulder'),
          h('option', { value: 'first_person', selected: s.cameraMode === 'first_person' }, 'Through your eyes'),
        ),
        h('small', {}, 'A ball coming straight at your eyes flattens into a line. Over the shoulder keeps its arc readable.'),
      ),
      h(
        'label',
        {},
        'On mature cards',
        h(
          'select',
          { name: 'matureAids' },
          h('option', { value: 'fade', selected: (s.matureAids ?? 'fade') === 'fade' }, 'Fade the aids (closest to a real match)'),
          h('option', { value: 'map', selected: s.matureAids === 'map' }, 'Keep the mini-map'),
          h('option', { value: 'all', selected: s.matureAids === 'all' }, 'Keep every aid'),
        ),
        h('small', {}, 'The court picture always stays. After you answer, every aid comes back to show what happened.'),
      ),
      h(
        'label',
        {},
        'Time to choose on timed cards',
        h(
          'select',
          { name: 'chooseTimeScale' },
          ...CHOOSE_TIME_CHOICES.map(([value, label]) => h('option', { value, selected: (s.chooseTimeScale ?? 1) === value }, label)),
        ),
        h('small', {}, 'Stretches only the clock that starts at the freeze. The suggested rating still uses the card\'s own window, so a longer clock never inflates ratings.'),
      ),
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Account'),
      app.person
        ? h(
            'p',
            { class: 'note' },
            signedIn ? `Signed in as ${app.person.name}. Your progress syncs to your account.` : `${app.person.name} is not signed in, so nothing syncs.`,
          )
        : null,
      app.person && !signedIn ? h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/signin/${encodeURIComponent(app.person.id)}` }, 'Sign in')) : null,
      field('deviceLabel', 'Name for this device', s.deviceLabel, { hint: 'For example Phone or Laptop. Shows in sync commit messages.' }),
      h('label', {}, h('span', {}, h('input', { type: 'checkbox', name: 'autoSync', checked: s.autoSync !== false }), ' Sync when the app opens and after each session')),
    ),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save settings'),
      h('button', { class: 'btn', type: 'button', onclick: () => doSync() }, 'Sync now'),
    ),
    status,
    h(
      'fieldset',
      {},
      h('legend', {}, 'Progress on this device'),
      h(
        'p',
        { class: 'note' },
        `${app.person ? `${app.person.name}: ` : ''}${app.progress.logs.length.toLocaleString()} reviews recorded, ${formatBytes(progressSizeBytes(app.progress))} on this device. Device id ${app.progress.device_id}.`,
      ),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => doExport() }, 'Export progress'),
        h('label', { class: 'btn' }, 'Import progress', h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: (e) => doImport(e) })),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => doReset() }, 'Reset progress'),
      ),
    ),
  );

  function save() {
    const fd = new FormData(form);
    const next = {
      ...app.settings,
      batchSize: clampInt(fd.get('batchSize'), 3, 50, 10),
      newPerDay: str(fd.get('newPerDay')) === '' ? null : clampInt(fd.get('newPerDay'), 0, 999, null),
      maxIntervalDays: clampInt(fd.get('maxIntervalDays'), 30, 3650, 365),
      cameraMode: fd.get('cameraMode') === 'first_person' ? 'first_person' : 'over_shoulder',
      matureAids: MATURE_AID_CHOICES.includes(fd.get('matureAids')) ? fd.get('matureAids') : 'fade',
      chooseTimeScale: CHOOSE_TIME_CHOICES.some(([v]) => v === Number(fd.get('chooseTimeScale'))) ? Number(fd.get('chooseTimeScale')) : 1,
      autoSync: fd.get('autoSync') === 'on',
      deviceLabel: str(fd.get('deviceLabel')),
    };
    saveSettings(next);
    if (next.maxIntervalDays !== app.settings.maxIntervalDays || next.requestRetention !== app.settings.requestRetention) {
      app.scheduler = makeScheduler({ requestRetention: next.requestRetention, maximumInterval: next.maxIntervalDays });
    }
    app.settings = next;
    app.progress.device_label = next.deviceLabel;
    saveProgress(app.progress);
  }

  async function doSync() {
    save();
    status.textContent = 'Syncing...';
    try {
      await syncNow(app);
      status.textContent = `Synced. ${app.progress.logs.length} reviews across your devices; the deck has ${app.index.deck.cards.length} cards.`;
    } catch (e) {
      status.textContent = e.message;
    }
  }

  function doExport() {
    const blob = new Blob([exportProgress(app.progress)], { type: 'application/json' });
    const name = [app.person?.id, app.progress.device_id.slice(0, 8)].filter(Boolean).join('-');
    const a = h('a', { href: URL.createObjectURL(blob), download: `court-sense-progress-${name}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function doImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const incoming = importProgress(await file.text(), app.person?.id);
      const before = app.progress.logs.length;
      app.progress = mergeProgress(app.progress, incoming, { replay: app.scheduler.replay });
      saveProgress(app.progress);
      status.textContent = `Imported ${app.progress.logs.length - before} new reviews.`;
    } catch (err) {
      status.textContent = err.message;
    }
  }

  function doReset() {
    const whose = app.person ? `${app.person.name}’s review history` : 'the review history';
    if (!confirm(`Erase ${whose} on this device? Copies already synced to GitHub are not touched.`)) return;
    app.progress = emptyProgress(app.progress.device_id, app.progress.device_label, app.person?.id);
    saveProgress(app.progress);
    status.textContent = 'Progress on this device was reset.';
  }

  root.replaceChildren(topbar(), h('main', { class: 'page' }, h('h1', {}, 'Settings'), form, peopleSection(app)));
}

// People on this device: who is playing, switch, remove, add. Each person signs
// in with their own account, and adding someone opens the sign-in screen and
// then switches to them, so a borrowed phone is handed over in one step.
// Switching needs no password. There is no Sign out; Remove takes someone else
// off the device, their session with them.
function peopleSection(app) {
  const status = h('p', { class: 'note', role: 'status' });
  const row = (p) => {
    if (p.id === app.person?.id) return h('li', {}, h('b', {}, p.name), h('span', { class: 'note' }, 'playing now'));
    const li = h(
      'li',
      {},
      h('span', {}, p.name),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: () => {
            switchPerson(app, p.id);
            location.hash = '#/';
          },
        },
        'Switch',
      ),
      h(
        'button',
        {
          class: 'btn quiet',
          type: 'button',
          onclick: () => {
            if (!confirm(`Remove ${p.name} from this device? The reviews kept here for ${p.name} are erased. Copies already synced to GitHub stay.`)) return;
            app.people = savePeople(removePerson(app.people, p.id));
            li.remove();
            status.textContent = `${p.name} was removed from this device.`;
          },
        },
        'Remove',
      ),
    );
    return li;
  };
  return h(
    'div',
    { class: 'form' },
    h(
      'fieldset',
      {},
      h('legend', {}, 'People'),
      h('p', { class: 'note' }, 'Each person signs in with their own account. Adding someone switches to them.'),
      h('ul', { class: 'people' }, ...(app.people?.people ?? []).map(row)),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/signin' }, 'Add a person')),
      status,
    ),
  );
}

const USERNAME_HINT = 'Your name is fine, for example Mary Ann. Use the same one on every device.';
const FORGOT = 'Ask Jeremy to reset your password. Once he has, create your account again with the same name, and your progress is kept.';

// The sign-in screen, in two modes: Sign in, and Create an account with the
// family code. Where nobody has signed in yet it is the only way in, so it has
// no Cancel. A name can be filled in, for someone already on the device whose
// session went or whose password was reset; switching modes keeps what was
// typed. The username's slug is the person's id (store/people.js), so it has to
// match across their devices.
export function renderSignIn(root, app, { mode = 'sign-in', name = '', migrating = false, onDone, onCancel = null } = {}) {
  const creating = mode === 'create';
  const status = h('p', { class: 'note', role: 'status' });
  const forgot = h('p', { class: 'note', hidden: true }, FORGOT);
  const username = h('input', { type: 'text', name: 'username', value: name, autocomplete: 'username', autocapitalize: 'words', spellcheck: 'false', maxlength: 60, required: true });
  const password = h('input', { type: 'password', name: 'password', autocomplete: creating ? 'new-password' : 'current-password', required: true });
  const code = creating ? h('input', { type: 'text', name: 'familyCode', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', required: true }) : null;
  const submitButton = h('button', { class: 'btn primary', type: 'submit' }, creating ? 'Create account' : 'Sign in');
  const link = (label, onclick) =>
    h(
      'a',
      {
        class: 'btn quiet',
        href: '#',
        onclick: (e) => {
          e.preventDefault();
          onclick();
        },
      },
      label,
    );
  const switchTo = (next) => () => renderSignIn(root, app, { mode: next, name: username.value, migrating, onDone, onCancel });
  let busy = false;
  async function submit() {
    if (busy) return;
    busy = true;
    submitButton.disabled = true;
    status.textContent = 'Signing in...';
    try {
      const person = creating
        ? await createPersonAccount(app, { name: username.value, password: password.value, familyCode: code.value })
        : await signInPerson(app, { name: username.value, password: password.value });
      status.textContent = '';
      onDone?.(person);
    } catch (err) {
      status.textContent = err.message;
      busy = false;
      submitButton.disabled = false;
    }
  }
  const form = h(
    'form',
    {
      class: 'form',
      onsubmit: (e) => {
        e.preventDefault();
        submit();
      },
    },
    h('label', {}, 'Username', username, h('small', {}, USERNAME_HINT)),
    h('label', {}, 'Password', password, creating ? h('small', {}, 'At least 8 characters.') : null),
    creating ? h('label', {}, 'Family code', code, h('small', {}, 'Jeremy gives this to the family.')) : null,
    h('div', { class: 'row' }, submitButton, onCancel ? h('button', { class: 'btn', type: 'button', onclick: () => onCancel() }, 'Cancel') : null),
    status,
    creating
      ? h('div', { class: 'row' }, link('Sign in instead', switchTo('sign-in')))
      : h('div', { class: 'row' }, link('Create an account', switchTo('create')), link('Forgot your password?', () => (forgot.hidden = false))),
    forgot,
  );
  const intro = migrating ? h('p', {}, 'Court Sense now keeps a separate record for each person. The reviews already on this device go to the account you sign in to.') : null;
  root.replaceChildren(topbar(), h('main', { class: 'page' }, h('section', { class: 'today' }, h('h1', {}, creating ? 'Create an account' : 'Sign in'), intro, form)));
  (name ? password : username).focus?.();
}

// The #/signin route: add a person, or sign in again someone already on the
// device (#/signin/<id>, with their name filled in). Success switches to them,
// records an answer they left unrated, and goes Home; Cancel goes back to
// Settings.
export function renderSignInPage(root, app, id = '') {
  const known = id ? personById(app.people, id) : null;
  renderSignIn(root, app, {
    name: known?.name ?? '',
    onDone: () => {
      finalizePending(app);
      location.hash = '#/';
    },
    onCancel: () => {
      location.hash = '#/settings';
    },
  });
}
