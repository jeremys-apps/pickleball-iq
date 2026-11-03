// People's names on a card: full name at the first mention, first name after.
import test from 'node:test';
import assert from 'node:assert/strict';
import { peopleOf, makeNamer } from '../app/src/names.js';

const deck = {
  speakers: {
    'tanner-tomassi': { name: 'Tanner Tomassi', tier: 'touring_pro' },
    'brodie-smith': { name: 'Brodie Smith', tier: 'elite_coach' },
    'danni-elle-townsend': { name: 'Danni-Elle Townsend', tier: 'touring_pro' },
  },
  people: ['Ben Johns', 'Will Howells', 'Chris Haworth', 'Chris Lee'],
};
const people = peopleOf(deck);
const card = (fields) => ({ prompt: '', ...fields });

test('the deck gives every speaker and every other named person a first name', () => {
  assert.deepEqual(people.find((p) => p.full === 'Danni-Elle Townsend'), { full: 'Danni-Elle Townsend', first: 'Danni-Elle', speaker: true });
  assert.deepEqual(people.find((p) => p.full === 'Ben Johns'), { full: 'Ben Johns', first: 'Ben', speaker: false });
  assert.equal(peopleOf({}).length, 0);
});

test('the first mention, reading top to bottom, gets the full name and later ones the first name', () => {
  const c = card({ prompt: "What does Tanner say when Brodie asks?", explanation: "Tanner Tomassi answers Brodie's question." });
  const n = makeNamer(people, c);
  assert.equal(n.name(c.prompt), 'What does Tanner Tomassi say when Brodie Smith asks?');
  assert.equal(n.name('Tanner and Brodie agree.'), 'Tanner and Brodie agree.');
  assert.equal(n.name(c.explanation), "Tanner answers Brodie's question.", 'a full name written further down becomes the first name');
});

test('the order is the order the namer sees, so a name first met in a choice gets it there', () => {
  const n = makeNamer(people, card({}));
  assert.equal(n.name('Hold it, as Danni-Elle would'), 'Hold it, as Danni-Elle Townsend would');
  assert.equal(n.name("Danni-Elle's reason"), "Danni-Elle's reason");
});

test('another person counts on a card only when its text gives the full name', () => {
  const plain = card({ prompt: 'Will you speed it up?' });
  assert.equal(makeNamer(people, plain).name(plain.prompt), 'Will you speed it up?', 'an ordinary word is left alone');
  const named = card({ prompt: 'Who does Tanner watch?', explanation: 'Ben Johns, and Ben leans in.' });
  const n = makeNamer(people, named);
  n.name(named.prompt);
  assert.equal(n.name('Ben, mostly'), 'Ben Johns, mostly');
  assert.equal(n.name(named.explanation), 'Ben, and Ben leans in.');
});

test('a first name two people share is left as written', () => {
  const c = card({ prompt: 'Chris Haworth and Chris Lee both stay back. Chris says why.' });
  assert.equal(makeNamer(people, c).name(c.prompt), 'Chris Haworth and Chris Lee both stay back. Chris says why.');
});

test('the source lines keep their full names and count as a mention', () => {
  const n = makeNamer(people, card({}));
  n.mark('Tanner Tomassi (touring pro). Pickleball Cheat Code, "Episode", at 00:10:41.');
  assert.equal(n.name("Tanner's rule"), "Tanner's rule");
  assert.equal(n.name('Brodie asked'), 'Brodie Smith asked');
});
