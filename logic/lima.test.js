'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const L = require('./lima');

const only = (...paths) => (p) => paths.includes(p);

// ─── VM listing ──────────────────────────────────────────────────────────

test('parseVmList reads JSONL — one object per line, not an array', () => {
  // A single JSON.parse of the whole blob works on a one-VM machine and fails
  // on every multi-VM one, which is exactly the case a clean-machine test
  // never reaches.
  const out = '{"name":"mc","status":"Running"}\n{"name":"coolify","status":"Stopped"}\n';
  const { vms, skipped } = L.parseVmList(out);
  assert.strictEqual(vms.length, 2);
  assert.deepStrictEqual(skipped, []);
});

test('parseVmList skips a malformed line, records it, and keeps the good ones', () => {
  const out = '{"name":"mc","status":"Running"}\nnot json\n{"name":"b","status":"Stopped"}\n';
  const { vms, skipped } = L.parseVmList(out);
  assert.strictEqual(vms.length, 2);
  assert.strictEqual(skipped.length, 1);
});

test('parseVmList tolerates empty and blank output', () => {
  for (const out of ['', '\n\n', null, undefined]) {
    assert.deepStrictEqual(L.parseVmList(out), { vms: [], skipped: [] }, String(out));
  }
});

test('vmStatus returns a STRING, never a boolean', () => {
  // Stopped, Broken and Absent each need different UI and a different remedy.
  assert.strictEqual(L.vmStatus('{"name":"mc","status":"Stopped"}\n', 'mc'), 'Stopped');
  assert.strictEqual(L.vmStatus('{"name":"mc","status":"Broken"}\n', 'mc'), 'Broken');
  assert.strictEqual(L.vmStatus('{"name":"other","status":"Running"}\n', 'mc'), 'Absent');
  assert.strictEqual(L.vmStatus('', 'mc'), 'Absent');
});

test('a VM entry with no status is Unknown, never Running', () => {
  // Defaulting to Running makes the app try to use a dead VM.
  assert.strictEqual(L.vmStatus('{"name":"mc"}\n', 'mc'), 'Unknown');
});

test('only Running counts as usable', () => {
  assert.strictEqual(L.isVmUsable('Running'), true);
  for (const s of ['Stopped', 'Broken', 'Absent', 'Unknown', '', null]) {
    assert.strictEqual(L.isVmUsable(s), false, String(s));
  }
});

// ─── limactl resolution ──────────────────────────────────────────────────

test('the bundled binary wins over anything installed', () => {
  // Behaviour must not change based on what the user happens to have.
  const found = L.resolveLimactl({
    bundledPath: '/app/lima-bin/limactl', exists: () => true, canRun: () => true,
  });
  assert.strictEqual(found, '/app/lima-bin/limactl');
});

test('a present-but-unrunnable binary does not abort the search', () => {
  // It is as useless as a missing one, so the search continues.
  const found = L.resolveLimactl({
    bundledPath: '/app/lima-bin/limactl',
    exists: only('/app/lima-bin/limactl', '/opt/homebrew/bin/limactl'),
    canRun: (p) => p === '/opt/homebrew/bin/limactl',
  });
  assert.strictEqual(found, '/opt/homebrew/bin/limactl');
});

test('Homebrew locations are reachable for a Finder-launched app', () => {
  // A GUI app inherits a launchd PATH without /opt/homebrew/bin, so a working
  // `brew install lima` was reported as "not installed".
  const found = L.resolveLimactl({
    bundledPath: null,
    exists: only('/opt/homebrew/bin/limactl'),
    canRun: (p) => p === '/opt/homebrew/bin/limactl',
  });
  assert.strictEqual(found, '/opt/homebrew/bin/limactl');
});

test('a bare limactl on PATH is used when nothing else resolves', () => {
  const found = L.resolveLimactl({
    bundledPath: null, exists: () => false, canRun: (p) => p === 'limactl',
  });
  assert.strictEqual(found, 'limactl');
});

test('resolveLimactl returns null when Lima is genuinely absent', () => {
  assert.strictEqual(
    L.resolveLimactl({ bundledPath: null, exists: () => false, canRun: () => false }), null);
});

// ─── homes and argv ──────────────────────────────────────────────────────

test('lima home is per app and short by necessity', () => {
  // Lima puts its control socket inside its home; macOS UNIX_PATH_MAX is 104
  // bytes and overrunning it fails as a confusing "socket path too long".
  assert.strictEqual(L.limaHome('/Users/x', '.mc-lima'), path.join('/Users/x', '.mc-lima'));
  assert.ok(L.limaHome('/Users/x', '.mc-lima').length < 40);
  assert.throws(() => L.limaHome('/Users/x'), TypeError);
});

test('limaEnv pins LIMA_HOME over an inherited value', () => {
  // The default (~/.lima) is a different path and a different set of VMs.
  const env = L.limaEnv('/Users/x', '.mc-lima', { LIMA_HOME: '/wrong', PATH: '/bin' });
  assert.strictEqual(env.LIMA_HOME, '/Users/x/.mc-lima');
  assert.strictEqual(env.PATH, '/bin');
});

test('nerdctl runs through the named VM with sudo', () => {
  // containerd runs as a system service in these VMs, not rootless.
  assert.deepStrictEqual(L.nerdctlArgs('mc', ['ps']), ['shell', 'mc', 'sudo', 'nerdctl', 'ps']);
  assert.throws(() => L.nerdctlArgs('mc', 'ps'), TypeError);
  assert.throws(() => L.nerdctlArgs('', ['ps']), TypeError);
});

test('the missing-Lima message names both remedies', () => {
  // Either genuinely fixes it, and which is right depends on whether the user
  // wants the app-local copy.
  const msg = L.missingLimaMessage({ downloadScript: 'npm run download:lima' });
  assert.ok(msg.includes('npm run download:lima'));
  assert.ok(msg.includes('brew install lima'));
});
