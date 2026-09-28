// Which choices a showing displays, and in what order.
//
// A card's options are a pool: one to three phrasings of the correct play and
// any number of wrong answers. Each showing displays one correct phrasing and
// up to three wrong answers, shuffled. Showing k (the card's review count)
// rotates both: correct phrasings take turns, and the wrong answers are a
// window that moves two places per showing, so consecutive showings share one
// wrong answer. The correct choice is then never the only familiar one, and a
// mirrored showing gets a different set from the one before it.
//
// Placement is balanced rather than purely random: within each run of n
// showings (n = choices on screen) the correct choice takes every position
// once, in a fresh random order each run, so position carries no information
// and there are no streaks. The same card and showing always give the same result.

export const MAX_WRONG_SHOWN = 3;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, seed) {
  const a = [...items];
  const rnd = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickOptions(card, showing = 0) {
  const pool = card.options ?? [];
  const right = pool.filter((o) => o.correct);
  const wrong = pool.filter((o) => !o.correct);
  const k = Math.max(0, Math.floor(showing));
  const correct = right.length ? right[k % right.length] : null;
  const w = Math.min(MAX_WRONG_SHOWN, wrong.length);
  let picked = wrong;
  if (wrong.length > w) {
    const start = (k * Math.max(1, w - 1)) % wrong.length;
    picked = Array.from({ length: w }, (_, j) => wrong[(start + j) % wrong.length]);
  }
  const wrongOrder = shuffle(picked, hash(`${card.id}#${k}`));
  if (!correct) return wrongOrder;
  const n = picked.length + 1;
  const positions = shuffle([...Array(n).keys()], hash(`${card.id}#run${Math.floor(k / n)}`));
  wrongOrder.splice(positions[k % n], 0, correct);
  return wrongOrder;
}
