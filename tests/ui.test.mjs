// UI smoke tests in jsdom: every card type can be answered and rated, a full
// session runs to the summary, and settings save. Layout is not tested here;
// use the renderer lab and a real browser for that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  /* jsdom not installed */
}
const skip = !JSDOM && 'run npm install to enable UI tests';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const mm = (q) => ({ matches: q.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} });
  w.matchMedia = mm;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    localStorage: w.localStorage,
    getComputedStyle: w.getComputedStyle.bind(w),
    requestAnimationFrame: w.requestAnimationFrame.bind(w),
    cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
    FormData: w.FormData,
    location: w.location,
    matchMedia: mm,
  });
  return w;
}

const deck = JSON.parse(readFileSync(new URL('../app/data/deck.sample.json', import.meta.url)));

async function modules() {
  const [{ mountCard }, { runSession, planBatch, finalizePending }, views, sched, store, deckMod, settings, people, appPeople] = await Promise.all([
    import('../app/src/ui/card-view.js'),
    import('../app/src/ui/session.js'),
    import('../app/src/ui/views.js'),
    import('../app/src/srs/scheduler.js'),
    import('../app/src/store/progress.js'),
    import('../app/src/deck.js'),
    import('../app/src/store/settings.js'),
    import('../app/src/store/people.js'),
    import('../app/src/people.js'),
  ]);
  return { mountCard, runSession, planBatch, finalizePending, views, sched, store, deckMod, settings, people, appPeople };
}

function makeApp(m) {
  const people = { current: 'tester', people: [{ id: 'tester', name: 'Tester', created_at: '2026-10-05T00:00:00.000Z' }] };
  localStorage.setItem(m.store.DEVICE_KEY, 'test-device'); // every record on a device carries its id
  return {
    settings: { ...m.settings.DEFAULT_SETTINGS },
    scheduler: m.sched.makeScheduler({ enableFuzz: false }),
    people,
    person: people.people[0],
    progress: m.store.emptyProgress('test-device', '', 'tester'),
    index: m.deckMod.indexDeck(deck),
    deckSource: 'sample',
    deckError: null,
    sync: {},
  };
}

test('multiple-choice card: answer, reveal, rate', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const host = document.getElementById('app');
  let result = null;
  m.mountCard(host, {
    card: app.index.cards.get('c-dink-fp-1'),
    index: app.index,
    stage: m.sched.STAGES.A,
    settings: app.settings,
    scheduler: app.scheduler,
    state: undefined,
    onDone: (r) => (result = r),
  });
  assert.ok(host.querySelector('.stage svg.piq-fp'), 'first-person view rendered');
  assert.ok(!host.querySelector('.card-view').classList.contains('is-revealed'));
  const dink = app.index.cards.get('c-dink-fp-1');
  const isRight = (b) => dink.options.find((o) => o.id === b.dataset.id).correct;
  const buttons = [...host.querySelectorAll('.option')];
  assert.equal(buttons.length, 4, 'one correct phrasing and three wrong answers from the pool');
  assert.equal(buttons.filter(isRight).length, 1, 'exactly one correct choice on screen');
  const wrong = buttons.find((b) => !isRight(b));
  wrong.click();
  assert.ok(host.querySelector('.card-view').classList.contains('is-revealed'));
  assert.equal(host.querySelector('.verdict').textContent, 'Not quite');
  assert.ok(host.querySelector('.option.is-correct'), 'correct option highlighted');
  const fold = host.querySelector('details.source-info');
  assert.equal(fold.querySelector('summary').textContent, 'Source info');
  assert.equal(fold.open, false, 'sources are folded away until asked for');
  assert.match(fold.querySelector('.source').textContent, /Sample content/);
  assert.equal(host.querySelector('.court .motion .replay').textContent, 'Watch the play', 'the replay sits under the picture');
  // Reduced motion in this test: Watch the play jumps to the finished picture, the
  // answer having flown from the contact point to where it lands.
  const ballY = () => host.querySelector('.hero svg .piq-ball').getAttribute('cy');
  const before = ballY();
  host.querySelector('.court .motion .replay').click();
  const svg = host.querySelector('.hero svg');
  assert.ok(svg.querySelector('.piq-reveal polyline.piq-answer'), 'the answer path is drawn');
  assert.ok(svg.querySelector('[class*="piq-path"]'), 'their shot stays as a trail');
  assert.notEqual(ballY(), before, 'the ball ends where the answer lands');
  assert.equal(host.querySelector('.rating.suggested b').textContent, 'Again');
  host.querySelector('.rating.suggested').click();
  assert.equal(result.rating, 1);
  assert.equal(result.correct, false);
  assert.equal(result.choice, wrong.dataset.id);
  assert.deepEqual(result.shown, buttons.map((b) => b.dataset.id), 'the log records what was on screen');
});

test('mature cards keep the picture, drop the overlays, and bring every aid back after the answer', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const host = document.getElementById('app');
  m.mountCard(host, { card: app.index.cards.get('c-floater-fp-1'), index: app.index, stage: m.sched.STAGES.C, settings: app.settings, scheduler: app.scheduler, onDone: () => {} });
  const fp = () => host.querySelector('.hero svg');
  assert.ok(fp(), 'the court picture is there at every stage');
  assert.equal(fp().querySelector('[class*="piq-path"]'), null, 'no painted flight path while deciding');
  assert.equal(fp().querySelector('[class*="stalk"]'), null, 'no height stick while deciding');
  assert.ok(fp().querySelector('.piq-ball-shadow'), 'the shadow stays');
  assert.equal(host.querySelector('.panel svg'), null, 'no map while deciding');
  host.querySelector('.option').click();
  assert.ok(fp().querySelector('[class*="piq-path"]'), 'flight path returns after the answer');
  assert.ok(fp().querySelector('[class*="stalk"]'), 'height stick returns after the answer');
  assert.ok(host.querySelector('.panel svg'), 'map returns after the answer');
});

