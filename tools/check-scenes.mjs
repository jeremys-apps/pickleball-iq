// Semantic checks for scene files (beyond JSON Schema): wrong side of the net,
// missing net clearance, broken timeline chains, unknown players.
// Usage: node tools/check-scenes.mjs <scenes.json | deck.json>
import { readFileSync } from 'node:fs';
import { checkScene } from '../app/src/court/scene.js';
import { makeArc } from '../app/src/court/trajectory.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node tools/check-scenes.mjs <scenes.json | deck.json>');
  process.exit(2);
}
const data = JSON.parse(readFileSync(file, 'utf8'));
const scenes = Array.isArray(data) ? data : data.scenes ?? [];
let errors = 0;
let warnings = 0;
for (const s of scenes) {
  const issues = checkScene(s);
  if (s.ball?.from && s.ball?.now) {
    const arc = makeArc(s.ball.from, s.ball.now, s.ball);
    if (arc.crosses && arc.actualClearanceIn != null && Math.abs(arc.actualClearanceIn - (s.ball.net_clearance_in ?? 6)) > 1) {
      issues.push({ level: 'warn', msg: `ball clears the net by ${Math.round(arc.actualClearanceIn)} in, not the requested ${s.ball.net_clearance_in}` });
    }
  }
  for (const i of issues) {
    console.log(`${i.level.padEnd(5)} ${s.id}: ${i.msg}`);
    if (i.level === 'error') errors++;
    else warnings++;
  }
}
console.log(`${scenes.length} scenes checked: ${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
