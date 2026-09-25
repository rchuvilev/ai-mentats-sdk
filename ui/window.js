'use strict';
//
// One window factory for five apps. They differ only in size, title and one
// background colour, so a config object genuinely serves all of them rather
// than replacing five readable functions with a bigger one plus five configs.
//
// TWO RULES THIS FILE ENFORCES
// ----------------------------
// 1. Secure defaults. An app may override one explicitly — coolify still needs
//    `webSecurity: false` and cannot be GUI-verified, so it opts out in one
//    visible place instead of being silently hardened.
// 2. DevTools never open by themselves, and no config key turns that back on.
//    Electron already binds Cmd+Opt+I, so a flag would be machinery for what
//    the platform provides — and a self-opening inspector is noise in every
//    screenshot and every driven GUI session.

const SECURE_DEFAULTS = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,           // all five rely on a preload that needs it
  webSecurity: true,
  allowRunningInsecureContent: false,
});

function buildWebPreferences(overrides = {}, preload) {
  return { ...SECURE_DEFAULTS, ...overrides, preload };
}

/**
 * Rewrite response headers for an embedded origin.
 * Apps that put a localhost service in an iframe must drop its framing
 * headers and loosen its cookies — but only for that origin.
 */
function rewriteHeaders(responseHeaders, { stripFrameHeaders = false, sameSiteNone = false } = {}) {
  const headers = { ...responseHeaders };
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (stripFrameHeaders && (lower === 'x-frame-options' || lower === 'content-security-policy')) {
      delete headers[key];
    }
    if (sameSiteNone && lower === 'set-cookie') {
      headers[key] = headers[key].map((cookie) => (
        /samesite/i.test(cookie)
          ? cookie.replace(/samesite=\w+/i, 'SameSite=None')
          : `${cookie}; SameSite=None; Secure`
      ));
    }
  }
  return headers;
}

function createWindow(config) {
  const {
    BrowserWindow, width, height, minWidth, minHeight, title, icon, backgroundColor,
    preload, load, webPreferences = {}, headerRewrite = null, onReady = null,
  } = config;

  if (!load || (!load.file && !load.url)) {
    throw new Error('createWindow: load must be { file } or { url }');
  }

  const options = {
    width,
    height,
    title,
    show: false,   // shown on ready-to-show, so no white flash
    webPreferences: buildWebPreferences(webPreferences, preload),
  };
  // A window that can be dragged smaller than its layout survives is a real
  // usability bug, so the floor passes through when an app sets one.
  if (minWidth) options.minWidth = minWidth;
  if (minHeight) options.minHeight = minHeight;
  if (icon) options.icon = icon;
  if (backgroundColor) options.backgroundColor = backgroundColor;

  const win = new BrowserWindow(options);

  if (headerRewrite) {
    if (!Array.isArray(headerRewrite.urls) || headerRewrite.urls.length === 0) {
      throw new Error('createWindow: headerRewrite.urls is required — never rewrite <all_urls>');
    }
    win.webContents.session.webRequest.onHeadersReceived(
      { urls: headerRewrite.urls },
      (details, callback) => callback({
        responseHeaders: rewriteHeaders(details.responseHeaders, headerRewrite),
      }),
    );
  }

  if (load.file) win.loadFile(load.file);
  else win.loadURL(load.url);

  win.once('ready-to-show', () => {
    win.show();
    // No openDevTools call, and no branch that could add one.
    if (onReady) onReady(win);
  });

  return win;
}

module.exports = { SECURE_DEFAULTS, buildWebPreferences, rewriteHeaders, createWindow };