test('a mirrored card records it without announcing it on the reveal', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const host = document.getElementById('app');
  let result = null;
  m.mountCard(host, { card: app.index.cards.get('c-floater-fp-1'), index: app.index, stage: m.sched.STAGES.B, settings: app.settings, scheduler: app.scheduler, mirrored: true, onDone: (r) => (result = r) });
  host.querySelector('.option').click();
  assert.doesNotMatch(host.querySelector('.after').textContent, /Mirrored/, 'the flipped court is just another look at the situation');
  host.querySelector('.rating.suggested').click();
  assert.equal(result.mirrored, true);
});

test('the topbar marks the tab you are on, with Court Sense as the Home tab', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const root = document.getElementById('app');
  const current = () => [...root.querySelectorAll('.topbar a[aria-current="page"]')].map((a) => a.textContent);
  m.views.renderHome(root, app);
  assert.deepEqual(current(), ['Court Sense']);
  location.hash = '#/progress';
  m.views.renderProgress(root, app);
  assert.deepEqual(current(), ['Progress']);
  location.hash = '#/preview/c-dink-fp-1/A';
  m.views.renderCards(root, app);
  assert.deepEqual(current(), ['Cards'], 'a card preview belongs to Cards');
  location.hash = '#/session';
  m.views.renderHome(root, app);
  assert.deepEqual(current(), ['Court Sense'], 'a session belongs to Home');
  location.hash = '';
});

test('self-graded card: show answer with the keyboard, rate with a number key', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const host = document.getElementById('app');
  let result = null;
  m.mountCard(host, {
    card: app.index.cards.get('c-floater-why-1'),
    index: app.index,
    stage: m.sched.STAGES.A,
    settings: app.settings,
    scheduler: app.scheduler,
    onDone: (r) => (result = r),
  });
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.ok(!host.querySelector('.after').hidden);
  assert.match(host.querySelector('.source-info .claude-note').textContent, /^Additional note: /);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '3' }));
  assert.equal(result.rating, 3);
});

test('timed card: play, freeze unlocks options, time running out counts as a miss', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const host = document.getElementById('app');
  const card = app.index.cards.get('c-occlusion-floater-1');
  const fastClock = { ...m.sched.STAGES.B, windowScale: 0.01 }; // 30 ms window
  let result = null;
  m.mountCard(host, { card, index: app.index, stage: fastClock, settings: app.settings, scheduler: app.scheduler, onDone: (r) => (result = r) });
  assert.ok([...host.querySelectorAll('.option')].every((b) => b.disabled), 'options locked before play');
  assert.equal(host.querySelector('.stage .play'), null, 'Play is not drawn over the court');
  const play = host.querySelector('.court .motion .play');
  play.click(); // reduced motion in this test: freezes immediately
  assert.ok(play.hidden && host.querySelector('.motion').hidden, 'Play goes away once pressed');
  assert.ok([...host.querySelectorAll('.option')].every((b) => !b.disabled), 'options unlocked at the freeze');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(host.querySelector('.verdict').textContent, 'Time ran out');
  assert.ok(!host.querySelector('.motion').hidden);
  assert.equal(host.querySelector('.motion .replay').textContent, 'Watch again', 'Watch again takes the place of Play');
  assert.equal(host.querySelector('.motion .play'), null);
  assert.equal(host.querySelector('.stage button'), null, 'no button is drawn over the court, the view toggle included');
  host.querySelector('.rating.suggested').click();
  assert.equal(result.timedOut, true);
  assert.equal(result.rating, 1);
});

test('timed cards freeze earlier as they mature, and the time-to-choose setting stretches only the clock', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const host = document.getElementById('app');
  const card = app.index.cards.get('c-occlusion-floater-1');
  const mount = (stage, settings = app.settings) => m.mountCard(host, { card, index: app.index, stage, settings, scheduler: app.scheduler, onDone: () => {} });
  const a = mount(m.sched.STAGES.A);
  assert.equal(a.freezeAt, 2330, 'stage A freezes as authored');
  assert.deepEqual(a.clock, { windowMs: null, designWindowMs: null }, 'no clock on new cards');
  assert.equal(host.querySelector('.timed-hint').textContent, 'Read the question and the choices, then press Play.');
  a.destroy();
  const c = mount(m.sched.STAGES.C);
  assert.equal(c.freezeAt, 2080, 'stage C freezes 250 ms earlier');
  assert.deepEqual(c.clock, { windowMs: 2550, designWindowMs: 2550 });
  c.destroy();
  const stretched = mount(m.sched.STAGES.B, { ...app.settings, chooseTimeScale: 2 });
  assert.deepEqual(stretched.clock, { windowMs: 8000, designWindowMs: 4000 }, 'the clock doubles, the rating window does not');
  assert.equal(host.querySelector('.timed-hint strong').textContent, '8.0 seconds', 'the time to choose stands out');
  stretched.destroy();
});

test('a timed card reveals the moment of contact, not the starting setup', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const host = document.getElementById('app');
  const card = app.index.cards.get('c-occlusion-floater-1');
  const scene = app.index.scenes.get(card.scene_id);
  const api = m.mountCard(host, { card, index: app.index, stage: m.sched.STAGES.A, settings: app.settings, scheduler: app.scheduler, onDone: () => {} });
  const opp2x = () => api.frame().players.find((p) => p.id === 'opp2').x;
  assert.equal(opp2x(), 15, 'before Play, the starting setup');
  host.querySelector('.court .motion .play').click(); // reduced motion in this test: freezes at once
  [...host.querySelectorAll('.option')].find((b) => card.options.find((o) => o.id === b.dataset.id)?.correct).click();
  assert.ok(Math.abs(opp2x() - 14.2) < 0.01, 'the opponent stays where the lead-in moved him');
  assert.deepEqual(api.frame().reveal, scene.answer_overlay, 'the answer shows');
  const last = scene.timeline.segments.at(-1).to;
  assert.deepEqual(api.frame().ball.pos.map((v) => Math.round(v * 10) / 10), [last.x, last.y, Math.round((last.z_in / 12) * 10) / 10], 'the ball sits at contact');
  host.querySelector('.motion .replay').click(); // Watch again: reduced motion runs to the end at once
  assert.equal(api.frame().ball.answer, true, 'the answer shot has flown');
  assert.ok(Math.abs(opp2x() - 14.2) < 0.01, 'and the players are still where the lead-in left them');
  api.destroy();
});

