// Sessions are open-ended. Cards come in batches (due reviews first, new cards
// mixed in), each batch ends with a summary, and "Keep going" starts another.
// Nothing caps the day unless a new-card limit is set in Settings.
// A batch shows each of its cards once and never grows. A card rated with a wait
// of minutes comes back in the first batch planned after the wait is over.

import { h } from './dom.js';
import { topbar, count } from './chrome.js';
import { mountCard } from './card-view.js';
import { shouldMirror } from '../court/mirror.js';
import { stageFor, applyAidPreference, Rating, State } from '../srs/scheduler.js';
import { recordReview, saveProgress, newIntroducedOn, localDay, savePending, clearPending, takePending } from '../store/progress.js';

const REST_MS = 30 * 60000;

// Plan one batch.
// Order: due cards (most overdue first) with a new card after every three. A
// card is due only once its wait is over, learning steps included, so the time
// on the rating button holds.
// New cards: principles not yet seen today first, one variant per principle
// before second variants, then priority. Adjacent siblings are split up.
// When nothing is due and every card has been seen: practice ahead, soonest due first.
export function planBatch(index, progress, settings, { now = new Date(), sessionPrinciples = new Set() } = {}) {
  const size = Math.max(1, settings.batchSize ?? 10);
  const t = now.getTime();
  const due = [];
  const fresh = [];
  const ahead = [];
  for (const card of index.deck.cards) {
    const e = progress.cards[card.id];
    if (e?.suspended) continue;
    if (!e?.fsrs || e.fsrs.state === State.New) {
      fresh.push(card);
      continue;
    }
    const at = new Date(e.fsrs.due).getTime();
    if (at <= t) due.push({ card, at });
    else ahead.push({ card, at, last: e.fsrs.last_review ? new Date(e.fsrs.last_review).getTime() : 0 });
  }
  due.sort((a, b) => a.at - b.at);

  const today = localDay(now);
  const touched = new Set(sessionPrinciples);
  for (const l of progress.logs) if (localDay(l.reviewed_at) === today) touched.add(index.cards.get(l.card_id)?.principle_id);
  for (const d of due) touched.add(d.card.principle_id);
  const order = new Map(index.deck.cards.map((c, i) => [c.id, i]));
  const prio = (c) => index.principles.get(c.principle_id)?.priority ?? 0;
  fresh.sort((a, b) => prio(b) - prio(a) || order.get(a.id) - order.get(b.id));
  const rounds = new Map();
  const ranked = fresh.map((card) => {
    const round = rounds.get(card.principle_id) ?? 0;
    rounds.set(card.principle_id, round + 1);
    return { card, round, touched: touched.has(card.principle_id) ? 1 : 0 };
  });
  ranked.sort((a, b) => a.touched - b.touched || a.round - b.round || prio(b.card) - prio(a.card) || order.get(a.card.id) - order.get(b.card.id));

  const allowance = settings.newPerDay == null ? Infinity : Math.max(0, settings.newPerDay - newIntroducedOn(progress, now));
  const newPick = ranked.slice(0, Math.min(ranked.length, allowance)).map((r) => r.card);

  const items = [];
  let i = 0;
  let j = 0;
  while (items.length < size && (i < due.length || j < newPick.length)) {
    for (let k = 0; k < 3 && i < due.length && items.length < size; k++) items.push({ card: due[i++].card, kind: 'review' });
    if (j < newPick.length && items.length < size) items.push({ card: newPick[j++], kind: 'new' });
  }
  let practice = false;
  if (!items.length && ahead.length) {
    const rested = ahead.filter((a) => t - a.last >= REST_MS);
    const pool = (rested.length ? rested : ahead).sort((a, b) => a.at - b.at);
    for (const a of pool.slice(0, size)) items.push({ card: a.card, kind: 'ahead' });
    practice = true;
  }
  return { items: spreadSiblings(items), dueCount: due.length, newCount: newPick.length, unseenCount: fresh.length, practice };
}

