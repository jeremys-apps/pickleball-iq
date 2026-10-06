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
  assert.equal(host.querySelector('.motion').textContent, 'Watch again', 'Watch again takes the place of Play');
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

test('the first screen asks who is playing, and the name takes over the record kept before people existed', { skip }, async () => {
  setupDom();
  const m = await modules();
  const root = document.getElementById('app');
  const old = m.store.emptyProgress('old-device-1', 'Phone');
  localStorage.setItem(m.store.STORAGE_KEY, JSON.stringify(old));
  const app = { people: m.people.loadPeople(), person: null, progress: null };
  let named = null;
  m.views.renderWelcome(root, { migrating: m.people.hasLegacyProgress(), onSubmit: (name) => (named = m.appPeople.startPerson(app, name)) });
  assert.equal(root.querySelector('h1').textContent, 'Who is this?');
  assert.match(root.textContent, /reviews already on this device/);
  const input = root.querySelector('input[name="name"]');
  input.value = '!!!';
  root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(named, null);
  assert.match(root.querySelector('[role="status"]').textContent, /plain letter or digit/);
  input.value = 'Mary Ann';
  root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(named.id, 'mary-ann');
  assert.equal(app.person.name, 'Mary Ann');
  assert.equal(app.progress.person_id, 'mary-ann');
  assert.equal(app.progress.device_id, 'old-device-1', 'the old record was adopted, device id included');
  assert.equal(localStorage.getItem(m.store.STORAGE_KEY), null);
  assert.equal(m.people.loadPeople().current, 'mary-ann');
});

test('people on a device: adding one switches to them, each keeps their own progress, and Home says who is playing', { skip }, async () => {
  setupDom();
  globalThis.confirm = () => true;
  const m = await modules();
  const app = makeApp(m);
  let synced = 0;
  app.autoSync = () => synced++;
  const root = document.getElementById('app');
  m.runSession(root, app, {});
  answerUntilSummary(root, app);
  const testerLogs = app.progress.logs.length;
  assert.ok(testerLogs > 0);
  m.views.renderHome(root, app);
  assert.equal(root.querySelector('.who').textContent, 'Playing as Tester. Add a person.');
  m.views.renderSettings(root, app);
  assert.match(root.textContent, /Tester: \d+ reviews recorded/);
  const list = root.querySelector('.people');
  assert.equal(list.querySelectorAll('li').length, 1);
  assert.equal(list.querySelector('li').textContent, 'Testerplaying now');
  root.querySelector('input[name="newPerson"]').value = 'Anna';
  list.closest('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(app.person.id, 'anna');
  assert.equal(app.progress.person_id, 'anna');
  assert.equal(app.progress.logs.length, 0, 'Anna starts fresh');
  assert.equal(app.progress.device_id, 'test-device', 'on the same device');
  assert.equal(synced, 1, 'her folder syncs');
  assert.equal(m.planBatch(app.index, app.progress, app.settings).newCount, deck.cards.length, 'every card is new to Anna');
  m.views.renderHome(root, app);
  assert.equal(root.querySelector('.who').textContent, 'Playing as Anna. Switch to Tester.');
  root.querySelector('.who a').click();
  assert.equal(app.person.id, 'tester');
  assert.equal(app.progress.logs.length, testerLogs, 'Tester’s reviews are intact');
  assert.equal(root.querySelector('.who').textContent, 'Playing as Tester. Switch to Anna.');
  assert.equal(m.store.loadProgress(localStorage, 'anna').logs.length, 0);
  m.views.renderSettings(root, app);
  const anna = [...root.querySelectorAll('.people li')].find((li) => li.textContent.startsWith('Anna'));
  assert.equal(anna.querySelector('.btn').textContent, 'Switch');
  anna.querySelector('.btn.quiet').click();
  assert.deepEqual(
    app.people.people.map((p) => p.id),
    ['tester'],
  );
  assert.equal(localStorage.getItem(m.store.progressKey('anna')), null, 'her record on this device went with her');
  assert.equal(root.querySelectorAll('.people li').length, 1);
  assert.match(root.querySelector('.people').closest('fieldset').textContent, /Anna was removed/);
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
  assert.match(root.textContent, /0 reviews recorded, [0-9]+ KB on this device/, 'progress size readout');
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