test('Play scrolls the card to the top of the screen, and Watch again scrolls the court into view', { skip }, async () => {
  // The stylesheet keeps both a little below a phone's status bar (styles.test.mjs).
  const w = setupDom();
  const scrolled = [];
  w.HTMLElement.prototype.scrollIntoView = function (o) {
    scrolled.push([['.card-view', '.court'].find((s) => this.matches(s)) ?? this.className, o?.block]);
  };
  const m = await modules();
  const app = makeApp(m);
  const host = document.getElementById('app');
  const card = app.index.cards.get('c-occlusion-floater-1');
  const api = m.mountCard(host, { card, index: app.index, stage: m.sched.STAGES.A, settings: app.settings, scheduler: app.scheduler, onDone: () => {} });
  host.querySelector('.court .motion .play').click();
  assert.deepEqual(scrolled, [['.card-view', 'start']]);
  host.querySelector('.option').click();
  host.querySelector('.motion .replay').click();
  assert.deepEqual(scrolled, [['.card-view', 'start'], ['.court', 'nearest']]);
  api.destroy();
});

function answerUntilSummary(root, app, max = 60) {
  for (let guard = 0; guard < max && !root.querySelector('.summary'); guard++) {
    root.querySelector('.play:not([hidden])')?.click(); // timed card: reduced motion freezes at once
    const prompt = root.querySelector('.prompt').textContent;
    const card = [...app.index.cards.values()].find((c) => c.prompt === prompt);
    const right = [...root.querySelectorAll('.option')].find((b) => card.options?.find((o) => o.id === b.dataset.id)?.correct);
    if (right) right.click();
    else root.querySelector('.side .btn.primary')?.click(); // Show answer
    root.querySelector('.rating.suggested').click();
  }
}

test('a court card opens in your view, and on a phone a new card opens in the view you last switched to', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const host = document.getElementById('app');
  const views = [];
  const mount = (id, stage, settings = app.settings) =>
    m.mountCard(host, { card: app.index.cards.get(id), index: app.index, stage, settings, scheduler: app.scheduler, onDone: () => {}, onViewChange: (v) => views.push(v) });
  // c-backhands-td-1 was written to lead with the map (preferred_view top_down).
  mount('c-backhands-td-1', m.sched.STAGES.A);
  assert.ok(host.querySelector('.hero svg.piq-fp'), 'your view first');
  const toggle = host.querySelector('.court .motion .toggle-view');
  assert.ok(toggle && !toggle.hidden, 'the toggle sits under the picture');
  assert.equal(toggle.textContent, 'Top-down');
  toggle.click();
  assert.ok(host.querySelector('.hero svg.piq-td'));
  assert.deepEqual(views, ['top_down'], 'the switch is reported so it can be remembered');
  mount('c-dink-fp-1', m.sched.STAGES.A, { ...app.settings, courtView: 'top_down' });
  assert.ok(host.querySelector('.hero svg.piq-td'), 'the next new card opens in the view you chose');
  mount('c-dink-fp-1', m.sched.STAGES.B, { ...app.settings, courtView: 'top_down' });
  assert.ok(host.querySelector('.hero svg.piq-fp'), 'later stages fade the map, so they open in your view');
  assert.ok(host.querySelector('.motion').hidden, 'no toggle before the answer in stage B, so the row under the picture is empty');
});

test('in a session, the view you switch to is saved with the device settings', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const root = document.getElementById('app');
  m.runSession(root, app, {});
  for (let guard = 0; guard < 20 && !root.querySelector('.motion .toggle-view:not([hidden])'); guard++) answerUntilSummary(root, app, 1);
  root.querySelector('.motion .toggle-view').click();
  assert.equal(app.settings.courtView, 'top_down');
  assert.equal(m.settings.loadSettings().courtView, 'top_down', 'kept for the next start');
});

test('the mini-map sits in the bottom corner away from where you meet the ball', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const host = document.getElementById('app');
  const mount = (mirrored) =>
    m.mountCard(host, { card: app.index.cards.get('c-dink-fp-1'), index: app.index, stage: m.sched.STAGES.B, settings: app.settings, scheduler: app.scheduler, mirrored, onDone: () => {} });
  mount(false);
  assert.ok(host.querySelector('.inset svg') && !host.querySelector('.inset').classList.contains('is-right'), 'a right-hander meets the ball on the right');
  mount(true); // the mirror image makes you a left-hander
  assert.ok(host.querySelector('.inset').classList.contains('is-right'));
});

test('a person gets the full name at the first mention on a card, top to bottom, and the first name after that', { skip }, async () => {
  setupDom();
  const m = await modules();
  const named = structuredClone(deck);
  named.speakers = { 'tanner-tomassi': { name: 'Tanner Tomassi', tier: 'touring_pro' } };
  const card = named.cards.find((c) => c.id === 'c-dink-fp-1');
  card.prompt = "Tanner's dink rule: what's the play?";
  for (const o of card.options) if (o.correct) o.feedback = 'Yes. Tanner Tomassi lets it bounce.';
  card.explanation = 'Tanner lets this one bounce.';
  const app = { ...makeApp(m), index: m.deckMod.indexDeck(named) };
  const host = document.getElementById('app');
  m.mountCard(host, { card, index: app.index, stage: m.sched.STAGES.A, settings: app.settings, scheduler: app.scheduler, onDone: () => {} });
  assert.equal(host.querySelector('.prompt').textContent, "Tanner Tomassi's dink rule: what's the play?");
  const right = [...host.querySelectorAll('.option')].find((b) => card.options.find((o) => o.id === b.dataset.id).correct);
  right.click();
  assert.equal(right.querySelector('.fb').textContent, 'Yes. Tanner lets it bounce.', 'a full name written later becomes the first name');
  assert.equal(host.querySelector('.after p:not(.verdict)').textContent, 'Tanner lets this one bounce.');
});

