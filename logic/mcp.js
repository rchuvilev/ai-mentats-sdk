'use strict';
//
// Claude Code MCP registration mechanics.
//
// Only the mechanics are shared. The server being registered differs
// completely between the apps — n8n registers `n8n-mcp` via `npx n8n-mcp`
// with an optional API key, minecraft registers `minecraft` via
// `node bedrock-mcp-server.mjs --port`, roblox registers `Roblox_Studio` — so
// `addArgs` is supplied by the app as an ARGV ARRAY. The shipped n8n build
// joined its args into a string for execSync with the user's API key inside,
// so a key containing a shell metacharacter was executed rather than passed.

const path = require('path');
const { quiet, attempt } = require('../utils/failsafe');

const MCP_SCOPES = ['user', 'local', 'project'];

/**
 * Is `serverName` registered with Claude Code?
 * `~/.claude.json` holds servers at two levels: user scope at the top, and a
 * per-project map under `projects`. A project-scoped entry from an earlier
 * install still means installed.
 */
function detectMcpInstalled(claudeConfig, serverName) {
  let data = claudeConfig;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return false;
    }
  }
  if (!data || typeof data !== 'object') return false;
  if (data.mcpServers && data.mcpServers[serverName]) return true;
  if (data.projects && typeof data.projects === 'object') {
    for (const project of Object.values(data.projects)) {
      if (project && project.mcpServers && project.mcpServers[serverName]) return true;
    }
  }
  return false;
}

/**
 * Clear the server from every scope before installing, so a re-install cannot
 * leave duplicates. A failure per scope is expected — usually nothing was
 * registered there — and must not abort the remaining scopes.
 */
function removeAllScopes(serverName, { run, cwd } = {}) {
  for (const scope of MCP_SCOPES) {
    quiet(
      `mcp.remove.${scope}`,
      () => run('claude', ['mcp', 'remove', serverName, '-s', scope],
        { timeout: 15000, stdio: 'pipe', cwd }),
      null,
    );
  }
}

function registerMcpIpc(ipcMain, config) {
  const {
    serverName, addArgs, commandFile, commandBody,
    claudeJsonPath, skillsDir = null, settings, extraInstall = null, deps, cwd,
  } = config;
  const { run, fs } = deps;

  const writeCommand = () => attempt('mcp.writeCommand', () => {
    fs.mkdirSync(path.dirname(commandFile), { recursive: true });
    fs.writeFileSync(commandFile, commandBody);
  });

  ipcMain.handle('mcp:status', async () => {
    const stored = settings.load();
    const raw = fs.existsSync(claudeJsonPath)
      ? quiet('mcp.readClaudeJson', () => fs.readFileSync(claudeJsonPath, 'utf8'), null)
      : null;
    return {
      mcpInstalled: !!stored.mcpInstalled || detectMcpInstalled(raw, serverName),
      skillsInstalled: skillsDir ? (!!stored.skillsInstalled || fs.existsSync(skillsDir)) : undefined,
    };
  });

  ipcMain.handle('mcp:install', async () => {
    try {
      removeAllScopes(serverName, { run, cwd });
      run('claude', addArgs, { timeout: 30000, cwd });
      writeCommand();
      if (extraInstall) extraInstall();
      settings.save({ mcpInstalled: true });
      return { success: true };
    } catch (e) {
      return { success: false, error: (e.stderr && e.stderr.toString().trim()) || e.message };
    }
  });

  ipcMain.handle('mcp:uninstall', async () => {
    removeAllScopes(serverName, { run, cwd });
    settings.save({ mcpInstalled: false });
    return { success: true };
  });
}

module.exports = { MCP_SCOPES, detectMcpInstalled, removeAllScopes, registerMcpIpc };
