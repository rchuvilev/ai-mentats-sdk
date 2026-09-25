'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const S = require('./settings');
const F = require('../utils/failsafe');

/** In-memory fs double, so no test touches a disk. */
function fakeFs(initial = {}) {
  const files = { ...initial };
  return {
    files,
    existsSync: (p) => p in files,
    readFileSync: (p) => {
      if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files[p];
    },
    writeFileSync: (p, data) => { files[p] = data; },
    renameSync: (from, to) => { files[to] = files[from]; delete files[from]; },
    mkdirSync: () => {},
  };
}

const storePath = (opts) => S.createSettingsStore({ dir: '/data', fs: fakeFs(), ...opts }).path;

test('the settings file lives at dir/file with settings.json as the default', () => {
  assert.strictEqual(storePath({}), path.join('/data', 'settings.json'));
  // n8n keeps its own filename so existing user settings are not discarded.
  assert.strictEqual(storePath({ file: 'mentat-settings.json' }),
    path.join('/data', 'mentat-settings.json'));
});

test('createSettingsStore requires a directory', () => {
  assert.throws(() => S.createSettingsStore({ fs: fakeFs() }), TypeError);
});

test('a missing file loads as an empty object', () => {
  const store = S.createSettingsStore({ dir: '/data', fs: fakeFs() });
  assert.deepStrictEqual(store.load(), {});
});

test('a missing file is NOT recorded as a failure', () => {
  // First-run absence is expected. Recording it on every status poll floods
  // the bounded failsafe buffer that exists to surface real errors.
  F.clearFailures();
  const restore = F.setSink(() => {});
  S.createSettingsStore({ dir: '/data', fs: fakeFs() }).load();
  F.setSink(restore);
  assert.deepStrictEqual(F.recentFailures(), []);
});

test('a corrupt file loads as empty AND is recorded', () => {
  // Unlike absence, unreadable content is a real problem worth finding.
  F.clearFailures();
  const restore = F.setSink(() => {});
  const store = S.createSettingsStore({
    dir: '/data', fs: fakeFs({ '/data/settings.json': '{ truncated' }),
  });
  assert.deepStrictEqual(store.load(), {});
  F.setSink(restore);
  assert.ok(F.recentFailures().some((f) => f.op === 'settings.read'));
});

test('save merges a patch rather than replacing the document', () => {
  const fs = fakeFs({ '/data/settings.json': JSON.stringify({ a: 1, b: 2 }) });
  const store = S.createSettingsStore({ dir: '/data', fs });
  const merged = store.save({ b: 3, c: 4 });
  assert.deepStrictEqual(merged, { a: 1, b: 3, c: 4 });
  assert.deepStrictEqual(JSON.parse(fs.files['/data/settings.json']), { a: 1, b: 3, c: 4 });
});

test('a failed write is recorded, and the app keeps running', () => {
  const fs = fakeFs();
  fs.writeFileSync = () => { throw new Error('EROFS'); };
  F.clearFailures();
  const restore = F.setSink(() => {});
  const store = S.createSettingsStore({ dir: '/data', fs });
  assert.doesNotThrow(() => store.save({ a: 1 }));
  F.setSink(restore);
  assert.ok(F.recentFailures().some((f) => f.op === 'settings.write'),
    'losing a write means the next launch forgets a change that really happened');
});

test('the write is atomic — temp file then rename', async () => {
  // A crash or a full disk mid-write must leave the previous settings intact
  // rather than a truncated file the next launch cannot parse. Carried over
  // from coolify, which was the only app doing this.
  const fs = fakeFs({ '/data/settings.json': JSON.stringify({ a: 1 }) });
  const order = [];
  const realWrite = fs.writeFileSync;
  const realRename = fs.renameSync;
  fs.writeFileSync = (p, d) => { order.push(`write ${p}`); realWrite(p, d); };
  fs.renameSync = (f, t) => { order.push(`rename ${f} -> ${t}`); realRename(f, t); };
  S.createSettingsStore({ dir: '/data', fs }).save({ b: 2 });
  assert.deepStrictEqual(order, ['write /data/settings.json.tmp', 'rename /data/settings.json.tmp -> /data/settings.json']);
  assert.ok(!('/data/settings.json.tmp' in fs.files), 'no temp file is left behind');
  assert.deepStrictEqual(JSON.parse(fs.files['/data/settings.json']), { a: 1, b: 2 });
});

test('registerSettingsIpc attaches get and set', async () => {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const store = S.createSettingsStore({ dir: '/data', fs: fakeFs() });
  S.registerSettingsIpc(ipcMain, store);
  assert.deepStrictEqual(Object.keys(handlers).sort(), ['settings:get', 'settings:set']);
  await handlers['settings:set'](null, { theme: 'dark' });
  assert.deepStrictEqual(await handlers['settings:get'](null), { theme: 'dark' });
});

test('settings:set rejects a non-object patch', async () => {
  const handlers = {};
  S.registerSettingsIpc({ handle: (ch, fn) => { handlers[ch] = fn; } },
    S.createSettingsStore({ dir: '/data', fs: fakeFs() }));
  for (const bad of [null, 'nope', 42, ['a']]) {
    const r = await handlers['settings:set'](null, bad);
    assert.strictEqual(r.ok, false, String(bad));
  }
});
