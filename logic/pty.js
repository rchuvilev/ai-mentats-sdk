'use strict';
//
// The embedded terminal, shared by four apps.
//
// Each app launches `claude` with its own slash command (`/mentat-n8na`,
// `/mentat-mcbes`, `/mentat-rbxs`), so `command` and `args` are per app; the
// PTY plumbing is not.
//
// On POSIX the command runs through `pty-helper.py`, which gives a real TTY
// without a native Node module (node-pty needs a compiler on the user's
// machine). Windows spawns directly.

const path = require('path');
const { killProcess } = require('../utils/proc');
const { attempt } = require('../utils/failsafe');

const SKIP_PERMS_FLAG = '--dangerously-skip-permissions';

/**
 * Where `pty-helper.py` really is at runtime.
 * python3 cannot execute a script inside `app.asar`, so the file is
 * asarUnpack'd and the path must be rewritten to match.
 */
function resolveHelperPath(dirname, { isPackaged }) {
  const p = path.join(dirname, 'pty-helper.py');
  if (isPackaged || p.includes('app.asar')) return p.replace('app.asar', 'app.asar.unpacked');
  return p;
}

function registerPtyIpc(ipcMain, config) {
  const {
    getWindow, command, args = [], cwd, env = {},
    helperPath, platform = process.platform, deps,
  } = config;
  const { spawn } = deps;

  let ptyProcess = null;

  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  ipcMain.handle('pty:spawn', (_, cols, rows, skipPerms) => {
    try {
      // Replace any previous session rather than leaking it.
      if (ptyProcess) {
        attempt('pty.killPrevious', () => ptyProcess.kill());
        ptyProcess = null;
      }
      const childEnv = { ...env, COLUMNS: String(cols || 80), LINES: String(rows || 24) };
      const tail = skipPerms ? [SKIP_PERMS_FLAG, ...args] : [...args];

      if (platform === 'win32') {
        ptyProcess = spawn(command, tail, { stdio: ['pipe', 'pipe', 'pipe'], cwd, env: childEnv });
      } else {
        ptyProcess = spawn('python3', [helperPath, command, ...tail],
          { stdio: ['pipe', 'pipe', 'pipe'], cwd, env: childEnv });
      }

      const relay = (data) => send('pty:data', data.toString());
      ptyProcess.stdout.on('data', relay);
      ptyProcess.stderr.on('data', relay);
      ptyProcess.on('error', (e) => send('pty:data', `\r\n[pty: ${e.message}]\r\n`));
      ptyProcess.on('exit', () => {
        send('pty:exit');
        ptyProcess = null;
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Only strings: the renderer is not trusted to send anything else into a
  // process running with the user's own privileges.
  ipcMain.on('pty:write', (_, data) => {
    if (ptyProcess && !ptyProcess.killed && typeof data === 'string') ptyProcess.stdin.write(data);
  });

  ipcMain.on('pty:resize', () => {
    // The helper re-reads the window size on SIGWINCH.
    if (ptyProcess && ptyProcess.pid && platform !== 'win32') {
      attempt('pty.resize', () => process.kill(ptyProcess.pid, 'SIGWINCH'));
    }
  });

  ipcMain.on('pty:kill', () => {
    if (!ptyProcess) return;
    killProcess(ptyProcess, 'pty', { platform });
    ptyProcess = null;
  });
}

module.exports = { SKIP_PERMS_FLAG, resolveHelperPath, registerPtyIpc };
