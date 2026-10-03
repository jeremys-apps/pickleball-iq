// Renderer lab: check any scene from every angle before it ships in a deck.
// Paste scene JSON from the card generator to verify Claude's coordinates visually.

import { installRendererStyles } from '../court/theme.js';
import { frameFromScene, checkScene, answerFrame, answerArc } from '../court/scene.js';
import { renderFirstPerson } from '../court/first-person.js';
import { renderTopDown, renderSideView } from '../court/top-down.js';
import { compileTimeline, frameAt, createPlayer } from '../court/playback.js';
import { netHeightFt } from '../court/geometry.js';
import { mirrorScene } from '../court/mirror.js';
import { h } from './dom.js';

const root = document.getElementById('lab');
const SETTINGS_OPEN_KEY = 'piq.lab.settingsOpen.v1';
installRendererStyles();

const S = {
  scenes: [],
  id: null,
  mode: 'over_shoulder',
  viewport: 'laptop',
  aids: { path: true, shadow: true, stalk: true },
  show: { topdown: true, mini: true, side: true },
  reveal: false,
  mirror: false,
  pos: 1000,
  speed: 1,
  freezeLeadMs: 0,
};
let player = null;
let raf = null;
const out = {};

const baseScene = () => S.scenes.find((s) => s.id === S.id);
const scene = () => (S.mirror ? mirrorScene(baseScene()) : baseScene());
const size = () => (S.viewport === 'phone' ? { width: 360, height: 380 } : { width: 800, height: 500 });

function currentFrame() {
  const sc = scene();
  if (sc.timeline) {
    const c = compileTimeline(sc);
    return frameAt(sc, c, (S.pos / 1000) * c.total, { reveal: S.reveal });
  }
  return frameFromScene(sc, S.pos / 1000);
}

function draw(frame = currentFrame()) {
  const fp = renderFirstPerson(frame, { ...size(), mode: S.mode, aids: S.aids });
  out.fp.innerHTML = fp.svg;
  out.views.classList.toggle('is-phone', S.viewport === 'phone');
  out.td.innerHTML = S.show.topdown ? renderTopDown(frame, { variant: 'full', showBackhand: true, crop: 'auto', camera: fp.camera }).svg : '';
  out.mini.innerHTML = S.show.mini ? renderTopDown(frame, { variant: 'mini', camera: fp.camera }).svg : '';
  out.side.innerHTML = S.show.side ? renderSideView(frame).svg : '';
  out.wrap.classList.toggle('is-revealed', S.reveal);
  if (frame.ball) {
    const [x, y, z] = frame.ball.pos;
    const nh = netHeightFt(x);
    out.readout.textContent = `Ball at x ${x.toFixed(1)} ft, y ${y.toFixed(1)} ft, ${Math.round(z * 12)} in high. Net height there: ${Math.round(nh * 12)} in, so the ball is ${z >= nh ? 'above' : 'below'} net height.`;
  } else out.readout.textContent = 'No ball in this scene.';
}

function listIssues() {
  const issues = checkScene(scene());
  out.issues.replaceChildren(
    ...(issues.length ? issues.map((i) => h('li', { class: i.level }, `${i.level}: ${i.msg}`)) : [h('li', {}, 'No issues found.')]),
  );
}

function stop() {
  player?.stop();
  player = null;
  if (raf != null) cancelAnimationFrame(raf);
  raf = null;
}

