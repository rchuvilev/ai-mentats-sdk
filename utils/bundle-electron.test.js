'use strict';
// Tests for the project-dir resolution that `npm run bundle` depends on.
//
// The bug these pin: the default was `path.resolve(__dirname, '..')`, correct
// when this file lived at `__shared__/scripts/` and wrong at `sdk/utils/`,
// where it pointed at `<repo>/sdk`. Every consuming repo calls this with no
// argument, so bundling was broken in all of them.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const B = require('./bundle-electron');

/** Fake filesystem: only the listed paths exist. */
const only = (...paths) => (p) => paths.includes(p);

test('finds the repo root from the submodule layout', () => {
  // sdk/utils -> sdk -> <repo>
  const dir = B.resolveProjectDir({
    startDir: '/repo/sdk/utils',
    cwd: '/somewhere/else',
    exists: only(path.join('/repo', B.ENTRY_NAME)),
  });
  assert.strictEqual(dir, '/repo');
});

test('finds the repo root from the npm-install layout', () => {
  // node_modules/ai-mentat-sdk/utils -> ... -> <repo>
  const dir = B.resolveProjectDir({
    startDir: '/repo/node_modules/ai-mentat-sdk/utils',
    cwd: '/somewhere/else',
    exists: only(path.join('/repo', B.ENTRY_NAME)),
  });
  assert.strictEqual(dir, '/repo',
    'a hardcoded parent depth would break under a different mount point');
});

test('never returns the SDK directory itself', () => {
  // The old default did exactly this, and esbuild then failed on
  // <repo>/sdk/electron-main.js.
  const dir = B.resolveProjectDir({
    startDir: '/repo/sdk/utils',
    cwd: '/repo',
    exists: only(path.join('/repo', B.ENTRY_NAME)),
  });
  assert.notStrictEqual(dir, '/repo/sdk');
});

test('an explicit argument wins outright', () => {
  const dir = B.resolveProjectDir({
    arg: '/explicit/app',
    startDir: '/repo/sdk/utils',
    cwd: '/repo',
    exists: () => true,
  });
  assert.strictEqual(dir, '/explicit/app');
});

test('an explicit argument is not second-guessed against the filesystem', () => {
  // The caller may be bundling a project that does not exist yet; validating
  // here would make the override useless.
  const dir = B.resolveProjectDir({ arg: '/not/on/disk', exists: () => false });
  assert.strictEqual(dir, '/not/on/disk');
});

test('a relative argument is resolved to an absolute path', () => {
  const dir = B.resolveProjectDir({ arg: '.', exists: () => true });
  assert.strictEqual(dir, path.resolve('.'));
  assert.ok(path.isAbsolute(dir));
});

test('falls back to the working directory when the walk finds nothing', () => {
  const dir = B.resolveProjectDir({
    startDir: '/elsewhere/sdk/utils',
    cwd: '/app',
    exists: only(path.join('/app', B.ENTRY_NAME)),
  });
  assert.strictEqual(dir, '/app');
});

test('throws a message naming both places it looked', () => {
  // Beats an esbuild "could not resolve" pointing at a path nobody chose.
  assert.throws(
    () => B.resolveProjectDir({ startDir: '/a/b/c', cwd: '/d/e', exists: () => false }),
    (e) => {
      assert.match(e.message, /no electron-main\.js or electron-main\.cjs found/,
        'the error names every entry filename it looked for');
      assert.match(e.message, /\/a\/b\/c/);
      assert.match(e.message, /\/d\/e/);
      assert.match(e.message, /pass the project dir/);
      return true;
    },
  );
});

test('the walk terminates at the filesystem root', () => {
  let calls = 0;
  assert.throws(() => B.resolveProjectDir({
    startDir: '/a/b/c',
    cwd: '/x',
    exists: () => { calls += 1; return false; },
  }));
  assert.ok(calls < 20, `walk must not loop at the root (checked ${calls} paths)`);
});

// ─── externals ───────────────────────────────────────────────────────────

test('electron and electron-updater are always external', () => {
  const external = B.externalsFor('/no/such/dir');
  assert.ok(external.includes('electron'));
  assert.ok(external.includes('electron-updater'));
});

test('a missing package.json is not fatal', () => {
  assert.deepStrictEqual(B.externalsFor('/no/such/dir'), B.ALWAYS_EXTERNAL);
});

// ─── renderer file copy ──────────────────────────────────────────────────

test('the update bar is copied from ui/, where it actually lives', () => {
  // It used to be looked for inside utils/, where it has never existed, so the
  // copy silently did nothing and every app's <script src="update-ui.js">
  // 404'd — the update bar just never appeared.
  const spec = B.RENDERER_FILES.find((f) => f.to === 'update-ui.js');
  assert.ok(spec, 'update-ui.js must still be produced: app.html references it by that name');
  assert.match(spec.from, /ui[/\\]update-bar\.js$/);
  // And the source must really be there in this repo.
  const fs = require('fs');
  assert.ok(fs.existsSync(path.resolve(__dirname, spec.from)),
    `${spec.from} is missing from the SDK`);
});

// ─── .cjs entries (dejavu is "type": "module") ───────────────────────────

test('an electron-main.cjs entry is found when there is no .js', () => {
  const dir = B.resolveProjectDir({
    startDir: '/repo/sdk/utils',
    cwd: '/x',
    exists: (p) => p === '/repo/electron-main.cjs',
  });
  assert.strictEqual(dir, '/repo');
});

test('a .js entry still wins when both exist', () => {
  // Only dejavu is ESM; every other app keeps electron-main.js.
  assert.strictEqual(B.findEntry('/repo', () => true), '/repo/electron-main.js');
});

test('findEntry returns null when neither is present', () => {
  assert.strictEqual(B.findEntry('/repo', () => false), null);
});

test('the bundle extension follows the entry extension', () => {
  // A .js bundle in a "type": "module" package is parsed as ESM, and esbuild
  // emits CommonJS — the app would fail to boot.
  assert.strictEqual(B.outputFor('/repo/electron-main.js'), '/repo/electron-main.bundle.js');
  assert.strictEqual(B.outputFor('/repo/electron-main.cjs'), '/repo/electron-main.bundle.cjs');
});

test('ENTRY_NAMES lists both, in resolution order', () => {
  assert.deepStrictEqual(B.ENTRY_NAMES, ['electron-main.js', 'electron-main.cjs']);
});
