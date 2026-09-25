'use strict';
//
// The nine cloudflared/tunnel IPC handlers, shared by n8n, minecraft and
// coolify. This module owns no app state beyond the running child process:
// everything else comes from the config object, so three apps with different
// ports, schemes and tunnel names share one implementation.

const path = require('path');
const T = require('./tunnel');
const { quiet } = require('../utils/failsafe');

function registerTunnelIpc(ipcMain, config) {
  const {
    getWindow, tunnelName, services, settings,
    configPath, credentialsDir, deps, note = null,
  } = config;
  const { run, tryRun, spawn, fs } = deps;

  let tunnelProcess = null;
  let tunnelUrl = null;

  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  function readConfig() {
    if (!fs.existsSync(configPath)) return T.parseTunnelConfig('');
    const text = quiet('cloudflared.readConfig', () => fs.readFileSync(configPath, 'utf8'), null);
    if (text === null) return T.parseTunnelConfig('');
    // A parse failure used to report "no hostnames configured" for a perfectly
    // good tunnel, so it is recorded rather than swallowed.
    return quiet('cloudflared.parseConfig', () => T.parseTunnelConfig(text), T.parseTunnelConfig(''));
  }

  ipcMain.handle('cloudflared:check', async () => {
    if (tryRun('cloudflared.versionNpx', 'npx', ['cloudflared', '--version'],
      { timeout: 15000, stdio: 'pipe' }) !== null) return { installed: true };
    return {
      installed: tryRun('cloudflared.version', 'cloudflared', ['--version'],
        { timeout: 5000, stdio: 'pipe' }) !== null,
    };
  });

  ipcMain.handle('cloudflared:install', async () => {
    try {
      run('npx', ['bun', 'add', '-g', 'cloudflared'], { timeout: 60000 });
      return { success: true };
    } catch (e) {
      return { success: false, error: (e.stderr && e.stderr.toString().trim()) || e.message };
    }
  });

  ipcMain.handle('cloudflared:auth-status', async () => ({
    authenticated: fs.existsSync(path.join(credentialsDir, 'cert.pem')),
  }));

  ipcMain.handle('cloudflared:login', async () => new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('cloudflared', ['tunnel', 'login'], { stdio: 'pipe', detached: true });
    } catch (e) {
      resolve({ success: false, error: e.message });
      return;
    }
    let output = '';
    const collect = (d) => { output += d.toString(); };
    proc.stdout.on('data', collect);
    proc.stderr.on('data', collect);
    proc.on('error', (e) => resolve({ success: false, error: e.message }));
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* already gone */ }
      resolve({ success: false, error: 'Login timed out' });
    }, 300000);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? { success: true } : { success: false, error: output.trim() || `Exit code ${code}` });
    });
  }));

  ipcMain.handle('cloudflared:tunnel-status', async () => {
    const cfg = readConfig();
    const hostnames = {};
    for (const s of services) {
      const host = T.findIngress(cfg, s);
      if (host) hostnames[s.name] = host;
    }
    // `hostname` is the PRIMARY service's, alongside the per-service map.
    // Renderers that predate multi-service tunnels read the singular form, and
    // tunnel:start already treats services[0] as primary — so this is the same
    // concept, not a compatibility shim.
    return {
      configured: T.isConfigured(cfg, services),
      tunnelName: cfg.tunnel,
      hostname: T.findIngress(cfg, services[0]),
      hostnames,
    };
  });

  ipcMain.handle('cloudflared:setup-tunnel', async (_, domain) => {
    const hostname = typeof domain === 'string' ? domain.trim() : '';
    if (!hostname) return { success: false, error: 'Domain is required' };
    // Validated BEFORE anything runs: this value reaches a command line and a
    // config file.
    if (!T.isValidHostname(hostname)) {
      return {
        success: false,
        error: `"${hostname}" is not a valid hostname — use something like app.example.com`,
      };
    }

    try {
      let tunnelId = null;
      const list = tryRun('cloudflared.list', 'cloudflared', ['tunnel', 'list', '-o', 'json'],
        { timeout: 15000, stdio: 'pipe' });
      if (list) {
        const tunnels = quiet('cloudflared.parseList', () => JSON.parse(list), []);
        const existing = Array.isArray(tunnels) ? tunnels.find((t) => t && t.name === tunnelName) : null;
        if (existing) {
          if (fs.existsSync(path.join(credentialsDir, `${existing.id}.json`))) {
            tunnelId = existing.id;
          } else {
            // The tunnel exists server-side but its credentials are gone, so it
            // can never be run from this machine. Recreate rather than fail.
            tryRun('cloudflared.delete', 'cloudflared', ['tunnel', 'delete', '-f', tunnelName],
              { timeout: 15000, stdio: 'pipe' });
          }
        }
      }
      if (!tunnelId) {
        const out = run('cloudflared', ['tunnel', 'create', tunnelName], { timeout: 15000, stdio: 'pipe' });
        tunnelId = T.parseTunnelId(out);
        if (!tunnelId) return { success: false, error: `Failed to parse tunnel ID from: ${out}` };
      }

      // One ingress entry per declared service. The first service takes the
      // hostname the user typed; additional services get a per-service
      // subdomain, which is what coolify's SSH entry needs.
      const ingress = services.map((s, i) => ({
        hostname: i === 0 ? hostname : `${s.name}.${hostname}`,
        scheme: s.scheme,
        port: s.port,
      }));

      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(configPath, T.renderTunnelConfig({
        tunnelId,
        credentialsFile: path.join(credentialsDir, `${tunnelId}.json`),
        ingress,
      }));

      for (const entry of ingress) {
        try {
          run('cloudflared', ['tunnel', 'route', 'dns', '--overwrite-dns', tunnelId, entry.hostname],
            { timeout: 15000, stdio: 'pipe' });
        } catch (e) {
          const err = (e.stderr && e.stderr.toString()) || '';
          if (!err.includes('already exists')) {
            return {
              success: false,
              error: `DNS route failed for ${entry.hostname}: ${err.trim() || e.message}`,
            };
          }
        }
      }

      settings.save({ publicDomain: hostname });
      return { success: true, tunnelId, hostname, hostnames: ingress.map((e) => e.hostname), note };
    } catch (e) {
      return { success: false, error: (e.stderr && e.stderr.toString().trim()) || e.message };
    }
  });

  ipcMain.handle('tunnel:start', async () => {
    if (tunnelProcess && !tunnelProcess.killed) return { success: true, url: tunnelUrl };
    const cfg = readConfig();
    const primary = T.findIngress(cfg, services[0]);
    if (!primary) return { success: false, error: 'No tunnel configured — complete setup first' };

    try {
      tunnelProcess = spawn('cloudflared', ['tunnel', 'run'], { stdio: 'pipe', detached: true });
      tunnelUrl = null;
      let connected = false;
      const onOutput = (data) => {
        const text = data.toString();
        send('tunnel:log', text);
        if (!connected && T.isTunnelConnectedLine(text)) {
          connected = true;
          tunnelUrl = primary;
          send('tunnel:url-update', primary);
        }
      };
      tunnelProcess.stdout.on('data', onOutput);
      tunnelProcess.stderr.on('data', onOutput);
      tunnelProcess.on('exit', (code) => {
        send('tunnel:log', `\n[cloudflared exited with code ${code}]\n`);
        tunnelProcess = null;
        tunnelUrl = null;
      });
      for (let i = 0; i < 20 && !tunnelUrl; i++) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!tunnelUrl) return { success: false, error: 'Named tunnel failed to connect' };
      return { success: true, url: tunnelUrl };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('tunnel:stop', async () => {
    if (tunnelProcess && !tunnelProcess.killed) {
      tunnelProcess.kill('SIGTERM');
      tunnelProcess = null;
      tunnelUrl = null;
    }
    return { success: true };
  });

  ipcMain.handle('tunnel:status', async () => ({
    running: !!(tunnelProcess && !tunnelProcess.killed),
    url: tunnelUrl,
  }));
}

module.exports = { registerTunnelIpc };
