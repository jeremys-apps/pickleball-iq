// One card: the court picture, the question, the reveal, where the advice came
// from, and the rating. Works for every card type:
//   scenario_mc     static court picture, choose a play
//   text_mc         choices without a court picture (form fixes, rules of thumb)
//   timed_decision  lead-in shots play, freeze, answer against the clock
//   why / form_cue / drill_recall   recall, then show the answer and self-rate
//
// Keyboard (laptop): 1-4 choose an option, then 1-4 rate. Enter or Space plays a
// timed card, shows an answer, or accepts the suggested rating. R replays.

import { h, isWide, formatInterval, WIDE_QUERY } from './dom.js';
import { frameFromScene, answerFrame, answerArc } from '../court/scene.js';
import { renderFirstPerson } from '../court/first-person.js';
import { renderTopDown } from '../court/top-down.js';
import { createPlayer } from '../court/playback.js';
import { mirrorScene } from '../court/mirror.js';
import { pickOptions } from '../choices.js';
import { suggestRating, Rating } from '../srs/scheduler.js';
import { sourceLines } from './provenance.js';

const RATING_LABELS = { [Rating.Again]: 'Again', [Rating.Hard]: 'Hard', [Rating.Good]: 'Good', [Rating.Easy]: 'Easy' };
// A replay has two halves: their shot comes to you (REPLAY_MS) with the answer
// hidden, a beat at contact (HOLD_MS), then your answer shot flies to its target
// (ANSWER_MS) with its path growing behind the ball.
const REPLAY_MS = 900;
const HOLD_MS = 150;
const ANSWER_MS = 1000;
const PHONE_FP = { width: 360, height: 380 };
const LAPTOP_FP = { width: 800, height: 500 };
// After an answer every aid returns, at every stage: the reveal shows what the
// read should have been, while the question itself is posed with the stage's aids.
const FULL_AIDS = Object.freeze({ path: true, shadow: true, stalk: true });