test('a batch runs to its summary, records progress, and offers to keep going', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const root = document.getElementById('app');
  const plan = m.planBatch(app.index, app.progress, app.settings);
  assert.equal(plan.newCount, deck.cards.length, 'no daily cap');
  m.runSession(root, app, {});
  answerUntilSummary(root, app);
  assert.ok(root.querySelector('.summary'), 'summary shown');
  assert.equal(app.progress.logs.length, deck.cards.length, 'each card once');
  assert.match(root.querySelector('.takeaway .focus-cue').textContent, /\S/);
  assert.equal(JSON.parse(localStorage.getItem(m.store.progressKey('tester'))).logs.length, deck.cards.length, 'progress persisted under the person');
  assert.equal(localStorage.getItem(m.store.STORAGE_KEY), null, 'nothing under the pre-people key');
  assert.ok(app.progress.logs.every((l) => !l.mirrored), 'as authored the first time');
  const keep = root.querySelector('.summary button.btn.primary');
  assert.match(keep.textContent, /Keep going|Practice ahead/);
  for (const e of Object.values(app.progress.cards)) e.fsrs.due = new Date(Date.now() - 1000).toISOString(); // their waits are over
  keep.click();
  assert.ok(root.querySelector('.card-view'), 'another batch started');
  answerUntilSummary(root, app);
  assert.equal(app.progress.logs.length, 2 * deck.cards.length);
  assert.ok(app.progress.logs.some((l) => l.mirrored), 'mirrorable cards come back mirrored on their second showing');
});

test('a batch keeps its size and shows each card once, even when every card is missed', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  app.settings.batchSize = 5;
  const root = document.getElementById('app');
  m.runSession(root, app, {});
  const counters = [];
  const seen = [];
  for (let guard = 0; guard < 20 && !root.querySelector('.summary'); guard++) {
    counters.push(root.querySelector('.session-bar .status').textContent);
    root.querySelector('.play:not([hidden])')?.click();
    const prompt = root.querySelector('.prompt').textContent;
    const card = [...app.index.cards.values()].find((c) => c.prompt === prompt);
    seen.push(card.id);
    const wrong = [...root.querySelectorAll('.option')].find((b) => !card.options.find((o) => o.id === b.dataset.id).correct);
    if (wrong) wrong.click();
    else root.querySelector('.side .btn.primary').click(); // Show answer
    const again = root.querySelector('.rating');
    assert.match(again.textContent, /^Again1 min$/);
    again.click();
  }
  assert.deepEqual(counters, ['Card 1 of 5', 'Card 2 of 5', 'Card 3 of 5', 'Card 4 of 5', 'Card 5 of 5'], 'the count never grows');
  assert.equal(new Set(seen).size, 5, 'no card comes back inside its own batch');
  assert.ok(root.querySelector('.summary'));
  const now = Date.now();
  const next = m.planBatch(app.index, app.progress, app.settings, { now: new Date(now) });
  assert.ok(next.items.every((x) => !seen.includes(x.card.id)), 'a miss waits out its minute before the next batch takes it');
  const later = m.planBatch(app.index, app.progress, app.settings, { now: new Date(now + 2 * 60000) });
  assert.equal(later.dueCount, 5, 'then every miss is due');
});

test('the Progress view lists topics weakest first with drills, and Home shows the last court cue', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const root = document.getElementById('app');
  m.views.renderProgress(root, app);
  assert.equal(root.querySelectorAll('table.stats tbody tr').length, 4, 'one row per topic in the sample deck');
  assert.match(root.textContent, /not enough clocked reviews/);
  assert.equal(root.querySelectorAll('.drill').length, 1);
  assert.match(root.querySelector('.drill').textContent, /not seen yet/);
  assert.ok(root.querySelector('.topbar a[href="#/progress"]'), 'the topbar links to Progress');
  m.runSession(root, app, {});
  answerUntilSummary(root, app);
  const cue = root.querySelector('.takeaway .focus-cue').textContent;
  assert.equal(app.progress.settings.last_cue.text, cue, 'the summary cue is stored');
  assert.ok(app.progress.settings.updated_at > '2026', 'and the settings timestamp moves, so sync keeps the newest');
  m.views.renderHome(root, app);
  assert.equal(root.querySelector('.takeaway .focus-cue').textContent, cue, 'Home shows the cue');
  m.views.renderProgress(root, app);
  assert.doesNotMatch(root.querySelector('.drill').textContent, /not seen yet/, 'after a batch the drill reports retention');
  assert.ok(root.querySelector('table.stats tbody tr td').textContent.length > 0);
});

test('closing after answering but before rating loses nothing', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const root = document.getElementById('app');
  m.runSession(root, app, {});
  for (let guard = 0; guard < 10 && !root.querySelector('.option'); guard++) {
    root.querySelector('.side .btn.primary').click();
    root.querySelector('.rating.suggested').click();
  }
  root.querySelector('.play:not([hidden])')?.click();
  root.querySelectorAll('.option')[0].click(); // answered, not rated: the app "closes" here
  const before = app.progress.logs.length;
  const reopened = { ...app, progress: m.store.loadProgress(localStorage, 'tester') };
  assert.equal(reopened.progress.logs.length, before);
  assert.equal(m.finalizePending(reopened), true);
  assert.equal(reopened.progress.logs.length, before + 1);
  assert.equal(reopened.progress.logs.at(-1).auto_rated, true);
});

const clickLink = (root, text) => {
  const a = [...root.querySelectorAll('a')].find((x) => x.textContent === text);
  assert.ok(a, `a link "${text}"`);
  a.click();
};
const buttonsIn = (el) => [...el.querySelectorAll('button')].map((b) => b.textContent);
const statusOf = (root) => root.querySelector('main [role="status"]');
const submitForm = (root, values) => {
  for (const [name, value] of Object.entries(values)) root.querySelector(`input[name="${name}"]`).value = value;
  root.querySelector('main form').dispatchEvent(new window.Event('submit', { cancelable: true }));
};
// The error shown under a sign-in field, or null.
const fieldOf = (root, name) => root.querySelector(`input[name="${name}"]`).closest('label');
const errorUnder = (root, name) => {
  const el = fieldOf(root, name).querySelector('.error');
  return el && !el.hidden ? el : null;
};
// Exactly one field shows an error: this one, with that message, right under the
// field and in place of its hint, with the field marked invalid. The line under
// the buttons holds nothing.
function assertOnlyError(root, name, message) {
  for (const input of root.querySelectorAll('main form input')) {
    const shown = errorUnder(root, input.name);
    if (input.name === name) {
      assert.equal(shown?.textContent, message, `"${message}" sits under ${name}`);
      assert.equal(shown.previousElementSibling, input, 'right under the field');
      assert.equal(input.getAttribute('aria-invalid'), 'true');
      const hint = [...fieldOf(root, name).querySelectorAll('small')].find((s) => !s.classList.contains('error'));
      assert.ok(!hint || hint.hidden, "the error takes the hint's place");
    } else {
      assert.equal(shown, null, `no error under ${input.name}`);
      assert.notEqual(input.getAttribute('aria-invalid'), 'true', `${input.name} is not marked invalid`);
      const hint = [...fieldOf(root, input.name).querySelectorAll('small')].find((s) => !s.classList.contains('error'));
      assert.ok(!hint || !hint.hidden, `the hint under ${input.name} stays`);
    }
  }
  assert.equal(statusOf(root).textContent, '');
  assert.ok(!statusOf(root).classList.contains('error'));
}
const FORGOT = 'Ask Jeremy to reset your password. Once he has, create your account again with the same name, and your progress is kept.';

