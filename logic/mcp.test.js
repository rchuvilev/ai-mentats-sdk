'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const M = require('./mcp');

test('a user-scope registration is detected', () => {
  assert.strictEqual(M.detectMcpInstalled({ mcpServers: { 'n8n-mcp': {} } }, 'n8n-mcp'), true);
});

test('a PROJECT-scope registration is detected too', () => {
  // Reporting "not installed" here made the Install button re-run and
  // duplicate the registration.
  assert.strictEqual(
    M.detectMcpInstalled({ projects: { '/p': { mcpServers: { minecraft: {} } } } }, 'minecraft'), true);
});

test('an unrelated server is not a match', () => {
  assert.strictEqual(M.detectMcpInstalled({ mcpServers: { other: {} } }, 'n8n-mcp'), false);
  assert.strictEqual(
    M.detectMcpInstalled({ projects: { p: { mcpServers: { other: {} } } } }, 'n8n-mcp'), false);
});

test('raw JSON text is accepted and a broken file reads as not-installed', () => {
  assert.strictEqual(M.detectMcpInstalled('{"mcpServers":{"x":{}}}', 'x'), true);
  for (const bad of ['{ truncated', '', null, undefined, 'null', 42, { projects: 'nope' }]) {
    assert.strictEqual(M.detectMcpInstalled(bad, 'x'), false, String(bad));
  }
});

test('removeAllScopes clears user, local and project', () => {
  const calls = [];
  M.removeAllScopes('n8n-mcp', { run: (bin, args) => calls.push(args.join(' ')) });
  assert.deepStrictEqual(M.MCP_SCOPES, ['user', 'local', 'project']);
  assert.strictEqual(calls.length, 3);
  for (const scope of M.MCP_SCOPES) {
    assert.ok(calls.some((c) => c.includes(`-s ${scope}`)), scope);
  }
});

test('a scope that fails to clear does not abort the others', () => {
  // The usual reason a remove fails is that nothing was registered there.
  let n = 0;
  M.removeAllScopes('x', {
    run: () => { n += 1; if (n === 1) throw new Error('not found'); },
  });
  assert.strictEqual(n, 3);
});

function harness(overrides = {}) {
  const handlers = {};
  const calls = [];
  const files = { ...(overrides.files || {}) };
  const settingsData = {};
  M.registerMcpIpc({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    serverName: 'minecraft',
    addArgs: ['mcp', 'add', 'minecraft', '-s', 'user', '--', 'node', '/app/server.mjs'],
    commandFile: '/home/u/.claude/commands/mentat-mcbes.md',
    commandBody: '---\nname: mentat-mcbes\n---\n',
    claudeJsonPath: '/home/u/.claude.json',
    settings: { load: () => ({ ...settingsData }), save: (p) => Object.assign(settingsData, p) },
    deps: {
      run: (bin, args) => { calls.push([bin, ...args]); return ''; },
      fs: {
        existsSync: (p) => p in files,
        readFileSync: (p) => files[p],
        writeFileSync: (p, d) => { files[p] = d; },
        mkdirSync: () => {},
      },
    },
    ...overrides.config,
  });
  return { handlers, calls, files, settingsData };
}

test('the three mcp channels are attached', () => {
  assert.deepStrictEqual(Object.keys(harness().handlers).sort(),
    ['mcp:install', 'mcp:status', 'mcp:uninstall']);
});

test('install registers with the exact argv the app supplied', async () => {
  const h = harness();
  const r = await h.handlers['mcp:install']();
  assert.strictEqual(r.success, true);
  const add = h.calls.find((c) => c[0] === 'claude' && c.includes('add'));
  assert.deepStrictEqual(add,
    ['claude', 'mcp', 'add', 'minecraft', '-s', 'user', '--', 'node', '/app/server.mjs'],
    'the argv array is passed through untouched — never joined into a shell string');
});

test('install writes the slash-command doc and records the flag', async () => {
  const h = harness();
  await h.handlers['mcp:install']();
  assert.ok(h.files['/home/u/.claude/commands/mentat-mcbes.md'].includes('mentat-mcbes'));
  assert.strictEqual(h.settingsData.mcpInstalled, true);
});

test('status trusts the on-disk registration over the stored flag', async () => {
  const h = harness({ files: { '/home/u/.claude.json': '{"mcpServers":{"minecraft":{}}}' } });
  assert.strictEqual((await h.handlers['mcp:status']()).mcpInstalled, true);
});

test('status reads not-installed on a clean machine', async () => {
  assert.strictEqual((await harness().handlers['mcp:status']()).mcpInstalled, false);
});

test('extraInstall runs after a successful registration', async () => {
  let ran = false;
  const h = harness({ config: { extraInstall: () => { ran = true; } } });
  await h.handlers['mcp:install']();
  assert.strictEqual(ran, true, 'n8n clones its skills pack here; no other app has one');
});

test('uninstall clears every scope and the flag', async () => {
  const h = harness();
  await h.handlers['mcp:install']();
  await h.handlers['mcp:uninstall']();
  assert.strictEqual(h.settingsData.mcpInstalled, false);
});
