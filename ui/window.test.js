'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const W = require('./window');

/**
 * Minimal BrowserWindow double. The plan's sketch assigned
 * `webContents.session` twice; this is the corrected single assignment.
 */
function FakeBrowserWindow(opts) {
  this.opts = opts;
  this.loaded = null;
  this.handlers = {};
  this.shown = false;
  this.headerFilter = null;
  this.headerCallback = null;

  const win = this;
  this.webContents = {
    openDevToolsCalled: false,
    openDevTools() { this.openDevToolsCalled = true; },
    on() {},
    session: {
      webRequest: {
        onHeadersReceived(filter, cb) {
          win.headerFilter = filter;
          win.headerCallback = cb;
        },
      },
    },
  };

  this.loadFile = (f) => { this.loaded = { file: f }; };
  this.loadURL = (u) => { this.loaded = { url: u }; };
  this.once = (ev, fn) => { this.handlers[ev] = fn; };
  this.on = (ev, fn) => { this.handlers[ev] = fn; };
  this.show = () => { this.shown = true; };
  this.isDestroyed = () => false;
}

const base = {
  BrowserWindow: FakeBrowserWindow,
  width: 1200,
  height: 800,
  title: 'T',
  preload: '/p.js',
  load: { file: '/a.html' },
};

test('the secure defaults are applied', () => {
  const win = W.createWindow({ ...base });
  const wp = win.opts.webPreferences;
  assert.strictEqual(wp.nodeIntegration, false);
  assert.strictEqual(wp.contextIsolation, true);
  assert.strictEqual(wp.webSecurity, true);
  assert.strictEqual(wp.allowRunningInsecureContent, false);
  assert.strictEqual(wp.preload, '/p.js');
});

test('DevTools are NEVER opened automatically', () => {
  // Five apps used to run `if (!app.isPackaged) openDevTools()`. There is no
  // option to restore it: Electron already binds Cmd+Opt+I, and a
  // self-opening inspector is noise in every screenshot.
  const win = W.createWindow({ ...base });
  win.handlers['ready-to-show']();
  assert.strictEqual(win.webContents.openDevToolsCalled, false);
});

test('there is no config key that turns DevTools back on', () => {
  const win = W.createWindow({ ...base, openDevTools: true, devTools: true });
  win.handlers['ready-to-show']();
  assert.strictEqual(win.webContents.openDevToolsCalled, false);
});

test('an app can override a default, and coolify must do so explicitly', () => {
  // coolify still needs webSecurity:false and cannot be GUI-verified here, so
  // it opts out in one visible place rather than being silently hardened.
  const win = W.createWindow({ ...base, webPreferences: { webSecurity: false } });
  assert.strictEqual(win.opts.webPreferences.webSecurity, false);
  assert.strictEqual(win.opts.webPreferences.contextIsolation, true,
    'the other defaults still hold');
});

test('load takes a file or a url — dejavu points at a local server', () => {
  assert.deepStrictEqual(W.createWindow({ ...base }).loaded, { file: '/a.html' });
  assert.deepStrictEqual(
    W.createWindow({ ...base, load: { url: 'http://127.0.0.1:8772/' } }).loaded,
    { url: 'http://127.0.0.1:8772/' });
});

test('createWindow rejects a load with neither', () => {
  assert.throws(() => W.createWindow({ ...base, load: {} }), /load/);
  assert.throws(() => W.createWindow({ ...base, load: undefined }), /load/);
});

test('size, title and backgroundColor pass through', () => {
  const win = W.createWindow({
    ...base, width: 1240, height: 860, title: 'X', backgroundColor: '#101018',
  });
  assert.strictEqual(win.opts.width, 1240);
  assert.strictEqual(win.opts.height, 860);
  assert.strictEqual(win.opts.title, 'X');
  assert.strictEqual(win.opts.backgroundColor, '#101018');
  assert.strictEqual(win.opts.show, false, 'shown on ready-to-show, not before');
});

test('a minimum size passes through when an app sets one', () => {
  const win = W.createWindow({ ...base, minWidth: 940, minHeight: 640 });
  assert.strictEqual(win.opts.minWidth, 940);
  assert.strictEqual(win.opts.minHeight, 640);
  // and is absent, not undefined, when it does not
  assert.ok(!('minWidth' in W.createWindow({ ...base }).opts));
});

test('rewriteHeaders strips only the framing headers it is asked to', () => {
  const out = W.rewriteHeaders(
    {
      'X-Frame-Options': ['DENY'],
      'Content-Security-Policy': ["frame-ancestors 'none'"],
      'X-Other': ['keep'],
    },
    { stripFrameHeaders: true },
  );
  assert.ok(!('X-Frame-Options' in out));
  assert.ok(!('Content-Security-Policy' in out));
  assert.deepStrictEqual(out['X-Other'], ['keep']);
});

test('rewriteHeaders sets SameSite=None only when asked', () => {
  const cookie = { 'Set-Cookie': ['a=1; HttpOnly'] };
  assert.deepStrictEqual(W.rewriteHeaders(cookie, {})['Set-Cookie'], ['a=1; HttpOnly']);
  const out = W.rewriteHeaders(cookie, { sameSiteNone: true });
  assert.match(out['Set-Cookie'][0], /SameSite=None/);
});

test('an existing SameSite is replaced, not appended twice', () => {
  const out = W.rewriteHeaders({ 'Set-Cookie': ['a=1; SameSite=Lax'] }, { sameSiteNone: true });
  assert.strictEqual(out['Set-Cookie'][0].match(/SameSite/g).length, 1);
});

test('header rewriting is scoped to the urls it is given, never <all_urls>', () => {
  // coolify strips CSP for EVERY url it can load. The filter is required here.
  const win = W.createWindow({
    ...base,
    headerRewrite: { urls: ['http://localhost:8000/*'], stripFrameHeaders: true },
  });
  assert.deepStrictEqual(win.headerFilter, { urls: ['http://localhost:8000/*'] });
  assert.throws(
    () => W.createWindow({ ...base, headerRewrite: { stripFrameHeaders: true } }),
    /urls/,
    'a rewrite with no url filter is refused');
});

test('the registered header callback actually rewrites', () => {
  const win = W.createWindow({
    ...base,
    headerRewrite: { urls: ['http://localhost:8000/*'], stripFrameHeaders: true },
  });
  let result = null;
  win.headerCallback({ responseHeaders: { 'X-Frame-Options': ['DENY'] } }, (r) => { result = r; });
  assert.ok(!('X-Frame-Options' in result.responseHeaders));
});
