import { h } from './dom.js';

// The tab you are on is marked (aria-current) and drawn bold with an underline;
// "Court Sense" is the Home tab. Lab is laptop only; styles.css hides it below 900 px.
export function topbar(current = currentTab()) {
  const tab = (href, label, key, cls = 'btn quiet') => h('a', { class: cls, href, 'aria-current': current === key ? 'page' : null }, label);
  return h(
    'header',
    { class: 'topbar' },
    tab('#/', 'Court Sense', 'home', 'wordmark'),
    h(
      'nav',
      { 'aria-label': 'Main' },
      tab('#/cards', 'Cards', 'cards'),
      h('a', { class: 'btn quiet lab-link', href: 'lab.html' }, 'Lab'),
      tab('#/progress', 'Progress', 'progress'),
      tab('#/settings', 'Settings', 'settings'),
    ),
  );
}

// Which tab a route belongs to: a session is part of Home, a card preview of Cards.
export function currentTab(hash = globalThis.location?.hash ?? '') {
  const name = hash.replace(/^#\/?/, '').split('/')[0];
  if (name === 'cards' || name === 'preview') return 'cards';
  if (name === 'progress' || name === 'settings') return name;
  return 'home';
}

export const count = (value, label) => h('div', { class: 'count' }, h('b', {}, String(value)), h('span', {}, label));
