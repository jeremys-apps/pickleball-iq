// People's names on a card. The first time a person is mentioned, reading top
// to bottom, they get their full name; every later mention is the first name
// alone (Jeremy, November 2026). The choices change order between showings, so
// the app applies the rule as it draws a card, not in the deck's text.
//
// Speakers' names come from the deck's speaker list. Other people a card names
// (a partner, a pro held up as a model) come from deck.people, and count on a
// card only when its text gives their full name somewhere, so a first name that
// is also an ordinary word ("Will", "Mark") never picks up a last name elsewhere.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// [{full, first, speaker}] for the deck's speakers and the other people it names.
export function peopleOf(deck) {
  const out = [];
  const seen = new Set();
  const add = (name, speaker) => {
    const full = String(name ?? '').trim();
    const cut = full.indexOf(' ');
    if (cut < 1 || seen.has(full)) return;
    seen.add(full);
    out.push({ full, first: full.slice(0, cut), speaker });
  };
  for (const s of Object.values(deck?.speakers ?? {})) add(s?.name, true);
  for (const name of deck?.people ?? []) add(name, false);
  return out;
}

// Every piece of text a card can show, for deciding who it names.
export function cardTexts(card, note = card?.claude_note) {
  const parts = [card?.prompt, card?.answer, card?.explanation, card?.focus_cue, note];
  for (const o of card?.options ?? []) parts.push(o.text, o.feedback);
  return parts.filter(Boolean).join('\n');
}

// One namer per showing of a card. name(text) rewrites a text and remembers who
// it named, so call it in the order the texts appear on screen. mark(text) only
// remembers the full names a text already shows (the source lines, which keep
// their own format).
export function makeNamer(people, card, note) {
  const all = cardTexts(card, note);
  const present = (people ?? []).filter((p) => p.speaker || new RegExp(`(^|[^\\w-])${escapeRe(p.full)}(?![\\w-])`).test(all));
  const byFull = new Map(present.map((p) => [p.full, p]));
  // A first name two people share is left as written: it could be either.
  const firsts = new Map();
  for (const p of present) firsts.set(p.first, firsts.has(p.first) ? null : p);
  const byFirst = new Map([...firsts].filter(([, p]) => p));
  const forms = [...byFull.keys(), ...byFirst.keys()].sort((a, b) => b.length - a.length);
  const re = forms.length ? new RegExp(`(^|[^\\w-])(${forms.map(escapeRe).join('|')})(?![\\w-])`, 'g') : null;
  const named = new Set();
  return {
    name(text) {
      if (!text || !re) return text;
      return text.replace(re, (all, pre, m) => {
        const p = byFull.get(m) ?? byFirst.get(m);
        if (named.has(p)) return pre + p.first;
        named.add(p);
        return pre + p.full;
      });
    },
    mark(text) {
      if (!text || !re) return;
      for (const m of text.matchAll(re)) if (byFull.has(m[2])) named.add(byFull.get(m[2]));
    },
  };
}
