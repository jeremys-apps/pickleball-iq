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
  const [{ mountCard }, { runSession, planBatch, finalizePending }, views, sched, store, deckMod, settings] = await Promise.all([
    import('../app/src/ui/card-view.js'),
    import('../app/src/ui/session.js'),
    import('../app/src/ui/views.js'),
    import('../app/src/srs/scheduler.js'),
    import('../app/src/store/progress.js'),
    import('../app/src/deck.js'),
    import('../app/src/store/settings.js'),
  ]);
  return { mountCard, runSession, planBatch, finalizePending, views, sched, store, deckMod, settings };
}

function makeApp(m) {
  return {
    settings: { ...m.settings.DEFAULT_SETTINGS },
    scheduler: m.sched.makeScheduler({ enableFuzz: false }),
    progress: m.store.emptyProgress('test-device'),
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
  assert.match(host.querySelector('.source').textContent, /Sample content/);
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

test('a mirrored card says so after the answer and records it', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const host = document.getElementById('app');
  let result = null;
  m.mountCard(host, { card: app.index.cards.get('c-floater-fp-1'), index: app.index, stage: m.sched.STAGES.B, settings: app.settings, scheduler: app.scheduler, mirrored: true, onDone: (r) => (result = r) });
  host.querySelector('.option').click();
  assert.match(host.querySelector('.after').textContent, /Mirrored this time/);
  host.querySelector('.rating.suggested').click();
  assert.equal(result.mirrored, true);
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
  assert.match(host.querySelector('.claude-note').textContent, /Claude's note/);
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
  host.querySelector('.play').click(); // reduced motion in this test: freezes immediately
  assert.ok([...host.querySelectorAll('.option')].every((b) => !b.disabled), 'options unlocked at the freeze');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(host.querySelector('.verdict').textContent, 'Time ran out');
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
  a.destroy();
  const c = mount(m.sched.STAGES.C);
  assert.equal(c.freezeAt, 2080, 'stage C freezes 250 ms earlier');
  assert.deepEqual(c.clock, { windowMs: 2550, designWindowMs: 2550 });
  c.destroy();
  const stretched = mount(m.sched.STAGES.B, { ...app.settings, chooseTimeScale: 2 });
  assert.deepEqual(stretched.clock, { windowMs: 8000, designWindowMs: 4000 }, 'the clock doubles, the rating window does not');
  assert.match(host.querySelector('.timed-hint').textContent, /8\.0 seconds/);
  stretched.destroy();
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
  assert.ok(app.progress.logs.length >= deck.cards.length);
  assert.match(root.querySelector('.takeaway .focus-cue').textContent, /\S/);
  assert.ok(JSON.parse(localStorage.getItem(m.store.STORAGE_KEY)).logs.length >= deck.cards.length, 'progress persisted');
  assert.ok(app.progress.logs.some((l) => l.mirrored), 'mirrorable cards come back mirrored on their second showing');
  assert.ok(app.progress.logs.some((l) => !l.mirrored), 'and as authored the first time');
  const keep = root.querySelector('.summary button.btn.primary');
  assert.match(keep.textContent, /Keep going|Practice ahead/);
  keep.click();
  assert.ok(root.querySelector('.card-view'), 'another batch started');
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
  const reopened = { ...app, progress: m.store.loadProgress() };
  assert.equal(reopened.progress.logs.length, before);
  assert.equal(m.finalizePending(reopened), true);
  assert.equal(reopened.progress.logs.length, before + 1);
  assert.equal(reopened.progress.logs.at(-1).auto_rated, true);
});

test('home, cards, preview and settings render; settings save', { skip }, async () => {
  setupDom();
  const m = await modules();
  const app = makeApp(m);
  const root = document.getElementById('app');
  m.views.renderHome(root, app);
  assert.match(root.textContent, /Start/);
  assert.match(root.textContent, /batches of 10/);
  assert.match(root.textContent, /sample deck/);
  m.views.renderCards(root, app);
  assert.equal(root.querySelectorAll('.card-list li').length, deck.cards.length);
  const p = m.views.renderPreview(root, app, 'c-backhands-td-1', 'C');
  assert.ok(root.querySelector('.stage-C'));
  p.destroy();
  m.views.renderSettings(root, app);
  assert.equal(root.querySelector('input[name="newPerDay"]').value, '', 'no limit by default');
  root.querySelector('input[name="newPerDay"]').value = '8';
  root.querySelector('input[name="batchSize"]').value = '15';
  root.querySelector('select[name="chooseTimeScale"]').value = '1.5';
  root.querySelector('input[name="owner"]').value = 'jeremy';
  root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(app.settings.newPerDay, 8);
  assert.equal(app.settings.batchSize, 15);
  assert.equal(app.settings.chooseTimeScale, 1.5);
  root.querySelector('input[name="newPerDay"]').value = '';
  root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(app.settings.newPerDay, null, 'blank means no limit');
  assert.equal(JSON.parse(localStorage.getItem('piq.sync.v1')).owner, 'jeremy');
});
