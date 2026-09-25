/**
 * Tests for the publish script's path resolution.
 *
 * publish.js is a script, so the only part worth unit-testing is the part that
 * decides WHERE things are — and that part is exactly what was broken: it
 * resolved the app root as `__dirname/..`, which was the monorepo root when
 * this file lived at `__shared__/scripts/` and is `<app>/sdk` now that it ships
 * as a submodule. Every app's publish died on step one, looking for
 * config.updates.json inside the SDK.
 *
 * Both mount layouts are covered here through the injected `exists` probe:
 * a standalone clone, where sdk/ is a real directory under the app, and this
 * development tree, where sdk/ is a symlink so __dirname resolves out of the
 * app entirely and the cwd fallback is what finds it.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { findAppRoot, bundlerPath, CONFIG_NAME } = require('./publish.js');

const APP = path.join(path.sep, 'apps', 'ai-mentat-n8n');
/** `exists` that only knows about config.updates.json in the given dirs. */
const only = (...dirs) => (p) =>
  dirs.some((d) => p === path.join(d, CONFIG_NAME));

test('walks up from sdk/logic to the app root — the standalone clone layout', () => {
  const start = path.join(APP, 'sdk', 'logic');
  assert.strictEqual(findAppRoot(start, '/nowhere', only(APP)), APP);
});

test('falls back to cwd when the walk finds nothing — the symlinked dev layout', () => {
  // sdk/ is a symlink to a shared checkout, so __dirname realpaths to
  // .../mentats/ai-mentats-sdk/logic and walking up never passes the app.
  const start = path.join(path.sep, 'mentats', 'ai-mentats-sdk', 'logic');
  assert.strictEqual(findAppRoot(start, APP, only(APP)), APP);
});

test('the walk wins over cwd when both would answer', () => {
  const other = path.join(path.sep, 'apps', 'ai-mentat-minecraft');
  const start = path.join(APP, 'sdk', 'logic');
  assert.strictEqual(findAppRoot(start, other, only(APP, other)), APP,
    'the app you are inside beats the directory you happen to be in');
});

test('finds it at the start directory itself', () => {
  assert.strictEqual(findAppRoot(APP, '/nowhere', only(APP)), APP);
});

test('stops at the filesystem root rather than looping', () => {
  assert.throws(() => findAppRoot(path.join(APP, 'sdk', 'logic'), '/nowhere', () => false),
    /no config\.updates\.json found/);
});

test('the failure names both places it looked, and what to do', () => {
  try {
    findAppRoot(path.join(APP, 'sdk'), path.join(path.sep, 'tmp'), () => false);
    assert.fail('should have thrown');
  } catch (e) {
    assert.match(e.message, /Searched upwards from/);
    assert.match(e.message, /Run this from an app directory/);
  }
});

test('the bundler is resolved inside this SDK, never a monorepo shared/', () => {
  // `node shared/bundle-electron.js` was the old call and that path has not
  // existed since the apps became separate repos.
  const p = bundlerPath(path.join(path.sep, 'apps', 'x', 'sdk', 'logic'));
  assert.strictEqual(p, path.join(path.sep, 'apps', 'x', 'sdk', 'utils', 'bundle-electron.js'));
  assert.ok(!p.includes('shared'));
});

test('bundlerPath defaults to this file\'s own location and really exists', () => {
  assert.ok(require('fs').existsSync(bundlerPath()),
    'the default must point at the bundler that ships beside it');
});
