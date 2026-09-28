// Choice pools: one correct phrasing and up to three wrong answers per showing,
// shuffled and rotating, so answers can't be remembered by position or list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickOptions, MAX_WRONG_SHOWN } from '../app/src/choices.js';

const deck = JSON.parse(readFileSync(new URL('../app/data/deck.sample.json', import.meta.url)));
const card = (id) => deck.cards.find((c) => c.id === id);
const choiceCards = deck.cards.filter((c) => c.options);
const ids = (opts) => opts.map((o) => o.id);
const wrongIds = (opts) => new Set(opts.filter((o) => !o.correct).map((o) => o.id));

test('each showing has one correct phrasing and up to three wrong answers from the pool', () => {
  for (const c of choiceCards) {
    for (let k = 0; k < 8; k++) {
      const shown = pickOptions(c, k);
      assert.equal(shown.filter((o) => o.correct).length, 1, `${c.id} showing ${k}`);
      assert.ok(shown.length >= 3 && shown.length <= 1 + MAX_WRONG_SHOWN);
      assert.ok(shown.every((o) => c.options.includes(o)));
      assert.deepEqual(ids(pickOptions(c, k)), ids(shown), 'same card and showing, same choices');
    }
  }
});

test('the correct choice takes every position once in each run of showings', () => {
  for (const c of choiceCards) {
    const n = pickOptions(c, 0).length;
    for (let run = 0; run < 3; run++) {
      const positions = Array.from({ length: n }, (_, i) => pickOptions(c, run * n + i).findIndex((o) => o.correct));
      assert.deepEqual([...positions].sort(), [...Array(n).keys()], `${c.id}, run ${run}: ${positions}`);
    }
  }
});

test('consecutive showings share exactly one wrong answer when the pool is large', () => {
  const c = card('c-floater-fp-1'); // six wrong answers
  for (let k = 0; k < 6; k++) {
    const a = wrongIds(pickOptions(c, k));
    const b = wrongIds(pickOptions(c, k + 1));
    assert.equal([...a].filter((x) => b.has(x)).length, 1, `showings ${k} and ${k + 1}`);
  }
});

test('the authored and mirrored showings differ, including the correct phrasing', () => {
  const c = card('c-floater-fp-1');
  const authored = pickOptions(c, 0);
  const mirrored = pickOptions(c, 1);
  assert.notDeepEqual([...wrongIds(authored)].sort(), [...wrongIds(mirrored)].sort());
  assert.notEqual(authored.find((o) => o.correct).id, mirrored.find((o) => o.correct).id);
});

test('a small pool shows all of its wrong answers every time, reshuffled', () => {
  const c = card('c-backhands-td-1'); // three wrong answers
  const orders = new Set();
  for (let k = 0; k < 6; k++) {
    const shown = pickOptions(c, k);
    assert.equal(shown.length, 4);
    orders.add(ids(shown).join(''));
  }
  assert.ok(orders.size > 1);
});
