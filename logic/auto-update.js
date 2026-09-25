/**
 * Shared auto-update module for Electron apps.
 * Uses electron-updater with generic provider — feed URL comes from
 * the app's package.json "build.publish" config.
 *
 * Usage (in electron-main.js):
 *   const { setupAutoUpdate } = require('./shared/electron-auto-update');
 *   // Call after window creation:
 *   setupAutoUpdate(mainWindow);
 */

let autoUpdater;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch {
  autoUpdater = null;
}

const { ipcMain } = require('electron');

let _registered = false;

function setupAutoUpdate(mainWindow) {
  if (!autoUpdater) {
    console.warn('Auto-update: electron-updater not available');
    return;
  }

  // Register IPC handler only once (safe across multiple window creations on macOS)
  if (!_registered) {
    _registered = true;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('error', (err) => {
      console.warn('Auto-update error:', err.message);
    });

    ipcMain.handle('update:install', () => {
      autoUpdater.quitAndInstall(false, true);
    });
  }

  // (Re-)attach window-specific listeners so the current window gets notifications
  autoUpdater.removeAllListeners('update-available');
  autoUpdater.removeAllListeners('update-downloaded');

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', { version: info.version });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:downloaded', { version: info.version });
    }
  });

  // Check for updates after a short delay (don't block startup)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      console.warn('Update check failed:', e.message);
    });
  }, 5000);
}

module.exports = { setupAutoUpdate };
