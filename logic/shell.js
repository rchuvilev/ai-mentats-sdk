'use strict';
//
// Guarded shell operations.
//
// Only `open-external` is shared, because it carries real logic: a
// renderer-supplied string reaching `shell.openExternal` can launch `file://`
// or any custom protocol handler registered on the machine, so the scheme is
// allowlisted.
//
// Opening a local folder is deliberately NOT unified into one channel. The
// apps name it differently today (`shell:open-logs-dir`, `shell:open-n8n-data`,
// `shell:open-data`) and each handler is a single `shell.openPath(dir)` call.
// A generic channel plus a name->path registry would mean editing five preloads
// and five renderers for no behaviour change. `openPathHandler` gives them a
// shared BODY while each keeps its own channel name.

const HTTPS = 'https:';

/** Attach an https-only external-link handler. */
function registerOpenExternal(ipcMain, shell, { channel = 'shell:open-external' } = {}) {
  ipcMain.handle(channel, async (_, url) => {
    if (typeof url !== 'string') return { success: false };
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { success: false };
    }
    if (parsed.protocol !== HTTPS) return { success: false };
    await shell.openExternal(parsed.toString());
    return { success: true };
  });
}

/**
 * A handler body that opens ONE fixed path.
 * The path is bound at registration, so the renderer cannot choose it — it
 * never passes a filesystem path across the bridge.
 */
function openPathHandler(shell, dirPath) {
  return async () => {
    await shell.openPath(dirPath);
    return { success: true };
  };
}

module.exports = { registerOpenExternal, openPathHandler, HTTPS };
