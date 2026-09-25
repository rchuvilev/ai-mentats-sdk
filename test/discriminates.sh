#!/bin/sh
# Mutation check: reintroduce each bug and assert the suite goes RED.
# A green suite proves nothing until a broken build fails it.
cd "$(dirname "$0")/.." || exit 1
PASS=0; FAIL=0

mutate() {
  desc=$1; file=$2; from=$3; to=$4
  cp "$file" "$file.bak"
  python3 - "$file" "$from" "$to" <<'PY'
import sys
p,f,t=sys.argv[1],sys.argv[2],sys.argv[3]
s=open(p).read()
if f not in s:
    print("MUTATION-NOOP"); sys.exit(9)
open(p,'w').write(s.replace(f,t,1))
PY
  if [ $? -eq 9 ]; then
    echo "  SKIP (pattern absent — mutation is a no-op): $desc"
    mv "$file.bak" "$file"; FAIL=$((FAIL+1)); return
  fi
  if node --test 'utils/*.test.js' 'logic/*.test.js' 'ui/*.test.js' >/dev/null 2>&1; then
    echo "  NOT CAUGHT: $desc"; FAIL=$((FAIL+1))
  else
    echo "  caught:     $desc"; PASS=$((PASS+1))
  fi
  mv "$file.bak" "$file"
}

echo "Mutation testing (each must be CAUGHT):"

# ── utils/failsafe.js ─────────────────────────────────────────────────────

mutate "failsafe stops recording failures" utils/failsafe.js \
  "  recent.push({ at: Date.now(), op, message, context });" \
  "  ;"

mutate "failsafe buffer becomes unbounded" utils/failsafe.js \
  "  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);" \
  "  ;"

mutate "recentFailures exposes the live buffer" utils/failsafe.js \
  "  return recent.slice();" \
  "  return recent;"

# ── utils/env.js ──────────────────────────────────────────────────────────

mutate "PATH appended instead of prepended (system copies win)" utils/env.js \
  "  return base ? extra.join(sep) + sep + base : extra.join(sep);" \
  "  return base ? base + sep + extra.join(sep) : extra.join(sep);"

mutate "empty-PATH guard dropped (trailing separator = cwd on PATH)" utils/env.js \
  "  const base = envPath || (isWin ? '' : '/usr/bin:/bin');" \
  "  const base = envPath;"

mutate "extra can no longer override the base environment" utils/env.js \
  "    ...baseEnv,
    ...extra," \
  "    ...extra,
    ...baseEnv,"

mutate "tryRun rethrows instead of returning null" utils/env.js \
  "  return quiet(op, () => run(bin, args, opts), null);" \
  "  return run(bin, args, opts);"


# ── utils/proc.js ─────────────────────────────────────────────────────────

mutate "kill targets the pid instead of the process group" utils/proc.js \
  "      kill(-proc.pid, 'SIGTERM');" \
  "      kill(proc.pid, 'SIGTERM');"

mutate "no SIGKILL follow-up (a hung child survives shutdown)" utils/proc.js \
  "        if (platform !== 'win32') kill(-proc.pid, 'SIGKILL');" \
  "        ;"

mutate "taskkill loses /T (Windows grandchildren survive)" utils/proc.js \
  "      if (runFn) runFn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });" \
  "      if (runFn) runFn('taskkill', ['/pid', String(proc.pid), '/F'], { stdio: 'ignore' });"

mutate "cleanup runs more than once (double-kills every child)" utils/proc.js \
  "    if (done) return undefined;
    done = true;" \
  "    ;"


# ── logic/settings.js ─────────────────────────────────────────────────────

mutate "a missing settings file is recorded as a failure (floods the buffer)" logic/settings.js \
  "    if (!fs.existsSync(filePath)) return {};" \
  "    ;"

mutate "save replaces the document instead of merging a patch" logic/settings.js \
  "    const merged = { ...load(), ...patch };" \
  "    const merged = { ...patch };"

mutate "a failed write is silent" logic/settings.js \
  "    attempt('settings.write', () => {" \
  "    (() => {"

mutate "the settings write is no longer atomic" logic/settings.js \
  "      const tmp = \`\${filePath}.tmp\`;
      fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
      fs.renameSync(tmp, filePath);" \
  "      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));"

mutate "settings:set accepts a non-object patch" logic/settings.js \
  "    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {" \
  "    if (false) {"


# ── logic/shell.js ────────────────────────────────────────────────────────

mutate "open-external accepts any scheme (file:// becomes launchable)" logic/shell.js \
  "    if (parsed.protocol !== HTTPS) return { success: false };" \
  "    ;"

mutate "open-external accepts plain http" logic/shell.js \
  "const HTTPS = 'https:';" \
  "const HTTPS = 'http:';"

mutate "an unparseable url throws out of the handler" logic/shell.js \
  "    try {
      parsed = new URL(url);
    } catch {
      return { success: false };
    }" \
  "    parsed = new URL(url);"