function play() {
  stop();
  const sc = scene();
  out.note.textContent = '';
  if (sc.timeline) {
    const p = createPlayer(sc, {
      speed: S.speed,
      freezeLeadMs: S.freezeLeadMs,
      reducedMotion: false,
      onFrame: (f, ms) => {
        S.pos = Math.round((ms / p.compiled.total) * 1000);
        out.slider.value = S.pos;
        draw(f);
      },
      onFreeze: (f, ms) => {
        S.pos = Math.round((ms / p.compiled.total) * 1000);
        out.slider.value = S.pos;
        draw(f);
        out.note.textContent = `Frozen at ${ms} ms of ${p.compiled.total} (authored freeze ${p.compiled.authoredFreezeAt} ms). The response clock (${p.compiled.responseWindowMs} ms) would start now.`;
      },
    });
    player = p;
    p.play(0);
  } else {
    // As in the app: their shot arrives with the answer hidden, then, with
    // "Show the answer" on, the answer shot flies.
    const t0 = performance.now();
    const dur = 900 / S.speed;
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      S.pos = Math.round(t * 1000);
      out.slider.value = S.pos;
      if (t < 1) {
        draw(frameFromScene(sc, t, { reveal: false }));
        raf = requestAnimationFrame(step);
      } else if (S.reveal) flyAnswer(sc);
      else draw();
    };
    raf = requestAnimationFrame(step);
  }
}

