// Court colors are physical, not UI chrome: a blue playing surface, green
// surround, white lines, an optic-yellow ball. They stay the same in light and
// dark mode so every card looks like the same court.

export const TOKENS = Object.freeze({
  backdrop: '#1E2B38',
  surround: '#3B6D57',
  surface: '#2D5F8E',
  kitchen: '#27527D',
  line: '#EEF3EF',
  netMesh: 'rgba(12, 18, 24, 0.42)',
  netTape: '#F4F6F4',
  netPost: '#12171D',
  playerUs: '#F3F2EC',
  playerUsStroke: '#1B2A3A',
  playerUsText: '#1B2A3A',
  playerThem: '#E8703E',
  playerThemStroke: '#5E2410',
  playerThemText: '#3B1405',
  paddle: '#12171D',
  ball: '#D9F03E',
  ballStroke: '#3D4806',
  path: '#F5C443',
  shadow: 'rgba(0, 0, 0, 0.38)',
  stalk: 'rgba(255, 255, 255, 0.8)',
  tick: '#FFFFFF',
  answer: '#5FE3A8',
  answerZone: 'rgba(95, 227, 168, 0.3)',
  fov: 'rgba(255, 255, 255, 0.2)',
  camera: '#FFFFFF',
  annotation: '#EEF3EF',
  font: '"Barlow Semi Condensed", "Barlow", system-ui, sans-serif',
});

const cssVar = (k) => `--piq-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`;

function rules(val) {
  return `
.piq-svg{font-family:${val('font')}}
.piq-backdrop{fill:${val('backdrop')}}
.piq-surround{fill:${val('surround')}}
.piq-surface{fill:${val('surface')}}
.piq-kitchen{fill:${val('kitchen')}}
.piq-line{fill:${val('line')};stroke:${val('line')};stroke-width:.6}
.piq-td-line{stroke:${val('line')};fill:none}
.piq-net-mesh{fill:${val('netMesh')}}
.piq-net-tape{fill:${val('netTape')}}
.piq-net-post{stroke:${val('netPost')};stroke-linecap:round}
.piq-td-net{stroke:${val('netTape')};stroke-linecap:round}
.piq-player-us{fill:${val('playerUs')};stroke:${val('playerUsStroke')};stroke-width:.8}
.piq-player-them{fill:${val('playerThem')};stroke:${val('playerThemStroke')};stroke-width:.8}
.piq-arm-us{stroke:${val('playerUs')};fill:none}
.piq-arm-them{stroke:${val('playerThem')};fill:none}
.piq-label-us{fill:${val('playerUsText')};font-weight:600;font-size:12px}
.piq-label-them{fill:${val('playerThemText')};font-weight:600;font-size:12px}
.piq-paddle{fill:${val('paddle')}}
.piq-ball{fill:${val('ball')};stroke:${val('ballStroke')};stroke-width:.8}
.piq-ball-shadow{fill:${val('shadow')}}
.piq-stalk{stroke:${val('stalk')};stroke-width:1.2;stroke-dasharray:3 3;fill:none}
.piq-tick{stroke:${val('tick')};stroke-width:2.4;stroke-linecap:round}
.piq-path{stroke:${val('path')};fill:none;stroke-linecap:round}
.piq-path-far{stroke-dasharray:5 4}
.piq-answer{stroke:${val('answer')};fill:none;stroke-width:3;stroke-linecap:round}
.piq-answer-zone{fill:${val('answerZone')};stroke:${val('answer')};stroke-width:1.2;stroke-dasharray:4 3}
.piq-arrowhead{fill:${val('answer')}}
.piq-fov{fill:${val('fov')}}
.piq-cam{fill:${val('camera')};stroke:${val('backdrop')};stroke-width:1}
.piq-annot{fill:${val('annotation')};font-weight:600;font-size:11px}
.piq-annot-line{stroke:${val('annotation')};fill:none}
.piq-reveal{opacity:0;transition:opacity .25s ease}
.is-revealed .piq-reveal,.piq-reveal.is-on{opacity:1}
@media (prefers-reduced-motion: reduce){.piq-reveal{transition:none}}
`;
}

// useVars: true for the app (tokens become --piq-* custom properties).
// useVars: false for standalone SVG exports and test renders (literal values).
export function renderCss(tokens = TOKENS, { useVars = true, revealAll = false } = {}) {
  if (!useVars) {
    let css = rules((k) => tokens[k]);
    if (revealAll) css += '.piq-reveal{opacity:1}';
    return css;
  }
  const root = Object.entries(tokens)
    .map(([k, v]) => `${cssVar(k)}:${v};`)
    .join('');
  return `:root{${root}}` + rules((k) => `var(${cssVar(k)})`);
}

// Inject renderer CSS into a document once.
export function installRendererStyles(doc = document, tokens = TOKENS) {
  if (doc.getElementById('piq-renderer-css')) return;
  const el = doc.createElement('style');
  el.id = 'piq-renderer-css';
  el.textContent = renderCss(tokens, { useVars: true });
  doc.head.appendChild(el);
}
