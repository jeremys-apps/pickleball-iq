// Both pages share an origin, and with it the storage that holds people's
// sessions, so neither may load anything from another origin. The app may call
// its own origin and the sign-in Worker; the lab, only its own origin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCOUNT_API } from '../app/src/store/account.js';

const page = (name) => readFileSync(new URL(`../app/${name}`, import.meta.url), 'utf8');

// The policy as { directive: [sources] }.
function policyOf(html) {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(m, 'the page carries a Content-Security-Policy');
  return Object.fromEntries(
    m[1]
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources]),
  );
}

const WORKER = new URL(ACCOUNT_API).origin;
const CONNECT = {
  'index.html': ["'self'", WORKER],
  'lab.html': ["'self'"],
};

test('the app calls the deployed sign-in Worker', () => {
  assert.equal(WORKER, 'https://court-sense.jeremys-apps.workers.dev');
});

for (const name of Object.keys(CONNECT)) {
  test(`${name}: scripts, styles and fonts come from the app's origin, and calls go only where the app needs`, () => {
    const html = page(name);
    const p = policyOf(html);
    assert.deepEqual(p['default-src'], ["'self'"]);
    assert.deepEqual(p['script-src'], ["'self'"], 'no inline or third-party scripts');
    assert.deepEqual(p['style-src'], ["'self'", "'unsafe-inline'"]);
    assert.deepEqual(p['font-src'], ["'self'"]);
    assert.deepEqual(p['img-src'], ["'self'", 'data:', 'blob:']);
    assert.deepEqual(p['connect-src'], CONNECT[name]);
    assert.ok(!html.includes('api.github.com'), 'no call goes to GitHub itself');
    assert.deepEqual(p['object-src'], ["'none'"]);
    assert.deepEqual(p['base-uri'], ["'self'"]);
    const external = html.match(/<(script|link|img)\b[^>]*\b(src|href)="(https?:)?\/\/[^"]*"/gi);
    assert.equal(external, null, `nothing is loaded from another origin: ${external}`);
  });
}

test('the policy reader rejects a page without a policy and splits directives on any spacing', () => {
  assert.throws(() => policyOf('<html><head></head></html>'));
  const p = policyOf('<meta http-equiv="Content-Security-Policy" content="default-src  \'self\' ;connect-src \'self\' https://x.example;">');
  assert.deepEqual(p['default-src'], ["'self'"]);
  assert.deepEqual(p['connect-src'], ["'self'", 'https://x.example']);
});