test('the first screen is Sign in, with Create an account and Forgot your password, and no way in without an account', { skip }, async () => {
  setupDom();
  const m = await modules();
  const root = document.getElementById('app');
  const app = { settings: { ...m.settings.DEFAULT_SETTINGS }, scheduler: m.sched.makeScheduler({ enableFuzz: false }), people: m.people.loadPeople(), person: null, progress: null, index: null };
  m.views.renderSignIn(root, app, { onDone: () => assert.fail('nobody signed in') });
  assert.equal(root.querySelector('h1').textContent, 'Sign in');
  assert.deepEqual(
    [...root.querySelectorAll('main input')].map((i) => [i.name, i.type, i.getAttribute('autocomplete')]),
    [
      ['username', 'text', 'username'],
      ['password', 'password', 'current-password'],
    ],
  );
  assert.equal(root.querySelector('input[name="username"]').getAttribute('autocapitalize'), 'words');
  assert.match(root.textContent, /Your name is fine, for example Mary Ann\. Use the same one on every device\./);
  assert.deepEqual(buttonsIn(root.querySelector('main')), ['Sign in'], 'no Cancel, and no way to start without an account');
  assert.deepEqual(
    [...root.querySelectorAll('main a')].map((a) => a.textContent),
    ['Create an account', 'Forgot your password?'],
  );
  const forgotLine = () => [...root.querySelectorAll('main p')].find((p) => p.textContent === FORGOT);
  assert.ok(!forgotLine() || forgotLine().hidden, 'the reset line waits for its link');
  clickLink(root, 'Forgot your password?');
  assert.equal(forgotLine().hidden, false);

  root.querySelector('input[name="username"]').value = 'Mary Ann';
  clickLink(root, 'Create an account');
  assert.equal(root.querySelector('h1').textContent, 'Create an account');
  assert.deepEqual(
    [...root.querySelectorAll('main input')].map((i) => i.name),
    ['username', 'password', 'familyCode'],
  );
  assert.ok(![...root.querySelectorAll('input')].some((i) => i.type === 'email' || /mail/i.test(i.name)), 'no email field');
  assert.equal(root.querySelector('input[name="username"]').value, 'Mary Ann', 'what was typed stays');
  assert.equal(root.querySelector('input[name="password"]').getAttribute('autocomplete'), 'new-password');
  assert.equal(root.querySelector('input[name="familyCode"]').getAttribute('autocapitalize'), 'off');
  assert.match(root.textContent, /At least 8 characters\./);
  assert.match(root.textContent, /Jeremy gives this to the family\./);
  assert.deepEqual(buttonsIn(root.querySelector('main')), ['Create account']);
  clickLink(root, 'Sign in instead');
  assert.equal(root.querySelector('h1').textContent, 'Sign in');
  assert.equal(root.querySelector('input[name="username"]').value, 'Mary Ann');
  assert.equal(app.person, null, 'still nobody');
});