mutate "openPathHandler lets the renderer choose the path" logic/shell.js \
  "  return async () => {
    await shell.openPath(dirPath);" \
  "  return async (_, fromRenderer) => {
    await shell.openPath(fromRenderer || dirPath);"


# ── logic/lima.js ─────────────────────────────────────────────────────────

mutate "JSONL parsed as a single JSON blob (breaks multi-VM)" logic/lima.js \
  "    try {
      vms.push(JSON.parse(text));
    } catch {
      skipped.push(text.slice(0, 120));
    }" \
  "    vms.push(JSON.parse(text));"

mutate "a malformed line aborts the whole parse" logic/lima.js \
  "      skipped.push(text.slice(0, 120));" \
  "      return { vms: [], skipped: [] };"

mutate "missing VM status defaults to Running" logic/lima.js \
  "  return found ? (found.status || 'Unknown') : 'Absent';" \
  "  return found ? (found.status || 'Running') : 'Absent';"

mutate "Stopped counts as a usable VM" logic/lima.js \
  "  return status === 'Running';" \
  "  return status !== 'Absent';"

mutate "an unrunnable bundled binary aborts the search" logic/lima.js \
  "  if (bundledPath && exists(bundledPath) && canRun(bundledPath)) return bundledPath;" \
  "  if (bundledPath && exists(bundledPath)) return bundledPath;"

mutate "Homebrew locations removed" logic/lima.js \
  "const HOMEBREW_CANDIDATES = ['/opt/homebrew/bin/limactl', '/usr/local/bin/limactl'];" \
  "const HOMEBREW_CANDIDATES = [];"

mutate "nerdctl loses sudo" logic/lima.js \
  "  return ['shell', vmName, 'sudo', 'nerdctl', ...args];" \
  "  return ['shell', vmName, 'nerdctl', ...args];"

mutate "LIMA_HOME can be overridden by the inherited environment" logic/lima.js \
  "  return { ...baseEnv, LIMA_HOME: limaHome(homedir, dirName) };" \
  "  return { LIMA_HOME: limaHome(homedir, dirName), ...baseEnv };"

mutate "the missing-Lima message loses a remedy" logic/lima.js \
  "    + '  • brew install lima       (uses a system-wide install)\\n'" \
  "    + ''"


# ── logic/tunnel.js ───────────────────────────────────────────────────────

mutate "ingress continuation keys ignored (order-dependent parse returns)" logic/tunnel.js \
  "    if (kv && current) applyKey(current, kv[1], kv[2]);" \
  "    if (false) applyKey(current, kv[1], kv[2]);"

mutate "findIngress ignores the scheme (udp game rides an http ingress)" logic/tunnel.js \
  "  const wanted = normalizeService(\`\${scheme}://localhost:\${port}\`);" \
  "  const wanted = normalizeService(\`http://localhost:\${port}\`);"

mutate "findIngress returns the first hostname regardless of service" logic/tunnel.js \
  "    (e) => e.service && normalizeService(e.service) === wanted && e.hostname," \
  "    (e) => e.hostname,"

mutate "isConfigured accepts a partially configured multi-service tunnel" logic/tunnel.js \
  "  return services.every((s) => findIngress(config, s) !== null);" \
  "  return services.some((s) => findIngress(config, s) !== null);"

mutate "isConfigured no longer requires a tunnel id" logic/tunnel.js \
  "  if (!config || !config.tunnel) return false;" \
  "  if (!config) return false;"

mutate "127.0.0.1 no longer recognised as localhost" logic/tunnel.js \
  "  return String(service).trim().replace('127.0.0.1', 'localhost').replace(/\/+\$/, '');" \
  "  return String(service).trim().replace(/\/+\$/, '');"

mutate "trailing comments left on the hostname" logic/tunnel.js \
  "  if (hash !== -1) v = v.slice(0, hash === 0 ? 0 : hash).trim();" \
  "  ;"

mutate "render drops the mandatory catch-all rule" logic/tunnel.js \
  "  lines.push(\`  - service: \${CLOUDFLARED_SERVICE_404}\`, '', 'metrics: 127.0.0.1:0', '');" \
  "  lines.push('', 'metrics: 127.0.0.1:0', '');"

mutate "render only ever writes the first ingress entry" logic/tunnel.js \
  "  for (const entry of ingress) {" \
  "  for (const entry of ingress.slice(0, 1)) {"

mutate "hostname validation accepts anything (shell injection)" logic/tunnel.js \
  "  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\$/i.test(host);" \
  "  return true;"


# ── logic/tunnel-ipc.js ───────────────────────────────────────────────────

mutate "setup-tunnel skips hostname validation (command injection)" logic/tunnel-ipc.js \
  "    if (!T.isValidHostname(hostname)) {" \
  "    if (false) {"

mutate "setup-tunnel writes only the first service's ingress" logic/tunnel-ipc.js \
  "      const ingress = services.map((s, i) => ({" \
  "      const ingress = services.slice(0, 1).map((s, i) => ({"

mutate "setup-tunnel stops persisting the applied domain" logic/tunnel-ipc.js \
  "      settings.save({ publicDomain: hostname });" \
  "      ;"

