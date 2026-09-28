// Writes standalone SVG renders of the sample scenes to docs/img/ as a visual
// reference. Compare against these after renderer changes (npm run renders).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { frameFromScene } from '../app/src/court/scene.js';
import { renderFirstPerson } from '../app/src/court/first-person.js';
import { renderTopDown, renderSideView } from '../app/src/court/top-down.js';
import { compileTimeline, frameAt } from '../app/src/court/playback.js';

const root = new URL('../', import.meta.url);
const deck = JSON.parse(readFileSync(new URL('app/data/deck.sample.json', root)));
const outDir = new URL('docs/img/', root);
mkdirSync(outDir, { recursive: true });
const write = (name, svg) => writeFileSync(new URL(`${name}.svg`, outDir), svg);
const scene = (id) => deck.scenes.find((s) => s.id === id);

for (const id of ['s-floater-backhands', 's-dropping-dink']) {
  const f = frameFromScene(scene(id));
  for (const mode of ['over_shoulder', 'first_person']) {
    write(`${id}-${mode}`, renderFirstPerson(f, { mode, embedCss: true }).svg);
  }
  const ots = renderFirstPerson(f, { mode: 'over_shoulder' });
  write(`${id}-reveal`, renderFirstPerson(f, { embedCss: true, revealAll: true }).svg);
  write(`${id}-topdown`, renderTopDown(f, { showBackhand: true, crop: 'auto', camera: ots.camera, embedCss: true, revealAll: true }).svg);
  write(`${id}-minimap`, renderTopDown(f, { variant: 'mini', camera: ots.camera, embedCss: true }).svg);
  write(`${id}-side`, renderSideView(f, { embedCss: true }).svg);
}
const occ = scene('s-occlusion-floater');
const c = compileTimeline(occ);
for (const ms of [0, 1000, 1700, c.freezeAt]) write(`s-occlusion-floater-${ms}ms`, renderFirstPerson(frameAt(occ, c, ms), { embedCss: true }).svg);
console.log('Reference renders written to docs/img/');