// The answer half of a replay: the target appears at contact, then the ball
// flies the answer shot with its path growing behind it (card-view.js does the same).
function flyAnswer(sc) {
  const base = frameFromScene(sc);
  if (!answerArc(sc)) return draw(answerFrame(sc, base, 1));
  const t0 = performance.now() + 150 / S.speed;
  const dur = 1000 / S.speed;
  const step = () => {
    const k = Math.min(1, Math.max(0, (performance.now() - t0) / dur));
    draw(answerFrame(sc, base, k));
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

function loadPasted() {
  try {
    const sc = JSON.parse(out.paste.value);
    if (!Array.isArray(sc.players) || !sc.camera) throw new Error('A scene needs players and camera.');
    sc.id = sc.id || `s-pasted-${Date.now().toString(36)}`;
    S.scenes = [...S.scenes.filter((s) => s.id !== sc.id), sc];
    S.id = sc.id;
    S.pos = 1000;
    rebuildSelect();
    listIssues();
    draw();
    out.pasteMsg.textContent = `Loaded ${sc.id}.`;
  } catch (e) {
    out.pasteMsg.textContent = `Could not load that scene: ${e.message}`;
  }
}

function downloadSvg() {
  const svg = renderFirstPerson(currentFrame(), { ...size(), mode: S.mode, aids: S.aids, embedCss: true, revealAll: S.reveal }).svg;
  const a = h('a', { href: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), download: `${S.id}-${S.mode}.svg` });
  document.body.append(a);
  a.click();
  a.remove();
}

function rebuildSelect() {
  out.select.replaceChildren(...S.scenes.map((s) => h('option', { value: s.id, selected: s.id === S.id }, s.id)));
}

const radio = (name, value, label, checked, on) =>
  h('label', {}, h('input', { type: 'radio', name, value, checked, onchange: on }), label);
const check = (label, checked, on) => h('label', {}, h('input', { type: 'checkbox', checked, onchange: on }), label);

function build() {
  out.select = h('select', { onchange: (e) => { stop(); S.id = e.target.value; S.pos = 1000; out.slider.value = 1000; listIssues(); draw(); } });
  rebuildSelect();
  out.slider = h('input', { type: 'range', min: 0, max: 1000, value: S.pos, oninput: (e) => { stop(); S.pos = Number(e.target.value); draw(); } });
  out.paste = h('textarea', { placeholder: 'Paste a scene object here', spellcheck: 'false' });
  out.pasteMsg = h('p', { class: 'note' });
  out.note = h('p', { class: 'note' });
  out.readout = h('p', { class: 'readout note' });
  out.issues = h('ul', { class: 'issues note' });
  out.fp = h('div', { class: 'fp' });
  out.td = h('div', { class: 'td' });
  out.mini = h('div', { class: 'mini' });
  out.side = h('div', { class: 'side-view' });

  // Settings first (collapsible, so a phone can fold them away), then the stage:
  // the motion bar with Play directly above the picture, the picture, and the
  // panels beside it on a laptop or below it on a phone. Everything that matters
  // while a shot plays is in view at once.
  // Whether the settings block is open is remembered on this device, so the
  // stage comes up first once you have folded the settings away.
  let settingsOpen = true;
  try {
    settingsOpen = localStorage.getItem(SETTINGS_OPEN_KEY) !== 'false';
  } catch {
    /* storage unavailable: stay open */
  }
  const settings = h(
    'details',
    {
      class: 'lab-settings-wrap',
      open: settingsOpen,
      ontoggle: (e) => {
        try {
          localStorage.setItem(SETTINGS_OPEN_KEY, String(e.target.open));
        } catch {
          /* ignore */
        }
      },
    },
    h('summary', {}, 'Scene and settings'),
    h(
      'div',
      { class: 'lab-settings' },
      h('fieldset', {}, h('legend', {}, 'Scene'), h('label', {}, 'Scene ', out.select), out.issues),
      h('fieldset', {}, h('legend', {}, 'Camera'),
        radio('mode', 'over_shoulder', 'Over the shoulder', true, () => { S.mode = 'over_shoulder'; draw(); }),
        radio('mode', 'first_person', 'Through your eyes', false, () => { S.mode = 'first_person'; draw(); }),
        check('Mirror left to right', false, (e) => { S.mirror = e.target.checked; listIssues(); draw(); })),
      h('fieldset', {}, h('legend', {}, 'Screen'),
        radio('vp', 'laptop', 'Laptop (800 x 500)', true, () => { S.viewport = 'laptop'; draw(); }),
        radio('vp', 'phone', 'Phone (360 x 380)', false, () => { S.viewport = 'phone'; draw(); })),
      h('fieldset', {}, h('legend', {}, 'Aids'),
        check('Ball path', true, (e) => { S.aids.path = e.target.checked; draw(); }),
        check('Shadow', true, (e) => { S.aids.shadow = e.target.checked; draw(); }),
        check('Height stalk and net-height mark', true, (e) => { S.aids.stalk = e.target.checked; draw(); })),
      h('fieldset', {}, h('legend', {}, 'Panels'),
        check('Top-down', true, (e) => { S.show.topdown = e.target.checked; draw(); }),
        check('Mini-map', true, (e) => { S.show.mini = e.target.checked; draw(); }),
        check('Side view', true, (e) => { S.show.side = e.target.checked; draw(); }),
        check('Show the answer', false, (e) => { S.reveal = e.target.checked; draw(); })),
      h('fieldset', {}, h('legend', {}, 'Paste a scene'), out.paste, h('button', { class: 'btn', type: 'button', onclick: loadPasted }, 'Load scene'), out.pasteMsg),
    ),
  );
  const motion = h(
    'div',
    { class: 'lab-motion' },
    h('button', { class: 'btn primary', type: 'button', onclick: play }, 'Play'),
    h('label', { class: 'time' }, 'Time ', out.slider),
    h('label', {}, 'Speed ', h('select', { onchange: (e) => { S.speed = Number(e.target.value); } },
      h('option', { value: 0.6 }, '0.6x (new cards)'), h('option', { value: 0.85 }, '0.85x'), h('option', { value: 1, selected: true }, 'Real speed'))),
    h('label', {}, 'Freeze ', h('select', { onchange: (e) => { S.freezeLeadMs = Number(e.target.value); } },
      h('option', { value: 0, selected: true }, 'As authored (stage A)'), h('option', { value: 120 }, '120 ms earlier (stage B)'), h('option', { value: 250 }, '250 ms earlier (stage C)'))),
    h('button', { class: 'btn', type: 'button', onclick: downloadSvg }, 'Download SVG'),
  );
  out.views = h('div', { class: 'lab-views' }, out.fp, h('div', { class: 'lab-panels' }, out.td, out.mini, out.side));
  out.wrap = h('div', { class: 'lab-stage' }, motion, out.views, out.readout, out.note);
  root.replaceChildren(settings, out.wrap);
}

async function init() {
  const deck = await (await fetch('data/deck.sample.json')).json();
  S.scenes = deck.scenes;
  S.id = S.scenes[0].id;
  build();
  listIssues();
  draw();
}

init().catch((e) => {
  root.textContent = `The lab could not start: ${e.message}`;
});