mutate "tunnel-status drops the singular primary hostname" logic/tunnel-ipc.js \
  "      hostname: T.findIngress(cfg, services[0])," \
  "      hostname: undefined,"

mutate "tunnel:start proceeds with no configured hostname" logic/tunnel-ipc.js \
  "    if (!primary) return { success: false, error: 'No tunnel configured — complete setup first' };" \
  "    ;"


# ── logic/mcp.js ──────────────────────────────────────────────────────────

mutate "project-scope registration no longer detected (install duplicates)" logic/mcp.js \
  "  if (data.projects && typeof data.projects === 'object') {" \
  "  if (false) {"

mutate "a malformed .claude.json throws instead of reading as absent" logic/mcp.js \
  "    try {
      data = JSON.parse(data);
    } catch {
      return false;
    }" \
  "    data = JSON.parse(data);"

mutate "only the user scope is cleared before install" logic/mcp.js \
  "const MCP_SCOPES = ['user', 'local', 'project'];" \
  "const MCP_SCOPES = ['user'];"

mutate "a failing scope removal aborts the rest" logic/mcp.js \
  "    quiet(
      \`mcp.remove.\${scope}\`,
      () => run('claude', ['mcp', 'remove', serverName, '-s', scope],
        { timeout: 15000, stdio: 'pipe', cwd }),
      null,
    );" \
  "    run('claude', ['mcp', 'remove', serverName, '-s', scope],
      { timeout: 15000, stdio: 'pipe', cwd });"

mutate "install stops writing the slash-command doc" logic/mcp.js \
  "      writeCommand();" \
  "      ;"


# ── logic/pty.js ──────────────────────────────────────────────────────────

mutate "the asar path is not rewritten (python cannot exec inside the archive)" logic/pty.js \
  "  if (isPackaged || p.includes('app.asar')) return p.replace('app.asar', 'app.asar.unpacked');" \
  "  ;"

mutate "a previous pty session leaks instead of being replaced" logic/pty.js \
  "        attempt('pty.killPrevious', () => ptyProcess.kill());" \
  "        ;"

mutate "pty:write forwards any type the renderer sends" logic/pty.js \
  "    if (ptyProcess && !ptyProcess.killed && typeof data === 'string') ptyProcess.stdin.write(data);" \
  "    if (ptyProcess && !ptyProcess.killed) ptyProcess.stdin.write(data);"

mutate "skipPerms flag lands after the slash command" logic/pty.js \
  "      const tail = skipPerms ? [SKIP_PERMS_FLAG, ...args] : [...args];" \
  "      const tail = skipPerms ? [...args, SKIP_PERMS_FLAG] : [...args];"

mutate "POSIX bypasses the PTY helper (no real TTY)" logic/pty.js \
  "        ptyProcess = spawn('python3', [helperPath, command, ...tail]," \
  "        ptyProcess = spawn(command, tail,"


# ── ui/window.js ──────────────────────────────────────────────────────────

mutate "webSecurity defaults to off" ui/window.js \
  "  webSecurity: true," \
  "  webSecurity: false,"

mutate "contextIsolation defaults to off" ui/window.js \
  "  contextIsolation: true," \
  "  contextIsolation: false,"

mutate "app overrides can no longer opt out of a default" ui/window.js \
  "  return { ...SECURE_DEFAULTS, ...overrides, preload };" \
  "  return { ...overrides, ...SECURE_DEFAULTS, preload };"

mutate "DevTools open themselves again" ui/window.js \
  "    win.show();" \
  "    win.show(); win.webContents.openDevTools();"

mutate "header rewriting is allowed with no url filter (<all_urls>)" ui/window.js \
  "    if (!Array.isArray(headerRewrite.urls) || headerRewrite.urls.length === 0) {" \
  "    if (false) {"

mutate "stripFrameHeaders removes unrelated headers too" ui/window.js \
  "    if (stripFrameHeaders && (lower === 'x-frame-options' || lower === 'content-security-policy')) {" \
  "    if (stripFrameHeaders) {"


# ── utils/bundle-electron.js ──────────────────────────────────────────────

mutate "the .cjs entry is no longer recognised (dejavu cannot bundle)" utils/bundle-electron.js \
  "const ENTRY_NAMES = ['electron-main.js', 'electron-main.cjs'];" \
  "const ENTRY_NAMES = ['electron-main.js'];"

mutate "the bundle extension no longer follows the entry" utils/bundle-electron.js \
  "  return entryPath.slice(0, -ext.length) + '.bundle' + ext;" \
  "  return entryPath.replace(/\.[cm]?js\$/, '.bundle.js');"

mutate ".cjs wins over .js when both exist" utils/bundle-electron.js \
  "const ENTRY_NAMES = ['electron-main.js', 'electron-main.cjs'];" \
  "const ENTRY_NAMES = ['electron-main.cjs', 'electron-main.js'];"


echo
echo "caught $PASS / $((PASS+FAIL))"
[ "$FAIL" -eq 0 ] || exit 1
