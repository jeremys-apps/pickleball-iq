// Home, card browser, card preview, and settings.

import { h } from './dom.js';
import { topbar, count } from './chrome.js';
import { planBatch } from './session.js';
import { mountCard } from './card-view.js';
import { stageFor, STAGES, makeScheduler, applyAidPreference, MATURE_AID_CHOICES } from '../srs/scheduler.js';
import { saveSettings } from '../store/settings.js';
import { loadSyncConfig, saveSyncConfig } from '../store/github-sync.js';
import { exportProgress, importProgress, mergeProgress, saveProgress, emptyProgress, progressSizeBytes, formatBytes } from '../store/progress.js';
import { syncNow } from '../sync.js';
import { canMirror } from '../court/mirror.js';
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

export function renderHome(root, app) {
  const plan = planBatch(app.index, app.progress, app.settings);
  const parts = [
    h('h1', {}, 'Today'),
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
    parts.push(h('p', { class: 'banner' }, 'This is the sample deck: a few cards written to exercise the app. Connect your data repository in Settings to load your real deck.'));
  }
  if (app.deckError) {
    parts.push(h('p', { class: 'banner warn' }, `Your deck could not be loaded from GitHub, so ${app.deckSource === 'cache' ? 'the copy saved on this device' : 'the sample deck'} is in use. ${app.deckError}`));
  }
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
          h('p', { class: 'note' }, d.cards.map((c, i) => [i ? ', ' : 'Cards: ', h('a', { href: `#/preview/${encodeURIComponent(c.id)}` }, c.prompt)])),
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

export function renderCards(root, app) {
  const items = app.index.deck.cards.map((c) => {
    const e = app.progress.cards[c.id];
    const status = !e ? 'New' : e.suspended ? 'Suspended' : `Due ${new Date(e.fsrs.due).toLocaleDateString()}`;
    return h('li', {}, h('a', { href: `#/preview/${encodeURIComponent(c.id)}` }, c.prompt), h('span', { class: 'note' }, ` ${TYPE_LABEL[c.type]}. ${status}.`));
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
  const cfg = loadSyncConfig() ?? {};
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
      h('legend', {}, 'Data repository'),
      h('p', { class: 'note' }, 'Your deck and progress live in a private GitHub repository. Use a fine-grained token limited to that one repository with Contents set to Read and write, and give it an expiry date.'),
      field('owner', 'Owner', cfg.owner),
      field('repo', 'Repository', cfg.repo),
      field('branch', 'Branch', cfg.branch ?? 'main'),
      field('deckPath', 'Deck file', cfg.deckPath ?? 'deck/deck.json'),
      field('progressDir', 'Progress folder', cfg.progressDir ?? 'progress'),
      field('token', 'Token', cfg.token, { type: 'password', hint: 'Stored only in this browser.' }),
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
      h('p', { class: 'note' }, `${app.progress.logs.length.toLocaleString()} reviews recorded, ${formatBytes(progressSizeBytes(app.progress))} on this device. Device id ${app.progress.device_id}.`),
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
    saveSyncConfig({
      owner: str(fd.get('owner')),
      repo: str(fd.get('repo')),
      branch: str(fd.get('branch')) || 'main',
      deckPath: str(fd.get('deckPath')) || 'deck/deck.json',
      progressDir: str(fd.get('progressDir')) || 'progress',
      token: str(fd.get('token')),
    });
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
    const a = h('a', { href: URL.createObjectURL(blob), download: `court-sense-progress-${app.progress.device_id.slice(0, 8)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function doImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const incoming = importProgress(await file.text());
      const before = app.progress.logs.length;
      app.progress = mergeProgress(app.progress, incoming, { replay: app.scheduler.replay });
      saveProgress(app.progress);
      status.textContent = `Imported ${app.progress.logs.length - before} new reviews.`;
    } catch (err) {
      status.textContent = err.message;
    }
  }

  function doReset() {
    if (!confirm('Erase the review history on this device? Copies already synced to GitHub are not touched.')) return;
    app.progress = emptyProgress(app.progress.device_id, app.progress.device_label);
    saveProgress(app.progress);
    status.textContent = 'Progress on this device was reset.';
  }

  root.replaceChildren(topbar(), h('main', { class: 'page' }, h('h1', {}, 'Settings'), form));
}
