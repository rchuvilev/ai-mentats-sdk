'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('./tunnel-ipc');

function harness(overrides = {}) {
  const handlers = {};
  const sent = [];
  const files = { ...(overrides.files || {}) };
  const calls = [];
  const settingsData = {};
  const config = {
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (ch, p) => sent.push([ch, p]) },
    }),
    tunnelName: 'mentat',
    services: [{ name: 'web', scheme: 'http', port: 5678 }],
    settings: { load: () => ({ ...settingsData }), save: (p) => Object.assign(settingsData, p) },
    configPath: '/home/u/.cloudflared/config.yml',
    credentialsDir: '/home/u/.cloudflared',
    deps: {
      run: (bin, args) => { calls.push([bin, ...args]); return overrides.runOut || ''; },
      tryRun: (op, bin, args) => { calls.push([bin, ...args]); return overrides.tryRunOut ?? ''; },
      spawn: () => ({
        stdout: { on() {} }, stderr: { on() {} }, on() {}, kill() {}, killed: false,
      }),
      fs: {
        existsSync: (p) => p in files,
        readFileSync: (p) => files[p],
        writeFileSync: (p, d) => { files[p] = d; },
        mkdirSync: () => {},
      },
    },
    ...overrides.config,
  };
  R.registerTunnelIpc({ handle: (ch, fn) => { handlers[ch] = fn; } }, config);
  return { handlers, sent, files, calls, settingsData };
}

test('all nine channels are attached', () => {
  const h = harness();
  assert.deepStrictEqual(Object.keys(h.handlers).sort(), [
    'cloudflared:auth-status', 'cloudflared:check', 'cloudflared:install',
    'cloudflared:login', 'cloudflared:setup-tunnel', 'cloudflared:tunnel-status',
    'tunnel:start', 'tunnel:status', 'tunnel:stop',
  ]);
});

test('auth-status reports on the presence of cert.pem', async () => {
  const absent = harness();
  assert.strictEqual((await absent.handlers['cloudflared:auth-status']()).authenticated, false);
  const present = harness({ files: { '/home/u/.cloudflared/cert.pem': '' } });
  assert.strictEqual((await present.handlers['cloudflared:auth-status']()).authenticated, true);
});

test('tunnel-status reads the real config and reports every service', async () => {
  const h = harness({
    files: {
      '/home/u/.cloudflared/config.yml': `tunnel: abc
ingress:
  - hostname: n8n.example.com
    service: http://localhost:5678
  - service: http_status:404
`,
    },
  });
  const r = await h.handlers['cloudflared:tunnel-status']();
  assert.strictEqual(r.configured, true);
  assert.strictEqual(r.tunnelName, 'abc');
  assert.deepStrictEqual(r.hostnames, { web: 'n8n.example.com' });
  assert.strictEqual(r.hostname, 'n8n.example.com',
    'the primary hostname is also returned singular: renderers that predate '
    + 'multi-service tunnels read that form');
});

test('tunnel-status reports the FIRST service as the primary hostname', async () => {
  const h = harness({
    config: {
      services: [
        { name: 'web', scheme: 'http', port: 8000 },
        { name: 'ssh', scheme: 'ssh', port: 2222 },
      ],
    },
    files: {
      '/home/u/.cloudflared/config.yml': `tunnel: abc
ingress:
  - hostname: app.example.com
    service: http://localhost:8000
  - hostname: ssh.example.com
    service: ssh://localhost:2222
  - service: http_status:404
`,
    },
  });
  const r = await h.handlers['cloudflared:tunnel-status']();
  assert.strictEqual(r.hostname, 'app.example.com');
  assert.deepStrictEqual(r.hostnames, { web: 'app.example.com', ssh: 'ssh.example.com' });
});

test('setup-tunnel refuses an invalid hostname before running anything', async () => {
  const h = harness();
  const r = await h.handlers['cloudflared:setup-tunnel'](null, 'evil.com; rm -rf /');
  assert.strictEqual(r.success, false);
  assert.match(r.error, /not a valid hostname/);
  assert.deepStrictEqual(h.calls, [], 'nothing was executed');
});

test('setup-tunnel refuses an empty hostname', async () => {
  const h = harness();
  assert.strictEqual((await h.handlers['cloudflared:setup-tunnel'](null, '   ')).success, false);
  assert.strictEqual((await h.handlers['cloudflared:setup-tunnel'](null, null)).success, false);
});

test('setup-tunnel writes one ingress entry per declared service', async () => {
  const h = harness({
    config: {
      services: [
        { name: 'web', scheme: 'http', port: 8000 },
        { name: 'ssh', scheme: 'ssh', port: 2222 },
      ],
    },
    runOut: 'Created tunnel mentat with id 8f1c9e64-1111-2222-3333-444455556666',
  });
  const r = await h.handlers['cloudflared:setup-tunnel'](null, 'app.example.com');
  assert.strictEqual(r.success, true);
  const written = h.files['/home/u/.cloudflared/config.yml'];
  assert.ok(written.includes('service: http://localhost:8000'));
  assert.ok(written.includes('service: ssh://localhost:2222'),
    'coolify needs both entries; one would half-route the tunnel');
});

test('setup-tunnel persists the domain so the app can hand it to a child', async () => {
  const h = harness({ runOut: 'id 8f1c9e64-1111-2222-3333-444455556666' });
  await h.handlers['cloudflared:setup-tunnel'](null, 'n8n.example.com');
  assert.strictEqual(h.settingsData.publicDomain, 'n8n.example.com');
});

test('setup-tunnel passes the hostname as an argv entry, not a shell string', async () => {
  const h = harness({ runOut: 'id 8f1c9e64-1111-2222-3333-444455556666' });
  await h.handlers['cloudflared:setup-tunnel'](null, 'n8n.example.com');
  const dns = h.calls.find((c) => c.includes('route'));
  assert.ok(dns, 'a DNS route is created');
  assert.ok(dns.includes('n8n.example.com'), 'the hostname is its own argv entry');
});

test('tunnel:start refuses when nothing is configured', async () => {
  const h = harness();
  const r = await h.handlers['tunnel:start']();
  assert.strictEqual(r.success, false);
  assert.match(r.error, /No tunnel configured/);
});

test('tunnel:status reports not-running before a start', async () => {
  const h = harness();
  assert.deepStrictEqual(await h.handlers['tunnel:status'](), { running: false, url: null });
});
