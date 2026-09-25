'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const E = require('./env');

// A GUI app launched from Finder inherits a launchd PATH without Homebrew or
// the user's own bin dirs, which is how "cloudflared is not installed" was
// reported on machines where it plainly was.
test('buildPath prepends the app install locations so they win', () => {
  const p = E.buildPath('/Users/x', 'darwin', '/usr/bin:/bin');
  const parts = p.split(':');
  assert.ok(parts.indexOf('/Users/x/.bun/bin') < parts.indexOf('/usr/bin'),
    'app locations must come before the inherited PATH');
  assert.ok(p.includes('/opt/homebrew/bin'));
  assert.ok(p.endsWith('/usr/bin:/bin'), 'the inherited PATH must survive');
});

test('buildPath falls back to a usable PATH when the environment has none', () => {
  // Pass '' not undefined: undefined triggers the process.env.PATH default
  // parameter and the assertion would then read the test machine's own PATH.
  const p = E.buildPath('/Users/x', 'darwin', '');
  assert.ok(p.includes('/usr/bin:/bin'));
  assert.ok(!p.includes('::'), 'an empty PATH entry means the current directory');
  assert.ok(!p.endsWith(':'));
});

test('buildPath uses Windows separators and locations on win32', () => {
  const p = E.buildPath('C:\\Users\\x', 'win32', 'C:\\Windows');
  assert.ok(p.includes(';'));
  assert.ok(!p.includes('/opt/homebrew/bin'));
  assert.ok(p.includes(path.join('C:\\Users\\x', 'AppData', 'Local', 'Programs', 'claude-code')));
});

test('shellEnv merges the base environment and the extra entries', () => {
  const env = E.shellEnv({
    home: '/Users/x',
    platform: 'darwin',
    baseEnv: { HOME: '/Users/x', PATH: '/usr/bin' },
    extra: { LIMA_HOME: '/Users/x/.mc-lima' },
  });
  assert.strictEqual(env.HOME, '/Users/x');
  assert.strictEqual(env.LIMA_HOME, '/Users/x/.mc-lima');
  assert.ok(env.PATH.startsWith('/Users/x/.local/bin'));
});

test('shellEnv lets extra override a base entry', () => {
  // lima.js relies on this: LIMA_HOME must win over an inherited one.
  const env = E.shellEnv({
    home: '/Users/x', baseEnv: { LIMA_HOME: '/wrong' }, extra: { LIMA_HOME: '/right' },
  });
  assert.strictEqual(env.LIMA_HOME, '/right');
});

test('run passes arguments as an array, never a shell string', () => {
  // The shipped n8n build interpolated an API key into an execSync string, so
  // a key containing a metacharacter was executed rather than passed.
  const seen = [];
  const out = E.run('echo', ['a b', '$(whoami)'], {
    exec: (bin, args) => { seen.push([bin, args]); return 'ok'; },
  });
  assert.strictEqual(out, 'ok');
  assert.deepStrictEqual(seen[0][1], ['a b', '$(whoami)'],
    'arguments arrive intact and unsplit');
});

test('tryRun returns null on failure instead of throwing', () => {
  const r = E.tryRun('probe.missing', 'nope', ['--version'], {
    exec: () => { throw new Error('ENOENT'); },
  });
  assert.strictEqual(r, null);
});

test('tryRun records the failure under its op label', () => {
  const F = require('./failsafe');
  F.clearFailures();
  const restore = F.setSink(() => {});
  E.tryRun('probe.missing', 'nope', [], { exec: () => { throw new Error('boom'); } });
  F.setSink(restore);
  const ops = F.recentFailures().map((f) => f.op);
  assert.ok(ops.includes('probe.missing'), 'a suppressed failure must be traceable');
});