function spreadSiblings(items) {
  const out = [...items];
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1].card.principle_id;
    if (out[i].card.principle_id !== prev) continue;
    const j = out.findIndex((x, k) => k > i && x.card.principle_id !== prev);
    if (j > 0) [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// An answered but unrated card (the app was closed before rating) is recorded
// with its suggested rating the next time the app opens.
export function finalizePending(app, storage = globalThis.localStorage) {
  const p = takePending(storage, app.person?.id);
  if (!p || !app.index.cards.has(p.card_id)) return false;
  if (app.progress.logs.some((l) => l.card_id === p.card_id && l.reviewed_at >= p.reviewed_at)) return false;
  const at = new Date(p.reviewed_at);
  const entry = app.progress.cards[p.card_id];
  const { state } = app.scheduler.review(entry?.fsrs ?? app.scheduler.newState(at), p.rating, at);
  recordReview(app.progress, p.card_id, state, {
    rating: p.rating,
    correct: p.correct,
    choice: p.choice ?? null,
    response_ms: p.response_ms ?? null,
    stage: p.stage,
    view: p.view,
    mirrored: !!p.mirrored,
    shown: p.shown ?? null,
    reviewed_at: p.reviewed_at,
    auto_rated: true,
  });
  saveProgress(app.progress, storage);
  return true;
}

// The cue to carry onto the court: from a missed card first, then a new one.
function focusCue(results) {
  const pool = [
    ...results.filter((r) => r.correct === false || r.rating === Rating.Again),
    ...results.filter((r) => r.kind === 'new'),
    ...results,
  ];
  const hit = pool.find((r) => r.card.focus_cue);
  return hit ? { text: hit.card.focus_cue, card_id: hit.card.id } : null;
}

// A drill that trains something you missed in this batch.
function drillFor(results, index) {
  const missed = new Set(results.filter((r) => r.correct === false || r.rating === Rating.Again).map((r) => r.card.principle_id));
  if (!missed.size) return null;
  const drill = index.deck.principles.find((p) => p.category === 'drill' && (p.trains ?? []).some((id) => missed.has(id)));
  return drill?.statement ?? null;
}

export function runSession(root, app, { onBatchEnd } = {}) {
  const sessionPrinciples = new Set();
  const totals = { cards: 0, batches: 0 };
  const sessionStart = Date.now();
  let queue = [];
  let results = [];
  let batchStart = 0;
  let current = null;
  let closed = false;
  let inSummary = false;

  const meter = h('i');
  const status = h('span', { class: 'status' });
  const bar = h(
    'div',
    { class: 'session-bar' },
    h('span', { class: 'meter', 'aria-hidden': 'true' }, meter),
    status,
    h('button', { class: 'btn quiet', type: 'button', onclick: () => endBatch() }, 'End batch'),
  );
  const host = h('main', { class: 'page' });
  root.replaceChildren(topbar(), bar, host);

  function startBatch() {
    const plan = planBatch(app.index, app.progress, app.settings, { sessionPrinciples });
    if (!plan.items.length) return showEmpty();
    queue = [...plan.items];
    results = [];
    batchStart = Date.now();
    totals.batches += 1;
    inSummary = false;
    bar.hidden = false;
    next();
  }

  function next() {
    current?.destroy?.();
    current = null;
    if (closed) return;
    if (!queue.length) return endBatch();
    const item = queue.shift();
    const entry = app.progress.cards[item.card.id];
    const stage = applyAidPreference(stageFor(entry?.fsrs), app.settings.matureAids);
    const total = results.length + queue.length + 1;
    meter.style.width = `${Math.round((results.length / total) * 100)}%`;
    status.textContent = `${item.kind === 'ahead' ? 'Practice ahead. ' : ''}Card ${results.length + 1} of ${total}`;
    current = mountCard(host, {
      card: item.card,
      index: app.index,
      stage,
      settings: app.settings,
      scheduler: app.scheduler,
      state: entry?.fsrs,
      mirrored: shouldMirror(item.card, entry?.fsrs),
      onAnswered: (r) => {
        if (r.correct == null) return; // self-graded cards simply come back if unrated
        savePending({
          person_id: app.person?.id,
          card_id: item.card.id,
          rating: r.suggested,
          correct: r.correct,
          choice: r.choice,
          response_ms: r.responseMs,
          stage: stage.id,
          view: r.view,
          mirrored: !!r.mirrored,
          shown: r.shown ?? null,
          reviewed_at: new Date().toISOString(),
        });
      },
      onDone: (res) => {
        record(item, entry, stage, res);
        next();
      },
    });
    window.scrollTo?.(0, 0);
  }

  function record(item, entry, stage, res) {
    const now = new Date();
    const { state } = app.scheduler.review(entry?.fsrs ?? app.scheduler.newState(now), res.rating, now);
    recordReview(app.progress, item.card.id, state, {
      rating: res.rating,
      correct: res.correct ?? null,
      choice: res.choice ?? null,
      response_ms: res.responseMs ?? null,
      stage: stage.id,
      view: res.view,
      mirrored: !!res.mirrored,
      shown: res.shown ?? null,
      reviewed_at: now.toISOString(),
    });
    saveProgress(app.progress);
    clearPending(globalThis.localStorage, app.person?.id);
    sessionPrinciples.add(item.card.principle_id);
    totals.cards += 1;
    results.push({ card: item.card, rating: res.rating, correct: res.correct ?? null, kind: item.kind });
  }

  const takeaway = (label, text) => h('div', { class: 'takeaway' }, h('p', { class: 'note' }, label), h('p', { class: 'focus-cue' }, text));

  function endBatch() {
    if (inSummary || closed) return;
    inSummary = true;
    current?.destroy?.();
    current = null;
    bar.hidden = true;
    const picks = results.filter((r) => r.correct != null);
    const right = picks.filter((r) => r.correct).length;
    const minutes = Math.max(1, Math.round((Date.now() - batchStart) / 60000));
    const cue = focusCue(results);
    const drill = drillFor(results, app.index);
    const up = planBatch(app.index, app.progress, app.settings, { sessionPrinciples });
    const dueNext = up.items.filter((x) => x.kind === 'review').length;
    const newNext = up.items.filter((x) => x.kind === 'new').length;
    const label = !up.items.length ? null : up.practice ? `Practice ahead: ${up.items.length} more` : `Keep going: ${up.items.length} more`;
    const note = !up.items.length
      ? 'Nothing is due and there is nothing new.'
      : up.practice
        ? 'Nothing is due and you have seen every card. Practice ahead brings back the cards due soonest; they count as reviews.'
        : `Next batch: ${dueNext} due and ${newNext} new.`;
    const sessionMin = Math.max(1, Math.round((Date.now() - sessionStart) / 60000));
    if (cue) {
      // Kept in the synced settings so Home can show it until the next batch (newest wins on merge).
      const stamp = new Date().toISOString();
      app.progress.settings = { ...(app.progress.settings ?? {}), last_cue: { text: cue.text, card_id: cue.card_id, at: stamp }, updated_at: stamp };
      saveProgress(app.progress);
    }
    const keepGoing = label ? h('button', { class: 'btn primary', type: 'button', onclick: () => startBatch() }, label) : null;
    host.replaceChildren(
      h(
        'section',
        { class: 'summary' },
        h('h1', {}, results.length ? 'Batch done' : 'Batch ended'),
        h(
          'div',
          { class: 'counts' },
          count(results.length, results.length === 1 ? 'card' : 'cards'),
          picks.length ? count(`${right}/${picks.length}`, 'court reads right') : null,
          count(minutes, minutes === 1 ? 'minute' : 'minutes'),
        ),
        totals.batches > 1 ? h('p', { class: 'note' }, `This session: ${totals.cards} cards in ${totals.batches} batches over ${sessionMin} minutes.`) : null,
        cue ? takeaway('Take this to the court', cue.text) : null,
        drill ? takeaway('Drill to try', drill) : null,
        h('p', { class: 'note' }, note),
        h('div', { class: 'row' }, keepGoing, h('a', { class: `btn${keepGoing ? '' : ' primary'}`, href: '#/' }, 'Done')),
      ),
    );
    keepGoing?.focus({ preventScroll: true });
    onBatchEnd?.(results);
  }

  function showEmpty() {
    bar.hidden = true;
    host.replaceChildren(
      h('section', { class: 'summary' }, h('h1', {}, 'Nothing to review'), h('p', { class: 'note' }, 'The deck has no cards to show.'), h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/' }, 'Done'))),
    );
  }

  startBatch();
  return {
    destroy: () => {
      closed = true;
      current?.destroy?.();
    },
  };
}
