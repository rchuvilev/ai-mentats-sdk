'use strict';
//
// PATH construction and child-process helpers shared by the apps.
//
// WHY PATH IS PREPENDED
// --------------------
// A GUI app launched from Finder inherits a launchd PATH without
// `/opt/homebrew/bin`, `~/.local/bin` or `~/.bun/bin`, so `claude`, `bun` and
// `cloudflared` all read as "not installed" for anyone who did not start the
// app from a terminal. These entries go FIRST so the app's own install
// locations win over whatever else is on the machine.

const { execFileSync } = require('child_process');
const path = require('path');
const { quiet } = require('./failsafe');

function buildPath(home, platform = process.platform, envPath = process.env.PATH) {
  const isWin = platform === 'win32';
  const sep = isWin ? ';' : ':';
  const extra = [path.join(home, '.local', 'bin'), path.join(home, '.bun', 'bin')];
  if (isWin) {
    extra.push(
      path.join(home, 'AppData', 'Roaming', 'npm'),
      path.join(home, 'AppData', 'Local', 'Programs', 'claude-code'),
    );
  } else {
    extra.push('/opt/homebrew/bin', '/usr/local/bin');
  }
  // Guard the empty case: joining onto '' leaves a trailing separator, which
  // some shells read as the current directory.
  const base = envPath || (isWin ? '' : '/usr/bin:/bin');
  return base ? extra.join(sep) + sep + base : extra.join(sep);
}

/**
 * Environment for every child process an app spawns.
 * `extra` wins over `baseEnv` so a caller can pin a variable (lima.js pins
 * LIMA_HOME, which must not be inherited from the user's shell).
 */
function shellEnv({ home, platform = process.platform, baseEnv = process.env, extra = {} }) {
  return {
    ...baseEnv,
    ...extra,
    PATH: buildPath(home, platform, baseEnv.PATH),
  };
}

/**
 * Run a binary with an argument ARRAY — never a composed command string.
 * User input (an API key, a hostname) reaches several call sites, and a value
 * containing a shell metacharacter must be passed, not executed.
 *
 * `opts.exec` is injectable so callers are testable without spawning.
 */
function run(bin, args, opts = {}) {
  const { exec = execFileSync, ...rest } = opts;
  return exec(bin, args, { encoding: 'utf8', ...rest });
}

/** `run` for calls whose failure is expected and non-fatal. */
function tryRun(op, bin, args, opts = {}) {
  return quiet(op, () => run(bin, args, opts), null);
}

module.exports = { buildPath, shellEnv, run, tryRun };
