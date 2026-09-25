'use strict';
//
// Process termination and shutdown sequencing.
//
// These apps spawn DETACHED children (a server, a tunnel, a PTY), so a bare
// `proc.kill()` leaves the grandchildren running and the port bound. Killing
// the process group is what actually stops them.

const { attempt } = require('./failsafe');

/**
 * Terminate a child and its group: SIGTERM, then SIGKILL after a grace period.
 *
 * `run`, `kill` and `setTimeout` are injectable so this is testable without
 * spawning anything.
 */
function killProcess(proc, name, options = {}) {
  const {
    platform = process.platform,
    kill = process.kill.bind(process),
    run: runFn,
    setTimeout: schedule = setTimeout,
    log = console.log,
  } = options;

  if (!proc || proc.killed) return;
  log(`Terminating ${name} (pid ${proc.pid})...`);

  attempt(`kill.${name}.term`, () => {
    if (platform === 'win32') {
      if (runFn) runFn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      kill(-proc.pid, 'SIGTERM');
    }
  });

  schedule(() => {
    // Killing an already-dead process is the expected case here, so this stays
    // quiet by design rather than being recorded as a failure.
    try {
      if (!proc.killed) {
        if (platform !== 'win32') kill(-proc.pid, 'SIGKILL');
        proc.kill('SIGKILL');
      }
    } catch { /* already gone */ }
  }, 3000);
}

/**
 * Wrap a shutdown routine so it runs at most once.
 *
 * `window-all-closed`, `before-quit`, `SIGTERM` and the window's own `closed`
 * handler can all fire during a single shutdown; without this the body runs
 * four times and double-kills every child.
 */
function createCleanup(fn) {
  let done = false;
  return function cleanup(...args) {
    if (done) return undefined;
    done = true;
    return fn(...args);
  };
}

module.exports = { killProcess, createCleanup };
