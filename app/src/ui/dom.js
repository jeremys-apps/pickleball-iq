// Tiny DOM helpers. No framework: the app is small and ships without a build step.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(typeof c === 'object' && 'nodeType' in c ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const WIDE_QUERY = '(min-width: 900px)';
export const isWide = () => typeof matchMedia === 'function' && matchMedia(WIDE_QUERY).matches;

export function formatInterval(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h`;
  const d = Math.round(hr / 24);
  if (d < 30) return d === 1 ? '1 day' : `${d} days`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} mo`;
  return `${(d / 365).toFixed(1)} yr`;
}
