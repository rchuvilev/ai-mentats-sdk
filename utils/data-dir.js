/**
 * Resolve an app's on-disk data directory.
 *
 * Contract (single source of truth for every ai-mentat app):
 *     <root>/.hexstack-app/<app-name>/data
 *
 * where <root> is the FILESYSTEM ROOT, so on POSIX this is literally
 * `/.hexstack-app/<app-name>/data` and on Windows it is the root of the
 * system drive, e.g. `C:\.hexstack-app\<app-name>\data`.
 *
 * Why a shared helper and not `app.getPath('userData')` in each repo:
 * the four apps previously each resolved their own private directory
 * (`userData/.mentat-rbxs`, `userData/.local-studio`, ...). One helper means
 * the layout is defined once and every app moves together.
 *
 * Root-level paths are NOT writable by an unprivileged user on most systems.
 * `ensureDataDir()` therefore reports failure rather than throwing deep inside
 * app startup, so callers can surface a real message instead of crashing.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

/** Filesystem root: '/' on POSIX, 'C:\\' (or wherever the OS lives) on Windows. */
function systemRoot() {
  if (process.platform === 'win32') {
    // SystemDrive is 'C:' -> path.sep makes it 'C:\'. Fall back to parsing cwd.
    const drive = process.env.SystemDrive || path.parse(process.cwd()).root;
    return drive.endsWith(path.sep) ? drive : drive + path.sep;
  }
  return path.sep;
}

/** `<root>/.hexstack-app/<appName>` — the app's home, data dir's parent. */
function appHome(appName) {
  if (!appName || typeof appName !== 'string') {
    throw new TypeError('appHome(appName): appName must be a non-empty string');
  }
  // Guard the trust boundary: appName lands in a filesystem path.
  if (appName.includes('/') || appName.includes('\\') || appName.includes('..')) {
    throw new TypeError(`appHome(appName): unsafe app name ${JSON.stringify(appName)}`);
  }
  return path.join(systemRoot(), '.hexstack-app', appName);
}

/** `<root>/.hexstack-app/<appName>/data` — where the app stores everything. */
function dataDir(appName) {
  return path.join(appHome(appName), 'data');
}

/**
 * Create the data dir if missing.
 * @returns {{ok: true, dir: string} | {ok: false, dir: string, error: Error, fallback: string}}
 * On failure a per-user fallback is returned so an app can still run when the
 * filesystem root is read-only (CI, sandboxes, locked-down corporate machines).
 */
function ensureDataDir(appName) {
  const dir = dataDir(appName);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return { ok: true, dir };
  } catch (error) {
    return { ok: false, dir, error, fallback: path.join(os.homedir(), '.hexstack-app', appName, 'data') };
  }
}

/**
 * The path an app should actually use: the root location when writable,
 * otherwise the home-dir fallback. Always returns a usable, existing directory.
 */
function resolveDataDir(appName) {
  const r = ensureDataDir(appName);
  if (r.ok) return r.dir;
  fs.mkdirSync(r.fallback, { recursive: true });
  return r.fallback;
}

module.exports = { systemRoot, appHome, dataDir, ensureDataDir, resolveDataDir };
