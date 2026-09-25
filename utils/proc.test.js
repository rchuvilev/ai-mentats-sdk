'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('./proc');

const fakeProc = (pid = 1234) => ({ pid, killed: false, kill() { this.killed = true; } });

test('a POSIX kill targets the process GROUP, not the pid', () => {
  // These apps spawn detached children that outlive a bare kill; the negative
  // pid is what takes the whole group down.
  const signals = [];
  P.killProcess(fakeProc(555), 'server', {
    platform: 'darwin',
    kill: (pid, sig) => signals.push([pid, sig]),
    setTimeout: () => {},
    log: () => {},
  });
  assert.deepStrictEqual(signals, [[-555, 'SIGTERM']]);
});

test('on Windows it shells out to taskkill with the process tree', () => {
  const calls = [];
  P.killProcess(fakeProc(777), 'server', {
    platform: 'win32',
    run: (bin, args) => calls.push([bin, args]),
    setTimeout: () => {},
    log: () => {},
  });
  assert.strictEqual(calls[0][0], 'taskkill');
  assert.ok(calls[0][1].includes('/T'), '/T kills the child tree');
  assert.ok(calls[0][1].includes('777'));
});

test('an already-killed process is left alone', () => {
  const proc = fakeProc();
  proc.killed = true;
  let called = false;
  P.killProcess(proc, 'x', {
    platform: 'darwin', kill: () => { called = true; }, setTimeout: () => {}, log: () => {},
  });
  assert.strictEqual(called, false);
});

test('a null process is not an error', () => {
  assert.doesNotThrow(() => P.killProcess(null, 'x', { setTimeout: () => {}, log: () => {} }));
});

test('SIGKILL follows after the grace period if the process survives', () => {
  const signals = [];
  let scheduled = null;
  P.killProcess(fakeProc(42), 'x', {
    platform: 'darwin',
    kill: (pid, sig) => signals.push([pid, sig]),
    setTimeout: (fn, ms) => { scheduled = { fn, ms }; },
    log: () => {},
  });
  assert.strictEqual(scheduled.ms, 3000);
  scheduled.fn();
  assert.deepStrictEqual(signals, [[-42, 'SIGTERM'], [-42, 'SIGKILL']]);
});

test('a kill failure is suppressed, not thrown', () => {
  // Killing an already-dead process is the expected case, not an incident.
  assert.doesNotThrow(() => P.killProcess(fakeProc(1), 'x', {
    platform: 'darwin',
    kill: () => { throw new Error('ESRCH'); },
    setTimeout: () => {},
    log: () => {},
  }));
});

test('cleanup runs exactly once however many times it is called', () => {
  // window-all-closed, before-quit, SIGTERM and the window close handler can
  // all fire in one shutdown; running the body four times double-kills.
  let runs = 0;
  const cleanup = P.createCleanup(() => { runs += 1; });
  cleanup(); cleanup(); cleanup();
  assert.strictEqual(runs, 1);
});
