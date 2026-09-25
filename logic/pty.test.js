'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('./pty');

test('the helper path is rewritten out of the asar when packaged', () => {
  // python3 cannot execute a script inside the archive, which is why the file
  // is asarUnpack'd — and why the path must be rewritten to match.
  const packaged = P.resolveHelperPath('/App.app/Contents/Resources/app.asar', { isPackaged: true });
  assert.ok(packaged.includes('app.asar.unpacked'));
  assert.ok(packaged.endsWith('pty-helper.py'));
});

test('an unpackaged path is left alone', () => {
  const dev = P.resolveHelperPath('/repo', { isPackaged: false });
  assert.strictEqual(dev, '/repo/pty-helper.py');
});

test('a dev path that merely contains app.asar is still rewritten', () => {
  const p = P.resolveHelperPath('/x/app.asar/logic', { isPackaged: false });
  assert.ok(p.includes('app.asar.unpacked'), 'the rewrite follows the path, not just the flag');
});

function harness(overrides = {}) {
  const handlers = {};
  const listeners = {};
  const spawned = [];
  const sent = [];
  const child = {
    stdin: { written: [], write(d) { this.written.push(d); } },
    stdout: { on(_, fn) { this.fn = fn; } },
    stderr: { on() {} },
    on(ev, fn) { this[`on_${ev}`] = fn; },
    kill() { this.killed = true; },
    killed: false,
    pid: 4242,
  };
  P.registerPtyIpc(
    { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { listeners[ch] = fn; } },
    {
      getWindow: () => ({
        isDestroyed: () => false,
        webContents: { send: (ch, p) => sent.push([ch, p]) },
      }),
      command: 'claude',
      args: ['/mentat-mcbes'],
      cwd: '/home/u',
      env: { TERM: 'xterm-256color' },
      helperPath: '/repo/pty-helper.py',
      platform: 'darwin',
      deps: { spawn: (bin, a, o) => { spawned.push([bin, a, o]); return child; } },
      ...overrides,
    },
  );
  return { handlers, listeners, spawned, sent, child };
}

test('all four pty channels are attached', () => {
  const h = harness();
  assert.deepStrictEqual(Object.keys(h.handlers), ['pty:spawn']);
  assert.deepStrictEqual(Object.keys(h.listeners).sort(), ['pty:kill', 'pty:resize', 'pty:write']);
});

test('POSIX spawns the command through the python PTY helper', () => {
  // A real TTY without a native Node module.
  const h = harness();
  h.handlers['pty:spawn'](null, 80, 24, false);
  const [bin, args] = h.spawned[0];
  assert.strictEqual(bin, 'python3');
  assert.strictEqual(args[0], '/repo/pty-helper.py');
  assert.deepStrictEqual(args.slice(1), ['claude', '/mentat-mcbes']);
});

test('Windows spawns the command directly, with no helper', () => {
  const h = harness({ platform: 'win32' });
  h.handlers['pty:spawn'](null, 80, 24, false);
  assert.strictEqual(h.spawned[0][0], 'claude');
});

test('skipPerms prepends the flag ahead of the app slash command', () => {
  const h = harness();
  h.handlers['pty:spawn'](null, 80, 24, true);
  const args = h.spawned[0][1];
  assert.ok(args.includes('--dangerously-skip-permissions'));
  assert.ok(args.indexOf('--dangerously-skip-permissions') < args.indexOf('/mentat-mcbes'));
});

test('the terminal size reaches the child environment', () => {
  const h = harness();
  h.handlers['pty:spawn'](null, 120, 40, false);
  const { env } = h.spawned[0][2];
  assert.strictEqual(env.COLUMNS, '120');
  assert.strictEqual(env.LINES, '40');
  assert.strictEqual(env.TERM, 'xterm-256color');
});

test('a second spawn replaces the first rather than leaking it', () => {
  const h = harness();
  h.handlers['pty:spawn'](null, 80, 24, false);
  h.handlers['pty:spawn'](null, 80, 24, false);
  assert.strictEqual(h.child.killed, true);
});

test('pty:write only forwards strings', () => {
  const h = harness();
  h.handlers['pty:spawn'](null, 80, 24, false);
  h.listeners['pty:write'](null, 'ls\n');
  h.listeners['pty:write'](null, { evil: true });
  h.listeners['pty:write'](null, 42);
  assert.deepStrictEqual(h.child.stdin.written, ['ls\n']);
});

test('stdout is relayed to the renderer', () => {
  const h = harness();
  h.handlers['pty:spawn'](null, 80, 24, false);
  h.child.stdout.fn(Buffer.from('hello'));
  assert.deepStrictEqual(h.sent[0], ['pty:data', 'hello']);
});