// ctx: {card, index, stage, settings, scheduler, state, onDone(result)}
// result: {rating, correct, timedOut, choice, responseMs, view}
export function mountCard(root, ctx) {
  const { card, index, stage, settings, scheduler, state, onDone } = ctx;
  const baseScene = card.scene_id ? index.scenes.get(card.scene_id) : null;
  const mirrored = !!(ctx.mirrored && baseScene);
  const scene = mirrored ? mirrorScene(baseScene) : baseScene;
  const principle = index.principles.get(card.principle_id);
  const mc = card.type === 'scenario_mc' || card.type === 'timed_decision' || card.type === 'text_mc';
  const timed = card.type === 'timed_decision' && !!scene?.timeline;
  // The choices for this showing: one correct phrasing and up to three wrong answers.
  const shown = mc ? pickOptions(card, ctx.showing ?? state?.reps ?? 0) : [];
  const cameraMode = settings.cameraMode ?? 'over_shoulder';
  const panelKind = stage.panel; // callers apply the mature-card preference
  // designWindowMs is the card's window at this stage and drives the rating
  // suggestion. windowMs is what the clock and the timeout use: the same,
  // stretched by the "Time to choose" setting, so a slower search for the
  // choice never costs a read that was made in time (N-5).
  const designWindowMs =
    timed && stage.windowScale ? Math.round((scene.timeline.response_window_ms ?? 3000) * stage.windowScale) : null;
  const windowMs = designWindowMs == null ? null : Math.round(designWindowMs * (settings.chooseTimeScale ?? 1));

  let hero = !isWide() && card.preferred_view === 'top_down' && stage.id === 'A' ? 'top_down' : 'first_person';
  let frame = scene ? frameFromScene(scene) : null;
  let player = null;
  let started = !timed;
  let optionsLive = !timed;
  let answered = false;
  let done = false;
  let suggested = Rating.Good;
  let result = null;
  let clockStart = timed ? null : performance.now();
  let timeoutId = null;
  let raf = null;

  const view = h('article', { class: `card-view is-${card.type} stage-${stage.id}${scene ? ' has-stage' : ''}` });
  const heroEl = h('div', { class: 'hero' });
  const insetEl = h('div', { class: 'inset' });
  const clockEl = h('div', { class: 'clock', hidden: true, 'aria-hidden': 'true' }, h('i'));
  const panelEl = h('div', { class: 'panel' });
  const optionsEl = h('div', { class: 'options', role: 'group', 'aria-label': 'Choices' });
  const afterEl = h('section', { class: 'after', hidden: true, 'aria-live': 'polite' });

  const toggle = h(
    'button',
    {
      class: 'btn toggle-view',
      type: 'button',
      onclick: () => {
        hero = hero === 'first_person' ? 'top_down' : 'first_person';
        draw();
      },
    },
    'Top-down',
  );
  // Play and, after the answer, the replay share one spot under the picture, so
  // neither covers the court and the replay starts with the picture in view. A
  // static card never played before the answer, so its button is not a "replay".
  const playBtn = timed ? h('button', { class: 'btn primary play', type: 'button', onclick: () => start() }, 'Play') : null;
  const replayBtn = scene ? h('button', { class: 'btn replay', type: 'button', onclick: () => replay() }, timed ? 'Watch again' : 'Watch the play') : null;
  // With reduced motion the replay skips the flights and shows the finished picture.
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionEl = h('div', { class: 'motion', hidden: !timed }, playBtn);
  const showBtn = mc ? null : h('button', { class: 'btn primary', type: 'button', onclick: () => showAnswer() }, 'Show answer');
  // Reading happens before Play; the clock covers only the choice after the freeze.
  const hint = timed
    ? h('p', { class: 'note timed-hint' }, windowMs
        ? ['Read the question and the choices first. When the picture freezes you have ', h('strong', {}, `${(windowMs / 1000).toFixed(1)} seconds`), ' to choose.']
        : 'Read the question and the choices, then press Play.')
    : null;

  function draw() {
    if (!scene) return;
    const wide = isWide();
    const fp = renderFirstPerson(frame, {
      ...(wide ? LAPTOP_FP : PHONE_FP),
      mode: cameraMode,
      aids: answered ? FULL_AIDS : stage.aids,
      ariaLabel: 'The court from your position',
    });
    const cam = fp.camera;
    if (wide || hero === 'first_person') heroEl.innerHTML = fp.svg;
    else heroEl.innerHTML = renderTopDown(frame, { variant: 'full', showBackhand: true, crop: 'auto', cropIncludesReveal: answered, camera: cam }).svg;

    const showInset = !wide && hero === 'first_person' && (panelKind || answered);
    insetEl.innerHTML = showInset ? renderTopDown(frame, { variant: 'mini', camera: cam }).svg : '';

    let panel = '';
    if (answered && scene.answer_overlay && (wide || hero === 'first_person')) {
      panel = renderTopDown(frame, { variant: 'full', showBackhand: true, crop: 'auto', camera: cam }).svg;
    } else if (wide && panelKind === 'top_down') {
      panel = renderTopDown(frame, { variant: 'full', showBackhand: true, crop: 'auto', cropIncludesReveal: false, camera: cam }).svg;
    } else if (wide && panelKind === 'mini') {
      panel = renderTopDown(frame, { variant: 'mini', camera: cam }).svg;
    }
    panelEl.innerHTML = panel;
    toggle.hidden = wide || !(stage.id === 'A' || answered);
    toggle.textContent = hero === 'first_person' ? 'Top-down' : 'Your view';
  }

  function replay() {
    courtEl.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    if (timed) player.play(0, { toEnd: true }); // its end hands over to flyAnswer
    else replayStatic();
  }

  // Their shot arrives with the answer hidden; then the answer flies.
  function replayStatic() {
    if (!scene) return;
    if (reducedMotion) return flyAnswer(frameFromScene(scene));
    animate(
      REPLAY_MS / (stage.speed || 1),
      (t) => {
        frame = frameFromScene(scene, t, { reveal: false });
        draw();
      },
      () => flyAnswer(frameFromScene(scene)),
    );
  }

  // The second half of a replay, from `base`, the frame at contact: the target
  // shows, then the ball flies your answer shot and its path grows behind it.
  // A positioning answer has no shot to fly, so the overlay simply appears.
  function flyAnswer(base) {
    if (!answerArc(scene) || reducedMotion) {
      frame = answerFrame(scene, base, 1);
      draw();
      return;
    }
    const speed = stage.speed || 1;
    animate(
      ANSWER_MS / speed,
      (k) => {
        frame = answerFrame(scene, base, k);
        draw();
      },
      null,
      HOLD_MS / speed,
    );
  }

  // Calls onStep(progress 0 to 1) on animation frames, after an optional delay, then onEnd.
  function animate(durationMs, onStep, onEnd, delayMs = 0) {
    if (raf != null) cancelAnimationFrame(raf);
    const t0 = performance.now() + delayMs;
    const step = () => {
      const t = Math.min(1, Math.max(0, (performance.now() - t0) / durationMs));
      onStep(t);
      if (t < 1) raf = requestAnimationFrame(step);
      else onEnd?.();
    };
    raf = requestAnimationFrame(step);
  }

  if (timed) {
    player = createPlayer(scene, {
      speed: stage.speed,
      freezeLeadMs: stage.freezeLeadMs ?? 0,
      onFrame: (f) => {
        frame = f;
        draw();
      },
      onFreeze: (f) => {
        // Watch again ran to the end: the answer flies from the moment of contact.
        if (answered) return flyAnswer(player.contactFrame());
        frame = f;
        draw();
        unlock();
      },
    });
    frame = player.frameAt(0);
  }

  function start() {
    if (started) return;
    started = true;
    playBtn.hidden = true;
    motionEl.hidden = true;
    if (hint) hint.hidden = true;
    view.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    player.play(0);
  }

  function unlock() {
    optionsLive = true;
    clockStart = performance.now();
    for (const b of optionsEl.querySelectorAll('button')) b.disabled = false;
    if (windowMs) {
      clockEl.hidden = false;
      const bar = clockEl.firstChild;
      bar.style.transition = 'none';
      bar.style.transform = 'scaleX(1)';
      void bar.offsetWidth;
      bar.style.transition = `transform ${windowMs}ms linear`;
      bar.style.transform = 'scaleX(0)';
      timeoutId = setTimeout(() => answer(null), windowMs);
    }
    optionsEl.querySelector('button')?.focus({ preventScroll: true });
  }

  if (mc) {
    shown.forEach((o, i) => {
      optionsEl.append(
        h(
          'button',
          { class: 'option', type: 'button', disabled: !optionsLive, dataset: { id: o.id }, onclick: () => answer(o.id) },
          h('span', { class: 'key', 'aria-hidden': 'true' }, String(i + 1)),
          h('span', { class: 'text' }, o.text),
        ),
      );
    });
  }

  function answer(choiceId) {
    if (answered || !optionsLive) return;
    answered = true;
    clearTimeout(timeoutId);
    const bar = clockEl.firstChild;
    if (bar && !clockEl.hidden) {
      const frozen = getComputedStyle(bar).transform;
      bar.style.transition = 'none';
      bar.style.transform = frozen;
    }
    const responseMs = clockStart != null ? Math.round(performance.now() - clockStart) : null;
    const chosen = shown.find((o) => o.id === choiceId);
    const correct = !!chosen?.correct;
    for (const b of optionsEl.querySelectorAll('button')) {
      const o = shown.find((x) => x.id === b.dataset.id);
      b.disabled = true;
      if (o.correct) b.classList.add('is-correct');
      if (o.id === choiceId) b.classList.add('is-chosen');
      if ((o.id === choiceId || o.correct) && o.feedback) b.append(h('span', { class: 'fb' }, o.feedback));
    }
    if (timed) {
      // The reveal shows the moment of contact: players where the lead-in moved
      // them and the shot coming to you with its bounce, not the starting setup.
      player.stop();
      frame = player.contactFrame();
    }
    view.classList.add('is-revealed');
    draw();
    suggested = suggestRating({ correct, responseMs, windowMs: designWindowMs });
    showAfter({ correct, timedOut: choiceId == null, choice: choiceId ?? null, responseMs, shown: shown.map((o) => o.id) });
  }

  function showAnswer() {
    if (answered) return;
    answered = true;
    showBtn.hidden = true;
    view.classList.add('is-revealed');
    suggested = Rating.Good;
    const responseMs = clockStart != null ? Math.round(performance.now() - clockStart) : null;
    showAfter({ correct: null, timedOut: false, choice: null, responseMs });
  }

  function showAfter(r) {
    result = r;
    const parts = [];
    if (mc) {
      const verdict = r.correct ? 'Correct' : r.timedOut ? 'Time ran out' : 'Not quite';
      parts.push(h('p', { class: `verdict ${r.correct ? 'good' : 'bad'}` }, verdict));
    } else {
      parts.push(h('p', { class: 'answer' }, card.answer));
    }
    parts.push(h('p', {}, card.explanation));
    if (card.focus_cue) parts.push(h('p', { class: 'focus-cue' }, `On court: ${card.focus_cue}`));
    // Who said it and Claude's own note, folded away under the lesson. The note
    // keeps its own box so it is never read as a pro's words.
    const sources = sourceLines(principle, index).map((s) =>
      h('p', { class: 'source' }, s.text, s.url ? [' ', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, 'Episode')] : null),
    );
    const note = card.claude_note ?? principle?.claude_note;
    if (sources.length || note) {
      // The summary says when a note is inside, so a clarification is not missed.
      parts.push(h('details', { class: 'source-info' }, h('summary', {}, note ? 'Source info and a note' : 'Source info'), sources, note ? h('p', { class: 'claude-note' }, h('b', {}, 'Additional note: '), note) : null));
    }
    if (scene) {
      motionEl.replaceChildren(replayBtn);
      motionEl.hidden = false;
    }
    // A mirrored showing is not announced: the flipped court is simply another
    // look at the same situation. The review log still records it.
    parts.push(ratingRow());
    afterEl.replaceChildren(...parts);
    afterEl.hidden = false;
    afterEl.querySelector('.rating.suggested')?.focus({ preventScroll: true });
    ctx.onAnswered?.({ ...r, suggested, view: hero, mirrored });
  }

  function ratingRow() {
    const now = new Date();
    const due = scheduler.preview(state ?? scheduler.newState(now), now);
    return h(
      'div',
      { class: 'ratings', role: 'group', 'aria-label': 'How well did you know it?' },
      [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].map((r) =>
        h(
          'button',
          { class: `rating${r === suggested ? ' suggested' : ''}`, type: 'button', onclick: () => rate(r) },
          h('b', {}, RATING_LABELS[r]),
          h('small', {}, formatInterval(due[r] - now)),
        ),
      ),
    );
  }

  function rate(r) {
    if (done || !answered) return;
    done = true;
    destroy();
    onDone({ rating: r, ...result, view: hero, mirrored });
  }

  function onKey(e) {
    if (done || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t?.closest?.('input, textarea, select')) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= 4) {
      if (!answered && mc && optionsLive && n <= shown.length) {
        e.preventDefault();
        answer(shown[n - 1].id);
      } else if (answered) {
        e.preventDefault();
        rate(n);
      }
      return;
    }
    const activate = e.key === 'Enter' || e.key === ' ';
    if (activate && t?.closest?.('button')) return; // the focused button handles it
    if (activate) {
      e.preventDefault();
      if (timed && !started) start();
      else if (!mc && !answered) showAnswer();
      else if (answered) rate(suggested);
    } else if ((e.key === 'r' || e.key === 'R') && scene && (answered || !timed)) {
      replay(); // timed replays only happen after the answer
    }
  }

  const mq = typeof matchMedia === 'function' ? matchMedia(WIDE_QUERY) : null;
  const onMq = () => draw();
  mq?.addEventListener?.('change', onMq);
  document.addEventListener('keydown', onKey);

  function destroy() {
    document.removeEventListener('keydown', onKey);
    mq?.removeEventListener?.('change', onMq);
    clearTimeout(timeoutId);
    if (raf != null) cancelAnimationFrame(raf);
    player?.stop();
  }

  const side = h('div', { class: 'side' }, panelEl, hint, h('p', { class: 'prompt' }, card.prompt), mc ? optionsEl : showBtn, afterEl);
  const courtEl = h('div', { class: 'court' }, h('div', { class: 'stage' }, heroEl, insetEl, clockEl, toggle), motionEl);
  if (scene) view.append(courtEl);
  view.append(side);
  root.replaceChildren(view);
  draw();

  // freezeAt, clock and frame are exposed for tests and the lab; nothing else reads them.
  return { destroy, answer, start, showAnswer, rate, freezeAt: player?.compiled.freezeAt ?? null, clock: { windowMs, designWindowMs }, frame: () => frame };
}