test('signing in on the first screen through the Worker makes the person current and takes over the record kept before people existed', { skip }, async () => {
  setupDom();
  const m = await modules();
  const { fakeGitHub } = await import('./fake-github.mjs');
  const realFetch = globalThis.fetch;
  const gh = fakeGitHub({ 'deck/deck.json': JSON.stringify(deck) });
  const worker = await useWorker(gh);
  try {
    await worker.account.createAccount({ id: 'mary-ann', name: 'Mary Ann', password: 'mary ann password', familyCode: 'Pickle Court Forever' });
    const root = document.getElementById('app');
    const old = m.store.emptyProgress('old-device-1', 'Phone');
    localStorage.setItem(m.store.STORAGE_KEY, JSON.stringify(old));
    const app = { settings: { ...m.settings.DEFAULT_SETTINGS }, scheduler: m.sched.makeScheduler({ enableFuzz: false }), people: m.people.loadPeople(), person: null, progress: null, index: null, deckSource: null, deckError: null, sync: {} };
    let done = null;
    m.views.renderSignIn(root, app, { migrating: m.people.hasLegacyProgress(), onDone: (p) => (done = p) });
    assert.match(root.textContent, /Court Sense now keeps a separate record for each person\. The reviews already on this device go to the account you sign in to\./);
    for (const [username, password, field, message] of [
      ['!!!', 'long enough', 'username', 'Type a name with at least one plain letter or digit.'],
      ['Mary Ann', 'short', 'password', 'Use at least 8 characters.'],
      ['Mary Ann', 'not her password', 'password', 'That password is not right.'],
      ['Mary Anne', 'mary ann password', 'username', 'No account with that name yet. Check the spelling, or create an account.'],
    ]) {
      submitForm(root, { username, password });
      await until(() => errorUnder(root, field)?.textContent === message, message, 10000);
      assertOnlyError(root, field, message);
      assert.equal(done, null);
    }
    submitForm(root, { username: 'Mary Ann', password: 'mary ann password' });
    await until(() => done, 'the sign-in', 10000);
    assert.equal(done.id, 'mary-ann');
    assert.equal(app.person.name, 'Mary Ann');
    assert.equal(app.progress.person_id, 'mary-ann');
    assert.equal(app.progress.device_id, 'old-device-1', 'the old record was adopted, device id included');
    assert.equal(localStorage.getItem(m.store.STORAGE_KEY), null);
    assert.equal(m.people.loadPeople().current, 'mary-ann');
    assert.ok(worker.account.sessionFor('mary-ann'), 'the session is kept on the device');
    assert.equal(app.deckSource, 'github', 'the sync that ends the sign-in loaded the deck');
    assert.equal(app.index.cards.size, deck.cards.length);
    assert.ok(gh.store.has('progress/mary-ann/old-device-1.json'), 'and uploaded the adopted record');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Create an account: each mistake shows in red under its own field, and an error of no field stays under the buttons', { skip }, async () => {
  setupDom();
  const m = await modules();
  const { fakeGitHub } = await import('./fake-github.mjs');
  const realFetch = globalThis.fetch;
  const gh = fakeGitHub({ 'deck/deck.json': JSON.stringify(deck) });
  let worker = await useWorker(gh);
  try {
    await worker.account.createAccount({ id: 'mary-ann', name: 'Mary Ann', password: 'mary ann password', familyCode: 'Pickle Court Forever' });
    const root = document.getElementById('app');
    const app = { settings: { ...m.settings.DEFAULT_SETTINGS }, scheduler: m.sched.makeScheduler({ enableFuzz: false }), people: m.people.loadPeople(), person: null, progress: null, index: null, deckSource: null, deckError: null, sync: {} };
    let done = null;
    m.views.renderSignIn(root, app, { mode: 'create', onDone: (p) => (done = p) });
    const right = { username: 'Ben', password: 'ben password 1', familyCode: 'Pickle Court Forever' };
    for (const [values, field, message] of [
      [{ ...right, password: 'short' }, 'password', 'Use at least 8 characters.'],
      [{ ...right, familyCode: 'pickle court' }, 'familyCode', 'That family code is not right.'],
      [{ ...right, username: 'Mary Ann' }, 'username', 'There is already an account with that name. Sign in instead.'],
      [{ ...right, username: '???' }, 'username', 'Type a name with at least one plain letter or digit.'],
    ]) {
      submitForm(root, values);
      await until(() => errorUnder(root, field)?.textContent === message, message, 10000);
      assertOnlyError(root, field, message);
      assert.equal(done, null);
    }

    // No connection: no field is at fault, so the line under the buttons says so, in red.
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    submitForm(root, right);
    await until(() => /^Could not reach/.test(statusOf(root).textContent), 'the connection message', 10000);
    assert.ok(statusOf(root).classList.contains('error'), 'in red');
    for (const name of Object.keys(right)) assert.equal(errorUnder(root, name), null, `the earlier error under ${name} is gone`);

    // The next try starts clean: the progress line is not red.
    worker = await useWorker(gh);
    submitForm(root, right);
    assert.equal(statusOf(root).textContent, 'Signing in...');
    assert.ok(!statusOf(root).classList.contains('error'));
    await until(() => done, 'the new account', 10000);
    assert.equal(done.id, 'ben');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the sign-in screen for someone already on the device fills in their name in both modes, and Cancel goes back', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const root = document.getElementById('app');
  location.hash = '#/signin/tester';
  m.views.renderSignInPage(root, app, 'tester');
  assert.equal(root.querySelector('input[name="username"]').value, 'Tester');
  clickLink(root, 'Create an account');
  assert.equal(root.querySelector('input[name="username"]').value, 'Tester', 'also when the password was reset and the account is made again');
  assert.deepEqual(buttonsIn(root.querySelector('main')), ['Create account', 'Cancel']);
  [...root.querySelectorAll('main button')].find((b) => b.textContent === 'Cancel').click();
  assert.equal(location.hash, '#/settings');
  m.views.renderSignInPage(root, app);
  assert.equal(root.querySelector('input[name="username"]').value, '', 'adding someone new starts blank');
});

test('Settings: the Account section says who is signed in and asks for no repository or token', { skip }, async () => {
  setupDom();
  const m = await modules();
  const account = await import('../app/src/store/account.js');
  const app = makeApp(m);
  const root = document.getElementById('app');
  m.views.renderSettings(root, app);
  for (const name of ['owner', 'repo', 'branch', 'deckPath', 'progressDir', 'token']) assert.equal(root.querySelector(`input[name="${name}"]`), null, `no ${name} field`);
  const legends = [...root.querySelectorAll('legend')].map((l) => l.textContent);
  assert.ok(legends.includes('Account') && !legends.includes('Data repository'), legends.join(', '));
  const accountSet = [...root.querySelectorAll('fieldset')].find((f) => f.querySelector('legend').textContent === 'Account');
  assert.match(accountSet.textContent, /Tester is not signed in, so nothing syncs\./);
  const signIn = [...accountSet.querySelectorAll('a')].find((a) => a.textContent === 'Sign in');
  assert.equal(signIn.getAttribute('href'), '#/signin/tester');
  assert.ok(accountSet.querySelector('input[name="deviceLabel"]') && accountSet.querySelector('input[name="autoSync"]'), 'the device name and the sync checkbox stay');
  const status = root.querySelector('form [role="status"]');
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'Sync now').click();
  await until(() => status.textContent === 'Sign in first.', 'the sign-in reminder');

  account.saveSession('tester', `v1.tester.${'A'.repeat(43)}`);
  m.views.renderSettings(root, app);
  const signedIn = [...root.querySelectorAll('fieldset')].find((f) => f.querySelector('legend').textContent === 'Account');
  assert.match(signedIn.textContent, /Signed in as Tester\. Your progress syncs to your account\./);
  assert.ok(![...signedIn.querySelectorAll('a')].some((a) => a.textContent === 'Sign in'));
  assert.ok(!/Sign out/.test(root.textContent), 'there is no Sign out');
  assert.ok(buttonsIn(root).includes('Save settings') && buttonsIn(root).includes('Sync now'));
});

test('people on a device: adding one through sign-in switches to them, each keeps their own progress, and Home says who is playing', { skip }, async () => {
  setupDom();
  globalThis.confirm = () => true;
  const m = await modules();
  const { fakeGitHub } = await import('./fake-github.mjs');
  const app = makeApp(m);
  const realFetch = globalThis.fetch;
  const gh = fakeGitHub({ 'deck/deck.json': JSON.stringify(deck) });
  const worker = await useWorker(gh);
  await worker.signIn('tester');
  let synced = 0;
  app.autoSync = () => synced++;
  try {
    const root = document.getElementById('app');
    m.runSession(root, app, {});
    answerUntilSummary(root, app);
    const testerLogs = app.progress.logs.length;
    assert.ok(testerLogs > 0);
    m.views.renderHome(root, app);
    assert.equal(root.querySelector('.who').textContent, 'Playing as Tester. Add a person.');
    m.views.renderSettings(root, app);
    assert.match(root.textContent, /Tester: \d+ reviews recorded/);
    assert.match(root.textContent, /Each person signs in with their own account\. Adding someone switches to them\./);
    const list = root.querySelector('.people');
    assert.equal(list.querySelectorAll('li').length, 1);
    assert.equal(list.querySelector('li').textContent, 'Testerplaying now');
    assert.equal(list.querySelectorAll('button').length, 0, 'no Remove and no Sign out for the person using the device');
    assert.equal(root.querySelector('input[name="newPerson"]'), null, 'no name-only add');
    const add = [...root.querySelectorAll('a')].find((a) => a.textContent === 'Add a person');
    assert.equal(add.getAttribute('href'), '#/signin');

    // An answer Anna gave on this device earlier and never rated.
    const card = deck.cards[0];
    m.store.savePending({ person_id: 'anna', card_id: card.id, rating: m.sched.Rating.Good, correct: true, reviewed_at: '2026-11-02T12:00:00.000Z' });
    location.hash = '#/signin';
    m.views.renderSignInPage(root, app);
    assert.ok(buttonsIn(root.querySelector('main')).includes('Cancel'), 'adding someone can be cancelled');
    clickLink(root, 'Create an account');
    submitForm(root, { username: 'Anna', password: 'anna password 1', familyCode: 'pickle court forever' });
    await until(() => location.hash === '#/', 'the sign-in to finish', 10000);
    assert.equal(app.person.id, 'anna');
    assert.equal(app.progress.person_id, 'anna');
    assert.deepEqual(
      app.progress.logs.map((l) => l.card_id),
      [card.id],
      'Anna has only her own answer, recorded from where she left it unrated',
    );
    assert.equal(app.progress.device_id, 'test-device', 'on the same device');
    assert.equal(gh.calls.filter((c) => c.method === 'PUT' && c.url.includes('/progress/anna/')).length, 1, 'her folder syncs once');
    assert.equal(synced, 0, 'the sign-in did the sync');
    assert.equal(m.planBatch(app.index, app.progress, app.settings).newCount, deck.cards.length - 1, 'every other card is new to Anna');
    m.views.renderHome(root, app);
    assert.equal(root.querySelector('.who').textContent, 'Playing as Anna. Switch to Tester.');
    root.querySelector('.who a').click();
    assert.equal(app.person.id, 'tester');
    assert.equal(app.progress.logs.length, testerLogs, 'Tester’s reviews are intact');
    assert.equal(root.querySelector('.who').textContent, 'Playing as Tester. Switch to Anna.');
    assert.equal(m.store.loadProgress(localStorage, 'anna').logs.length, 1);
    m.views.renderSettings(root, app);
    const anna = [...root.querySelectorAll('.people li')].find((li) => li.textContent.startsWith('Anna'));
    assert.deepEqual(buttonsIn(anna), ['Switch', 'Remove'], 'Remove is offered for someone else, and there is no Sign out');
    anna.querySelector('.btn.quiet').click();
    assert.deepEqual(
      app.people.people.map((p) => p.id),
      ['tester'],
    );
    assert.equal(localStorage.getItem(m.store.progressKey('anna')), null, 'her record on this device went with her');
    assert.equal(worker.account.sessionFor('anna'), null, 'and her session');
    assert.ok(worker.account.sessionFor('tester'), 'Tester stays signed in');
    assert.ok(gh.store.has('progress/anna/test-device.json'), 'the copy in her account stays');
    assert.equal(root.querySelectorAll('.people li').length, 1);
    assert.match(root.querySelector('.people').closest('fieldset').textContent, /Anna was removed/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('home, cards, preview and settings render; settings save', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const root = document.getElementById('app');
  m.views.renderHome(root, app);
  assert.match(root.textContent, /Start/);
  assert.match(root.textContent, /batches of 10/);
  assert.match(root.textContent, /This is the sample deck: a few cards written to exercise the app\. Sign in to load the real deck\./);
  assert.match(root.textContent, /Not signed in, so nothing syncs\. Open Settings to sign in\./);
  app.deckSource = 'cache';
  app.deckError = 'Reading deck/deck.json failed (502).';
  const account = await import('../app/src/store/account.js');
  account.saveSession('tester', `v1.tester.${'A'.repeat(43)}`);
  m.views.renderHome(root, app);
  assert.match(root.textContent, /Your deck could not be loaded, so the copy saved on this device is in use\. Reading deck\/deck\.json failed \(502\)\./);
  assert.ok(!/from GitHub|Not signed in/.test(root.textContent), 'signed in, and no mention of GitHub');
  app.deckSource = 'sample';
  app.deckError = null;
  m.views.renderCards(root, app);
  assert.equal(root.querySelectorAll('.card-list li').length, deck.cards.length);
  const p = m.views.renderPreview(root, app, 'c-backhands-td-1', 'C');
  assert.ok(root.querySelector('.stage-C'));
  p.destroy();
  m.views.renderSettings(root, app);
  assert.match(root.textContent, /0 reviews recorded, [0-9]+ KB on this device/, 'progress size readout');
  assert.equal(root.querySelector('input[name="newPerDay"]').value, '', 'no limit by default');
  root.querySelector('input[name="newPerDay"]').value = '8';
  root.querySelector('input[name="batchSize"]').value = '15';
  root.querySelector('select[name="chooseTimeScale"]').value = '1.5';
  root.querySelector('input[name="deviceLabel"]').value = 'Phone';
  root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(app.settings.newPerDay, 8);
  assert.equal(app.settings.batchSize, 15);
  assert.equal(app.settings.chooseTimeScale, 1.5);
  root.querySelector('input[name="newPerDay"]').value = '';
  root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(app.settings.newPerDay, null, 'blank means no limit');
  assert.equal(app.settings.deviceLabel, 'Phone');
  assert.equal(app.progress.device_label, 'Phone');
  assert.equal(localStorage.getItem('piq.sync.v1'), null, 'no repository settings are written');
});

// Waits for an async click handler: polls until the condition holds.
async function until(cond, what, ms = 1000) {
  for (let i = 0; i < ms / 5 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(cond(), `timed out waiting for ${what}`);
}

// The sign-in Worker in front of a fake GitHub (or anything with a fetchImpl),
// installed as the page's fetch, and a session for the person on the device.
const WORKER_SECRET = 'test-session-secret-0123456789';
const workerEnv = {
  GITHUB_TOKEN: 'github_pat_worker',
  SESSION_SECRET: WORKER_SECRET,
  FAMILY_CODE: 'Pickle Court Forever',
  DATA_REPO: 'me/piq-data',
  BRANCH: 'main',
  ALLOWED_ORIGINS: 'https://jeremys-apps.github.io',
};
async function useWorker(upstream) {
  const [{ handle }, { signSession }, account] = await Promise.all([import('../server/src/worker.js'), import('../server/src/auth.js'), import('../app/src/store/account.js')]);
  globalThis.fetch = async (url, init = {}) => {
    assert.ok(String(url).startsWith(`${account.ACCOUNT_API}/`), `the page calls only the Worker, not ${url}`);
    return handle(new Request(url, init), workerEnv, { fetchImpl: upstream.fetchImpl });
  };
  return { account, signIn: async (id) => account.saveSession(id, await signSession(WORKER_SECRET, id)) };
}

test('Settings, Sync now: the status line reports the reviews and the deck the sync brought', { skip }, async () => {
  setupDom();
  const m = await modules();
  const { fakeGitHub } = await import('./fake-github.mjs');
  const app = makeApp(m);
  const other = m.store.emptyProgress('laptop-22222', 'Laptop', 'tester');
  const { state } = app.scheduler.review(app.scheduler.newState(new Date('2026-11-01T12:00:00.000Z')), m.sched.Rating.Good, new Date('2026-11-01T12:00:00.000Z'));
  m.store.recordReview(other, 'c-backhands-td-1', state, { rating: m.sched.Rating.Good, reviewed_at: '2026-11-01T12:00:00.000Z' });
  const gh = fakeGitHub({ 'deck/deck.json': JSON.stringify(deck), 'progress/tester/laptop-22222.json': JSON.stringify(other) });
  const realFetch = globalThis.fetch;
  const worker = await useWorker(gh);
  await worker.signIn('tester');
  try {
    const root = document.getElementById('app');
    m.views.renderSettings(root, app);
    const status = root.querySelector('form [role="status"]');
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Sync now').click();
    await until(() => /^Synced/.test(status.textContent), 'the sync to finish');
    assert.equal(status.textContent, `Synced. 1 reviews across your devices; the deck has ${deck.cards.length} cards.`);
    assert.equal(app.deckSource, 'github');
    assert.ok(gh.store.has('progress/tester/test-device.json'), "this device's file was written");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Settings, Sync now: a failed sync shows the reason in the status line', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const realFetch = globalThis.fetch;
  // GitHub refuses the Worker's own token: the Worker answers 502.
  const worker = await useWorker({ fetchImpl: async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }) });
  await worker.signIn('tester');
  try {
    const root = document.getElementById('app');
    m.views.renderSettings(root, app);
    const status = root.querySelector('form [role="status"]');
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Sync now').click();
    await until(() => /failed/.test(status.textContent), 'the error');
    assert.match(status.textContent, /\(502\)\. Sync is not working on the server\. Your progress is safe on this device\./);
    assert.ok(worker.account.sessionFor('tester'), 'a server failure signs nobody out');
    assert.equal(app.deckSource, 'sample', 'the deck in use is unchanged');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Settings, Sync now: a refused session turns the Account section to Sign in at once and keeps the unsynced review', { skip }, async () => {
  setupDom();
  const m = await modules();
  const { fakeGitHub } = await import('./fake-github.mjs');
  const { signSession } = await import('../server/src/auth.js');
  const app = makeApp(m);
  const at = new Date('2026-11-04T07:10:00.000Z');
  const { state } = app.scheduler.review(app.scheduler.newState(at), m.sched.Rating.Hard, at);
  m.store.recordReview(app.progress, 'c-backhands-td-1', state, { rating: m.sched.Rating.Hard, reviewed_at: at.toISOString() });
  const gh = fakeGitHub({ 'deck/deck.json': JSON.stringify(deck) });
  const realFetch = globalThis.fetch;
  const worker = await useWorker(gh);
  // Signed with the Worker's old key, as every session is once SESSION_SECRET changes.
  worker.account.saveSession('tester', await signSession('the-old-session-secret-0123456789', 'tester'));
  try {
    const root = document.getElementById('app');
    m.views.renderSettings(root, app);
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Sync now').click();
    const status = () => root.querySelector('form [role="status"]').textContent;
    await until(() => /signed out/.test(status()), 'the signed-out message');
    assert.equal(status(), 'You are signed out. Sign in again in Settings.');
    const accountSet = [...root.querySelectorAll('fieldset')].find((f) => f.querySelector('legend').textContent === 'Account');
    assert.match(accountSet.textContent, /Tester is not signed in, so nothing syncs\./, 'the page stops saying Tester is signed in');
    const signIn = [...accountSet.querySelectorAll('a')].find((a) => a.textContent === 'Sign in');
    assert.equal(signIn?.getAttribute('href'), '#/signin/tester', 'Sign in is right there');
    assert.ok(!worker.account.sessionFor('tester'), 'the refused session is forgotten');
    assert.equal(app.progress.logs.length, 1, 'the review made since the last sync is kept');
    assert.ok(!gh.store.has('progress/tester/test-device.json'), 'nothing was written');
  } finally {
    globalThis.fetch = realFetch;
  }
});
