'use strict';
//
// Lima VM resolution and status, merged from coolify's lib/lima.js and the
// Lima half of minecraft's lib/runtime.js.
//
// Every load-bearing behaviour from both is preserved and pinned by a test:
//
//   * `limactl list --json` is JSONL — one object per line, not an array.
//   * A VM entry with no status is Unknown, never Running.
//   * A present-but-unrunnable binary does not abort the resolution search.
//   * `sudo` is mandatory: containerd runs as a system service in these VMs.
//
// The VM name and lima home are PARAMETERS: minecraft uses `~/.mc-lima` and
// VM `mc`, coolify uses its own. Container-specific helpers (console pipe,
// log follow, shell quoting) stay in minecraft — one consumer.

const path = require('path');

const HOMEBREW_CANDIDATES = ['/opt/homebrew/bin/limactl', '/usr/local/bin/limactl'];

/** `<home>/<dirName>` — deliberately short; see UNIX_PATH_MAX above. */
function limaHome(homedir, dirName) {
  if (!homedir || !dirName) throw new TypeError('limaHome(homedir, dirName): both are required');
  return path.join(homedir, dirName);
}

/**
 * Environment for every limactl/nerdctl invocation. LIMA_HOME is pinned on
 * each call because the default (`~/.lima`) is a different path and a
 * different set of VMs — inheriting the user's would target the wrong ones.
 */
function limaEnv(homedir, dirName, baseEnv = {}) {
  return { ...baseEnv, LIMA_HOME: limaHome(homedir, dirName) };
}

/** argv for a nerdctl command inside the named VM. `sudo` is not optional. */
function nerdctlArgs(vmName, args) {
  if (!vmName || typeof vmName !== 'string') throw new TypeError('nerdctlArgs: vmName is required');
  if (!Array.isArray(args)) throw new TypeError('nerdctlArgs: args must be an array');
  return ['shell', vmName, 'sudo', 'nerdctl', ...args];
}

/**
 * Parse `limactl list --json`, which emits JSONL.
 * A malformed line is skipped rather than fatal, but the skip is RECORDED so
 * it can be reported instead of vanishing.
 */
function parseVmList(output) {
  const vms = [];
  const skipped = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try {
      vms.push(JSON.parse(text));
    } catch {
      skipped.push(text.slice(0, 120));
    }
  }
  return { vms, skipped };
}

/** Status of the named VM as a STRING. 'Absent' when it is not listed. */
function vmStatus(output, vmName) {
  const { vms } = parseVmList(output);
  const found = vms.find((vm) => vm && vm.name === vmName);
  return found ? (found.status || 'Unknown') : 'Absent';
}

/** Only Running is usable. Stopped is not "nearly running". */
function isVmUsable(status) {
  return status === 'Running';
}

/**
 * Resolve limactl: the bundled copy, then PATH, then Homebrew.
 *
 * The bundled binary wins so behaviour does not change based on what the user
 * happens to have installed. The Homebrew fallbacks exist because an app
 * launched from Finder inherits a launchd PATH without `/opt/homebrew/bin`.
 * A present-but-unrunnable candidate must NOT end the search.
 */
function resolveLimactl({ bundledPath, exists, canRun }) {
  if (bundledPath && exists(bundledPath) && canRun(bundledPath)) return bundledPath;
  if (canRun('limactl')) return 'limactl';
  for (const candidate of HOMEBREW_CANDIDATES) {
    if (exists(candidate) && canRun(candidate)) return candidate;
  }
  return null;
}

/** Names BOTH remedies, because either genuinely fixes it. */
function missingLimaMessage({ downloadScript }) {
  return 'Lima is required and was not found.\n'
    + `  • ${downloadScript}   (fetches the copy this app ships with)\n`
    + '  • brew install lima       (uses a system-wide install)\n'
    + 'Which one is right depends on whether you want the app-local copy.';
}

module.exports = {
  HOMEBREW_CANDIDATES,
  limaHome,
  limaEnv,
  nerdctlArgs,
  parseVmList,
  vmStatus,
  isVmUsable,
  resolveLimactl,
  missingLimaMessage,
};
