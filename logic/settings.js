'use strict';
//
// A tiny JSON settings store, shared by four apps.
//
// The important behaviour is the distinction between a MISSING file and a
// BROKEN one. Absence is the normal first-run state and must not be recorded:
// these apps poll status every few seconds, and recording an expected absence
// each time floods the bounded failsafe buffer that exists to make real
// errors findable. Unreadable content IS worth recording.

const path = require('path');
const nodeFs = require('fs');
const { quiet, attempt } = require('../utils/failsafe');

/**
 * @param {object} o
 * @param {string} o.dir    the app's data directory
 * @param {string} [o.file] filename; n8n passes 'mentat-settings.json' so its
 *                          existing user settings are not discarded
 * @param {object} [o.fs]   injectable for tests
 */
function createSettingsStore({ dir, file = 'settings.json', fs = nodeFs }) {
  if (!dir) throw new TypeError('createSettingsStore: dir is required');
  const filePath = path.join(dir, file);

  function load() {
    if (!fs.existsSync(filePath)) return {};
    return quiet('settings.read', () => JSON.parse(fs.readFileSync(filePath, 'utf8')), {});
  }

  function save(patch) {
    const merged = { ...load(), ...patch };
    // Losing this write means the next launch silently forgets a change the
    // user really made, so the failure is recorded rather than swallowed.
    attempt('settings.write', () => {
      fs.mkdirSync(dir, { recursive: true });
      // Atomic: write a temp file and rename over the target, so a crash or a
      // full disk mid-write leaves the previous settings intact rather than a
      // truncated file the next launch cannot parse. rename(2) is atomic
      // within a filesystem, and both paths are in the same directory.
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
      fs.renameSync(tmp, filePath);
    });
    return merged;
  }

  return { load, save, path: filePath };
}

/** Attach `settings:get` and `settings:set`. */
function registerSettingsIpc(ipcMain, store) {
  ipcMain.handle('settings:get', async () => store.load());
  ipcMain.handle('settings:set', async (_, patch) => {
    // The renderer is not trusted to send an object.
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { ok: false, error: 'settings:set expects an object' };
    }
    return { ok: true, settings: store.save(patch) };
  });
}

module.exports = { createSettingsStore, registerSettingsIpc };
