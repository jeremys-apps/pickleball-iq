// Progress statistics derived from the review log. Pure: no DOM, no storage.
//
//   timedTrend(logs, { window })                 are timed reads getting faster?
//   topicStats(index, progress, { scheduler })   one row per topic, weakest first
//   drillPlan(index, progress, { scheduler })    drills ranked by the retention of what they train
//
// Only stage B and C reviews count as timed reads: stage A has no clock and
// runs in slow motion, so its response times are not comparable (A9 in plan.md).
// The caller passes the logs of timed_decision cards; this module does not
// know card types.

import { State } from './srs/scheduler.js';

const TIMED_STAGES = new Set(['B', 'C']);
export const MIN_TIMED_REVIEWS = 6;

export function median(values) {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function accuracy(logs) {
  const judged = logs.filter((l) => l.correct != null);
  return judged.length ? judged.filter((l) => l.correct).length / judged.length : null;
}

// Early = the first k reviews by time, late = the last k, k = min(window, floor(n / 2)).
// timeouts: reviews where time ran out before a choice was made.
export function timedTrend(logs, { window = 10 } = {}) {
  const usable = (logs ?? [])
    .filter((l) => TIMED_STAGES.has(l.stage) && l.response_ms != null)
    .sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at) || String(a.id).localeCompare(String(b.id)));
  const n = usable.length;
  if (n < MIN_TIMED_REVIEWS) return null;
  const k = Math.min(window, Math.floor(n / 2));
  const early = usable.slice(0, k);
  const late = usable.slice(-k);
  const earlyMedianMs = median(early.map((l) => l.response_ms));
  const lateMedianMs = median(late.map((l) => l.response_ms));
  return {
    n,
    timeouts: usable.filter((l) => l.choice == null && l.correct === false).length,
    earlyMedianMs,
    lateMedianMs,
    deltaMs: lateMedianMs - earlyMedianMs,
    earlyAccuracy: accuracy(early),
    lateAccuracy: accuracy(late),
  };
}

const principleOf = (index, card) => index.principles.get(card.principle_id);
const topicOf = (principle) => principle?.topic || principle?.category || 'other';

const seenEntries = (progress, cards) =>
  cards.map((c) => progress.cards?.[c.id]).filter((e) => e?.fsrs && e.fsrs.state !== State.New);

function meanRetrievability(scheduler, entries, now) {
  if (!scheduler) return null;
  const rs = entries.map((e) => scheduler.retrievability(e.fsrs, now)).filter((r) => r != null);
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
}

const sumLapses = (entries) => entries.reduce((a, e) => a + (e.fsrs.lapses ?? 0), 0);

// Rows are sorted weakest first: retrievability ascending with unknowns last,
// then accuracy ascending with unknowns last, then by topic name.
export function topicStats(index, progress, { scheduler = null, now = new Date(), window = 10 } = {}) {
  const groups = new Map();
  const topicByCard = new Map();
  for (const card of index.deck.cards) {
    const p = principleOf(index, card);
    const topic = topicOf(p);
    topicByCard.set(card.id, topic);
    if (!groups.has(topic)) groups.set(topic, { topic, category: p?.category ?? 'other', cards: [], logs: [] });
    groups.get(topic).cards.push(card);
  }
  for (const l of progress.logs ?? []) {
    const topic = topicByCard.get(l.card_id);
    if (topic) groups.get(topic).logs.push(l); // logs of cards no longer in the deck are ignored
  }
  const rows = [...groups.values()].map((g) => {
    const entries = seenEntries(progress, g.cards);
    const timedIds = new Set(g.cards.filter((c) => c.type === 'timed_decision').map((c) => c.id));
    return {
      topic: g.topic,
      category: g.category,
      cards: g.cards.length,
      seen: entries.length,
      choiceReviews: g.logs.filter((l) => l.correct != null).length,
      accuracy: accuracy(g.logs),
      lapses: sumLapses(entries),
      retrievability: meanRetrievability(scheduler, entries, now),
      timed: timedTrend(g.logs.filter((l) => timedIds.has(l.card_id)), { window }),
    };
  });
  const unknownLast = (v) => (v == null ? 2 : v);
  rows.sort(
    (a, b) =>
      unknownLast(a.retrievability) - unknownLast(b.retrievability) ||
      unknownLast(a.accuracy) - unknownLast(b.accuracy) ||
      a.topic.localeCompare(b.topic),
  );
  return rows;
}

// Drills whose trained principles have the lowest retention come first. A drill
// with no seen trained principle (or no scheduler to judge retention) has a null
// score and sorts after, by priority.
export function drillPlan(index, progress, { scheduler = null, now = new Date() } = {}) {
  const cardsByPrinciple = new Map();
  for (const c of index.deck.cards) {
    if (!cardsByPrinciple.has(c.principle_id)) cardsByPrinciple.set(c.principle_id, []);
    cardsByPrinciple.get(c.principle_id).push(c);
  }
  const status = (principle) => {
    const entries = seenEntries(progress, cardsByPrinciple.get(principle.id) ?? []);
    return { principle, seen: entries.length > 0, retrievability: meanRetrievability(scheduler, entries, now), lapses: sumLapses(entries) };
  };
  const plans = index.deck.principles
    .filter((p) => p.category === 'drill')
    .map((drill) => {
      const trains = (drill.trains ?? []).map((id) => index.principles.get(id)).filter(Boolean).map(status);
      const judged = trains.filter((t) => t.retrievability != null);
      const weakest = judged.length ? judged.reduce((a, b) => (b.retrievability < a.retrievability ? b : a)) : null;
      return { drill, cards: cardsByPrinciple.get(drill.id) ?? [], trains, weakest, score: weakest?.retrievability ?? null };
    });
  plans.sort((a, b) => {
    if (a.score == null && b.score == null) return (b.drill.priority ?? 0) - (a.drill.priority ?? 0) || a.drill.id.localeCompare(b.drill.id);
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return a.score - b.score || a.drill.id.localeCompare(b.drill.id);
  });
  return plans;
}
