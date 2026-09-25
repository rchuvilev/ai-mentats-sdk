'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('./shell');

function harness() {
  const handlers = {};
  const opened = [];
  return {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    shell: {
      openExternal: async (u) => { opened.push(u); },
      openPath: async (p) => { opened.push(p); },
    },
    handlers,
    opened,
  };
}

test('an https url is opened', async () => {
  const h = harness();
  S.registerOpenExternal(h.ipcMain, h.shell);
  const r = await h.handlers['shell:open-external'](null, 'https://hexstack.app/');
  assert.strictEqual(r.success, true);
  assert.deepStrictEqual(h.opened, ['https://hexstack.app/']);
});

test('every other scheme is refused', async () => {
  // A renderer-supplied string reaching openExternal can otherwise launch
  // file:// or a custom protocol handler registered on the machine.
  const h = harness();
  S.registerOpenExternal(h.ipcMain, h.shell);
  for (const url of [
    'file:///etc/passwd',
    'http://insecure.example',
    'javascript:alert(1)',
    'vscode://file/etc/passwd',
    'data:text/html,<script>1</script>',
  ]) {
    const r = await h.handlers['shell:open-external'](null, url);
    assert.strictEqual(r.success, false, url);
  }
  assert.deepStrictEqual(h.opened, [], 'nothing was launched');
});

test('a non-string or unparseable value is refused without throwing', async () => {
  const h = harness();
  S.registerOpenExternal(h.ipcMain, h.shell);
  for (const bad of [null, undefined, 42, {}, 'not a url', '']) {
    const r = await h.handlers['shell:open-external'](null, bad);
    assert.strictEqual(r.success, false, String(bad));
  }
});

test('the channel name is overridable but defaults to the family name', async () => {
  const h = harness();
  S.registerOpenExternal(h.ipcMain, h.shell);
  assert.ok(h.handlers['shell:open-external'], 'all five apps already use this name');
  const h2 = harness();
  S.registerOpenExternal(h2.ipcMain, h2.shell, { channel: 'shell:open-url' });
  assert.ok(h2.handlers['shell:open-url']);
});

test('openPathHandler opens the path it was built with, taking none from the renderer', async () => {
  // The renderer never passes a filesystem path across the bridge.
  const h = harness();
  const handler = S.openPathHandler(h.shell, '/data/logs');
  const r = await handler(null, '/etc');
  assert.strictEqual(r.success, true);
  assert.deepStrictEqual(h.opened, ['/data/logs'], 'the renderer argument is ignored');
});
