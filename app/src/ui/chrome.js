import { h } from './dom.js';

export function topbar() {
  return h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'wordmark', href: '#/' }, 'Court Sense'),
    h(
      'nav',
      { 'aria-label': 'Main' },
      h('a', { class: 'btn quiet', href: '#/cards' }, 'Cards'),
      h('a', { class: 'btn quiet', href: 'lab.html' }, 'Lab'),
      h('a', { class: 'btn quiet', href: '#/settings' }, 'Settings'),
    ),
  );
}

export const count = (value, label) => h('div', { class: 'count' }, h('b', {}, String(value)), h('span', {}, label));
