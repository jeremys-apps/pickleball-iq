// Both pages share an origin, and with it the storage that holds sync
// credentials, so neither may load anything from another origin, and network
// calls may go only to the origin itself and the data service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

const CONNECT = {
  'index.html': ["'self'", 'https://api.github.com'],
  'lab.html': ["'self'", 'https://api.github.com'],
};

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
