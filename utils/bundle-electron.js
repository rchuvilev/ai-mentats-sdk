#!/usr/bin/env node
/**
 * Bundle an app's Electron main process with esbuild, resolving ESM-only
 * dependencies at build time.
 *
 * Usage: node sdk/utils/bundle-electron.js [project-dir]
 *
 * The project dir is normally found automatically; pass it explicitly only to
 * bundle a project other than the one this SDK is mounted inside.
 *
 * WHY THE DEFAULT IS A SEARCH AND NOT A FIXED PATH
 * ------------------------------------------------
 * This used to be:
 *
 *     const projectDir = process.argv[2] || path.resolve(__dirname, '..');
 *
 * `..` was the repo root back when the file lived at `__shared__/scripts/` in
 * the monorepo. Mounted as a submodule at `sdk/`, the file sits at
 * `sdk/utils/`, so `..` resolves to `<repo>/sdk` and esbuild was asked for
 * `<repo>/sdk/electron-main.js`, which does not exist:
 *
 *     ✘ [ERROR] Could not resolve ".../sdk/electron-main.js"
 *
 * Every consuming repo invokes this with no argument, so `npm run bundle`,
 * `npm run gui` and every `build:*` script were broken in all of them.
 *
 * Hardcoding `'..', '..'` instead would just move the same assumption one
 * level: it would break again under a different mount point (an npm install
 * puts this at `node_modules/ai-mentats-sdk/utils/`). So the project is located
 * by walking up from this file until a directory containing `electron-main.js`
 * is found, which is correct for both layouts and for any future one.
 */
'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Entry filenames every consuming app has at its root, in resolution order.
 * `.cjs` exists for an ESM package: dejavu sets `"type": "module"`, so its
 * CommonJS wrapper cannot be named `.js`.
 */
const ENTRY_NAMES = ['electron-main.js', 'electron-main.cjs'];
/** Kept so existing importers and tests referring to the singular still work. */
const ENTRY_NAME = ENTRY_NAMES[0];

/** The entry this project uses, or null. `.js` wins when both exist. */
function findEntry(dir, exists) {
  for (const name of ENTRY_NAMES) {
    const p = path.join(dir, name);
    if (exists(p)) return p;
  }
  return null;
}

/**
 * Bundle path for an entry. The extension is carried over: a `.js` bundle in a
 * `"type": "module"` package would be parsed as ESM while esbuild emits CJS,
 * so the app would fail to boot.
 */
function outputFor(entryPath) {
  const ext = path.extname(entryPath);
  return entryPath.slice(0, -ext.length) + '.bundle' + ext;
}

/**
 * Find the app directory to bundle.
 *
 * @param {object} [o]
 * @param {string} [o.arg]        explicit project dir (argv[2]); wins outright
 * @param {string} [o.startDir]   where to begin the walk (default: this file's dir)
 * @param {string} [o.cwd]        last-resort candidate (default: process.cwd())
 * @param {(p: string) => boolean} [o.exists]  injectable for tests
 * @returns {string} absolute path to the project dir
 * @throws when no candidate holds an electron-main.js — a clear message beats
 *         an esbuild "could not resolve" pointing at a path nobody chose.
 */
function resolveProjectDir(o = {}) {
  const exists = o.exists || ((p) => fs.existsSync(p));
  const startDir = o.startDir || __dirname;
  const cwd = o.cwd || process.cwd();

  // An explicit argument is taken as given: the caller may be bundling a
  // project that does not exist yet on disk, and second-guessing them here
  // would make the override useless.
  if (o.arg) return path.resolve(o.arg);

  // Walk up from this file. `sdk/utils` -> `sdk` -> `<repo>` finds the repo in
  // the submodule layout; `node_modules/ai-mentats-sdk/utils` -> ... -> `<repo>`
  // finds it in the npm layout.
  let dir = path.resolve(startDir);
  for (;;) {
    if (findEntry(dir, exists) !== null) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  if (findEntry(cwd, exists) !== null) return path.resolve(cwd);

  throw new Error(
    `bundle-electron: no ${ENTRY_NAMES.join(' or ')} found.\n`
    + `  Searched upwards from ${path.resolve(startDir)} and in ${path.resolve(cwd)}.\n`
    + `  Run this from a consuming app, or pass the project dir:\n`
    + '    node sdk/utils/bundle-electron.js /path/to/app',
  );
}

/**
 * Renderer-side files the SDK owns, copied into the app so `app.html` can load
 * them by a stable name.
 *
 * `ui/update-bar.js` is copied to `update-ui.js` because that is the filename
 * the consuming apps' `app.html` already references and their `.gitignore`
 * already excludes. Previously the copy looked for `update-ui.js` *inside
 * `utils/`*, where it has never existed, so the loop silently copied nothing
 * and every app's `<script src="update-ui.js">` 404'd — the "Restart to
 * update" bar simply never appeared, with no error to notice it by.
 */
const RENDERER_FILES = [{ from: path.join('..', 'ui', 'update-bar.js'), to: 'update-ui.js' }];

function copyRendererFiles(projectDir, log = console.log) {
  const copied = [];
  for (const file of RENDERER_FILES) {
    const src = path.resolve(__dirname, file.from);
    const dst = path.join(projectDir, file.to);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, dst);
    copied.push(file.to);
    log(`Copied ${file.to} -> ${projectDir}/`);
  }
  return copied;
}

/**
 * Packages that must not be inlined. Beyond electron itself this covers
 * optional native/ESM dependencies: node-llama-cpp and friends ship
 * platform-specific binary bindings behind dynamic imports and use top-level
 * await, neither of which survives a CJS bundle. They are resolved from
 * node_modules at runtime instead, and every call site already guards with
 * require.resolve so the app degrades cleanly when they are absent.
 *
 * Each app declares its own additions via "bundleExternal" in package.json.
 */
const ALWAYS_EXTERNAL = ['electron', 'electron-updater'];

function externalsFor(projectDir) {
  let declared = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    declared = pkg.bundleExternal || [];
    // Optional dependencies are external by definition: they may not be installed.
    declared = declared.concat(Object.keys(pkg.optionalDependencies || {}));
  } catch {
    // No package.json is not fatal here — the defaults still produce a bundle.
  }
  return [...new Set([...ALWAYS_EXTERNAL, ...declared])];
}

function main() {
  const projectDir = resolveProjectDir({ arg: process.argv[2] });
  const entry = findEntry(projectDir, (p) => fs.existsSync(p));
  const out = outputFor(entry);

  copyRendererFiles(projectDir);

  const external = externalsFor(projectDir);
  if (external.length > ALWAYS_EXTERNAL.length) {
    console.log(`External (resolved at runtime): ${external.slice(ALWAYS_EXTERNAL.length).join(', ')}`);
  }

  // Required lazily so this file can be imported for its helpers without
  // esbuild installed.
  const { buildSync } = require('esbuild');
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: out,
    external,
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  });

  if (result.errors.length) {
    console.error('Bundle failed');
    process.exit(1);
  }
}

module.exports = {
  resolveProjectDir, copyRendererFiles, externalsFor, findEntry, outputFor,
  ENTRY_NAME, ENTRY_NAMES, ALWAYS_EXTERNAL, RENDERER_FILES,
};

// Only build when run as a script, so the helpers above are testable.
if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
