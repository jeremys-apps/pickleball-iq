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
      h('a', { class: 'btn quiet lab-link', href: 'lab.html' }, 'Lab'), // laptop only; hidden below 900 px in styles.css
      h('a', { class: 'btn quiet', href: '#/progress' }, 'Progress'),
      h('a', { class: 'btn quiet', href: '#/settings' }, 'Settings'),
    ),
  );
}

export const count = (value, label) => h('div', { class: 'count' }, h('b', {}, String(value)), h('span', {}, label));
