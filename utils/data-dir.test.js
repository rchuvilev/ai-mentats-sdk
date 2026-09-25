/**
 * Runnable check for data-dir.js — the contract every app depends on.
 * `node --test utils/data-dir.test.js`
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { systemRoot, appHome, dataDir, ensureDataDir, resolveDataDir } = require('./data-dir');

test('dataDir matches the documented <root>/.hexstack-app/<app>/data contract', () => {
  const d = dataDir('mentat-demo');
  assert.strictEqual(d, path.join(systemRoot(), '.hexstack-app', 'mentat-demo', 'data'));
  // absolute, and rooted at the filesystem root, not the user's home
  assert.ok(path.isAbsolute(d));
  assert.ok(!d.startsWith(os.homedir()), `must not be under homedir: ${d}`);
});

test('POSIX root path is literally /.hexstack-app/<app>/data', { skip: process.platform === 'win32' }, () => {
  assert.strictEqual(dataDir('ai-mentat-interviews'), '/.hexstack-app/ai-mentat-interviews/data');
});

test('data dir is the app home plus /data', () => {
  assert.strictEqual(dataDir('x'), path.join(appHome('x'), 'data'));
});

test('unsafe app names are rejected at the trust boundary', () => {
  for (const bad of ['../escape', 'a/b', 'a\\b', '', null, undefined]) {
    assert.throws(() => appHome(bad), TypeError, `should reject ${JSON.stringify(bad)}`);
  }
});

test('ensureDataDir reports failure instead of throwing, and offers a fallback', () => {
  const r = ensureDataDir('mentat-selftest-' + process.pid);
  assert.ok(typeof r.ok === 'boolean');
  if (r.ok) {
    assert.ok(fs.existsSync(r.dir));
    fs.rmSync(path.dirname(r.dir), { recursive: true, force: true });
  } else {
    // the important property: a read-only root must not crash the app
    assert.ok(r.error instanceof Error);
    assert.ok(r.fallback.startsWith(os.homedir()));
  }
});

test('resolveDataDir always returns an existing writable directory', () => {
  const d = resolveDataDir('mentat-selftest2-' + process.pid);
  assert.ok(fs.existsSync(d), `${d} should exist`);
  fs.accessSync(d, fs.constants.W_OK);
  fs.rmSync(path.dirname(d), { recursive: true, force: true });
});
