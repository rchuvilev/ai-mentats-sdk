# ai-mentat App Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point all six consuming apps at the shared SDK modules and delete the duplicated code, without changing any app's user-visible behaviour.

**Architecture:** Each app bumps its `sdk` submodule to the extraction commit, deletes the code the SDK now owns, and wires the SDK registrars into `electron-main.js`. App-specific logic stays where it is. Verification is per app: existing tests still pass, `npm run bundle` succeeds, and — where possible — the GUI is driven.

**Tech Stack:** Node >= 22.16, CommonJS (dejavu: ESM package with a CommonJS entry), `node:test`, esbuild, git submodules.

**Spec:** `docs/superpowers/specs/2026-09-07-sdk-extraction-design.md`
**Predecessor:** `docs/superpowers/plans/2026-09-07-sdk-shared-modules.md` (complete — SDK at `f721353`, 140 tests, 61/61 mutations)

## Global Constraints

- **Behaviour must not change.** This is a move, not a redesign. The one deliberate exception is DevTools, which stop opening themselves in all five apps that did it.
- **coolify keeps `webSecurity: false`,** passed EXPLICITLY with a comment. It cannot be GUI-verified here; silently hardening an app nobody can run is how a refactor breaks a product.
- **Channel names do not change.** Folder-opening handlers keep their per-app names and use `openPathHandler` as the body.
- **n8n keeps `mentat-settings.json`** as its settings filename; renaming it would discard existing user settings.
- **Every app bumps `sdk` to the same commit,** verified against the SDK head read back from GitHub at the end.
- Test glob form: `node --test 'test/*.js'`. A bare directory reports a spurious failure.
- Each app is fully verified before the next begins, so a wrong SDK boundary is caught on the first consumer rather than the sixth.

---

## What each app deletes and gains

| App | Delete | Wire to SDK |
|---|---|---|
| n8n | `lib/failsafe.js`, `lib/cloudflared.js` (+2 tests), `vendor/`, 3 plists, `shellEnv`/`tryRun`/`killProcess`/`loadSettings`/`createWindow`, `buildPath` from `lib/n8n.js`, `MCP_SCOPES`+`detectMcpInstalled` from `lib/mcp.js` | env, proc, settings, shell, window, pty, mcp, tunnel(+ipc), base.css, vendor, build |
| minecraft | same, plus the Lima half of `lib/runtime.js` | + lima |
| coolify-local | `lib/failsafe.js`, `lib/lima.js` (+2 tests), `vendor/`, plists, local helpers | env, proc, settings, shell, window, pty, lima, tunnel(+ipc), base.css |
| roblox-studio | `lib/settings.js` (+test), `vendor/`, plists, local helpers | env, proc, settings, shell, window, pty, mcp, base.css |
| local-studio | `vendor/`, plists, `createWindow` | settings, shell, window, base.css |
| dejavu | nothing | window, build/, family scripts, `.cjs` entry |

App-specific logic that STAYS: n8n's `lib/n8n.js` (minus `buildPath`) and `lib/encryption-key.js`; minecraft's macros, console bridge, bds, bridge-protocol, ttl-cache and the container half of `runtime.js`; coolify's Coolify setup steps; roblox's `lib/platform.js` and `lib/skills.js`; local-studio's queue and media code.

---

## Unified structure (added mid-execution, at the maintainer's request)

Every Electron app conforms to the layout and `package.json` shape below. This
is applied as part of each app's task rather than as a separate pass, since
every app is being edited anyway.

### Directory layout

```
.claude/skills/run-app/    driver + SKILL.md, where one exists
assets/                    marketing: gifs, screenshots, button kits
lib/                       app-specific pure logic
scripts/                   setup.js, build-app.js, start-built.js (+ app extras)
test/                      *.js and discriminates.sh
sdk/                       submodule
app.html, app.css, app.js  renderer
preload.js
electron-main.js           (dejavu: electron-main.cjs)
icon.png
config.updates.json
CLAUDE.md, README.md, .gitignore, .gitmodules, package.json
```

**Removed from every app, now served from `sdk/`:** `vendor/`,
`entitlements.*.plist`, and **`pty-helper.py`**.

That last one is a gap in this plan as first written. All six copies —
the five app roots and `sdk/utils/pty-helper.py` — are byte-identical
(sha1-verified). Each app's `build.asarUnpack` and its `resolveHelperPath`
call move to `sdk/utils/pty-helper.py`.

**Marketing assets move to `assets/`.** n8n keeps four progress GIFs,
`output.png` and `md-ui-kit/` at its repo root; roblox uses `demo-gif/`.
Both become `assets/`, and the README image links move with them.

### package.json

Fixed key order, so a diff between two apps shows real differences rather than
ordering noise:

```
name, version, description, main, productName, shop_link, itch_io,
scripts, keywords, author, license, engines, signing,
dependencies, devDependencies, optionalDependencies, build, repository
```

`productName` is currently missing from n8n and minecraft, `keywords` and
`engines` from roblox; all are added. `name` always equals the repo name —
dejavu's is `ai-dejavu` and becomes `ai-mentat-dejavu`, which also aligns it
with the `appName` its data-dir and build output are keyed on.

Required scripts in every Electron app: `setup`, `run`, `build`, `check`,
`gui`, `test`, `bundle`, `build:mac`, `build:mac:signed`, `build:win`,
`build:linux`, `build:all`, `dist`, `publish`, `release` — plus
`test:mutation` wherever `lib/` exists. App-specific extras
(`download:lima`, `download:engines`, `site`) come after.

### Deliberately NOT unified

- **Inline `<script>` in `app.html` vs a separate `app.js`.** minecraft and
  local-studio use `app.js`; n8n, coolify and roblox keep their renderer
  inline. Extracting working inline script for symmetry is churn with real
  regression risk and no user-visible benefit.
- **App-specific directories** (`ai/`, `skills/`, `site/`, `src/`, `deploy/`)
  — those names carry meaning.
- **Versions.** n8n and roblox shipped at 1.1.0; the rest are 0.1.0. Aligning
  them would falsify release history.

### Per-app step to add

Each app task gains a step before its verification step:

> **Conform to the unified structure.** Delete `pty-helper.py` and point
> `asarUnpack` plus `resolveHelperPath` at `sdk/utils/pty-helper.py`. Move
> marketing assets into `assets/` and fix the README links. Rewrite
> `package.json` in the fixed key order, adding any missing required key or
> script.

And Task 7 gains a conformance check across all six.

---

### Task 1: ai-mentat-n8n — the pilot

**This task validates the SDK boundary.** If a contract is wrong, it surfaces here and the SDK is revised before the other five.

**Files:**
- Delete: `lib/failsafe.js`, `lib/cloudflared.js`, `test/test_failsafe.js`, `test/test_cloudflared.js`, `vendor/`, `entitlements.mac.plist`, `entitlements.mas.plist`, `entitlements.mas.inherit.plist`
- Modify: `electron-main.js`, `lib/n8n.js`, `lib/mcp.js`, `app.html`, `app.css`, `package.json`, `test/discriminates.sh`, `sdk` (submodule pointer)

**Interfaces consumed:**
`sdk/utils/env` → `shellEnv`, `run`, `tryRun`; `sdk/utils/proc` → `killProcess`, `createCleanup`; `sdk/utils/failsafe` → `quiet`, `attempt`; `sdk/logic/settings` → `createSettingsStore`; `sdk/logic/shell` → `registerOpenExternal`, `openPathHandler`; `sdk/logic/pty` → `registerPtyIpc`, `resolveHelperPath`; `sdk/logic/mcp` → `detectMcpInstalled`, `removeAllScopes`; `sdk/logic/tunnel` + `sdk/logic/tunnel-ipc` → `registerTunnelIpc`; `sdk/ui/window` → `createWindow`.

- [ ] **Step 1: Bump the submodule**

```bash
cd /Users/rchuvilev/Projects/ai-mentat-n8n
(cd sdk && git fetch -q https://github.com/hexstack-apps/ai-mentat-sdk.git main && git checkout -q FETCH_HEAD && git rev-parse --short HEAD)
```

Expected: the SDK head (`f721353` or later).

- [ ] **Step 2: Delete what the SDK now owns**

```bash
git rm -q lib/failsafe.js lib/cloudflared.js test/test_failsafe.js test/test_cloudflared.js
git rm -q -r vendor
git rm -q entitlements.mac.plist entitlements.mas.plist entitlements.mas.inherit.plist
```

- [ ] **Step 3: Strip the duplicated halves of the app's own lib files**

In `lib/n8n.js`: delete `buildPath` and its export; the app now imports it from
`sdk/utils/env`. Everything else in that file is n8n-specific and stays.

In `lib/mcp.js`: delete `MCP_SCOPES` and `detectMcpInstalled` and their
exports. `mcpAddArgs`, `isCorruptNpxEntry` and `mentatCommandDoc` are
n8n-specific and stay.

Update `test/test_n8n.js` and `test/test_mcp.js` to drop the tests for the
removed functions — those behaviours are now tested in the SDK, and a test for
code that no longer exists in this repo fails on the require.

- [ ] **Step 4: Rewire `electron-main.js`**

Replace the local helper definitions with SDK imports:

```js
const { shellEnv: sdkShellEnv, run, tryRun } = require('./sdk/utils/env');
const { killProcess, createCleanup } = require('./sdk/utils/proc');
const { quiet, attempt } = require('./sdk/utils/failsafe');
const { createSettingsStore } = require('./sdk/logic/settings');
const { registerOpenExternal, openPathHandler } = require('./sdk/logic/shell');
const { registerPtyIpc, resolveHelperPath } = require('./sdk/logic/pty');
const { registerTunnelIpc } = require('./sdk/logic/tunnel-ipc');
const { detectMcpInstalled, removeAllScopes } = require('./sdk/logic/mcp');
const { createWindow } = require('./sdk/ui/window');
```

Delete the local `shellEnv`, `run`, `tryRun`, `killProcess`, `cleanup`
wrapper, `loadSettings`, `saveSettings` and `createWindow` definitions, and
replace their uses:

```js
const shellEnv = () => sdkShellEnv({ home: os.homedir() });

// n8n keeps its filename: renaming discards existing user settings.
const settings = createSettingsStore({ dir: dataDir, file: 'mentat-settings.json' });
const loadSettings = () => settings.load();
const saveSettings = (patch) => settings.save(patch);

const cleanup = createCleanup(() => { /* the existing cleanup body */ });
```

Replace the `createWindow` body with the factory:

```js
function createWindow() {
  mainWindow = createWindow_({
    BrowserWindow,
    width: 1200,
    height: 800,
    title: 'N8N Mentat',
    icon: path.join(__dirname, 'icon.png'),
    preload: path.join(__dirname, 'preload.js'),
    load: { file: path.join(__dirname, 'app.html') },
    headerRewrite: {
      urls: [`http://localhost:${N8N_PORT}/*`, `http://127.0.0.1:${N8N_PORT}/*`],
      stripFrameHeaders: true,
      sameSiteNone: true,
    },
    onReady: (win) => setupAutoUpdate(win),
  });
  mainWindow.on('closed', () => cleanup());
  mainWindow.webContents.on('did-fail-load', (_, code, desc) => console.error('Load failed:', desc));
}
```

(`createWindow_` is the imported factory, aliased so the local function keeps
its name and every existing call site is untouched.)

Replace the tunnel block — all nine handlers — with:

```js
registerTunnelIpc(ipcMain, {
  getWindow: () => mainWindow,
  tunnelName: 'mentat',
  services: [{ name: 'web', scheme: 'http', port: N8N_PORT }],
  settings,
  configPath: path.join(os.homedir(), '.cloudflared', 'config.yml'),
  credentialsDir: path.join(os.homedir(), '.cloudflared'),
  deps: { run, tryRun, spawn, fs },
});
```

Replace the four `pty:*` handlers with:

```js
registerPtyIpc(ipcMain, {
  getWindow: () => mainWindow,
  command: fs.existsSync(path.join(os.homedir(), '.local', 'bin', 'claude'))
    ? path.join(os.homedir(), '.local', 'bin', 'claude') : 'claude',
  args: ['/mentat-n8na'],
  cwd: os.homedir(),
  env: { ...shellEnv(), TERM: 'xterm-256color' },
  helperPath: resolveHelperPath(__dirname, { isPackaged: app.isPackaged }),
  deps: { spawn },
});
```

Replace `shell:open-external` with `registerOpenExternal(ipcMain, shell)`, and
`shell:open-n8n-data` with
`ipcMain.handle('shell:open-n8n-data', openPathHandler(shell, n8nFolder))`.

In `mcp:status`, use the SDK's `detectMcpInstalled(raw, 'n8n-mcp')`; in
`mcp:install`/`mcp:uninstall`, use `removeAllScopes('n8n-mcp', { run, cwd: os.homedir() })`.
The rest of n8n's MCP handling (its argv, the skills clone, the npx cache
hygiene) stays local — it is not shared.

- [ ] **Step 5: Point the renderer at the shared stylesheet**

In `app.html`, before the existing stylesheet link:

```html
  <link rel="stylesheet" href="sdk/ui/base.css">
  <link rel="stylesheet" href="app.css">
```

and change the vendor scripts to the SDK copies:

```html
<script src="sdk/vendor/xterm.js"></script>
<script src="sdk/vendor/addon-fit.js"></script>
```

plus `<link rel="stylesheet" href="sdk/vendor/xterm.css">` if the page links it.

Then empty `app.css` down to only what is n8n's own. Every one of n8n's 74
selectors is in `base.css`, so the file becomes a comment explaining that.

- [ ] **Step 6: Update `package.json`**

In `build.files`, replace `"vendor/"` with `"sdk/vendor/"`, and add
`"sdk/ui/base.css"`. In `build.mac`, point `entitlements` and
`entitlementsInherit` at `sdk/build/entitlements.mac.plist`; in `build.mas`,
at `sdk/build/entitlements.mas.plist` and `sdk/build/entitlements.mas.inherit.plist`.

- [ ] **Step 7: Prune the mutation harness**

`test/discriminates.sh` still mutates `lib/failsafe.js` and
`lib/cloudflared.js`, which no longer exist here. Delete those blocks — the
same mutations now run in the SDK. Keep the blocks for `lib/n8n.js`,
`lib/encryption-key.js` and `lib/mcp.js`, minus any that target a function
moved to the SDK.

- [ ] **Step 8: Verify**

```bash
npm test
npm run test:mutation
npm run bundle
node -e "require('fs').existsSync('electron-main.bundle.js') || process.exit(1)"
```

Expected: suite green, every remaining mutation caught, bundle produced. The
bundle succeeding is what proves every `./sdk/...` require resolves.

- [ ] **Step 9: Drive the GUI**

```bash
npm run bundle && node .claude/skills/run-app/driver.mjs .
```

Then `launch`, `ss n8n-migrated`, `errors`, `tab tunnel`, `ss n8n-tunnel`.
Expected: the window renders, the n8n editor loads in the iframe (which proves
the SDK's scoped `headerRewrite` works), the tunnel tab shows the real
`n8n.hexstack.app` from `~/.cloudflared/config.yml` (which proves the SDK
tunnel parser reads a real file), and **DevTools do not open**.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Migrate to the shared SDK modules

<summary of what was deleted and wired, with the LOC delta>"
```

---

### Task 2: ai-mentat-minecraft

Same shape as Task 1, plus Lima. **Files:** delete `lib/failsafe.js`,
`lib/cloudflared.js`, their two tests, `vendor/`, three plists; modify
`electron-main.js`, `lib/runtime.js`, `app.html`, `app.css`, `package.json`,
`test/discriminates.sh`, `sdk`.

- [ ] **Step 1: Bump the submodule** — as Task 1 Step 1, in this repo.

- [ ] **Step 2: Delete what the SDK owns**

```bash
git rm -q lib/failsafe.js lib/cloudflared.js test/test_failsafe.js test/test_cloudflared.js
git rm -q -r vendor
git rm -q entitlements.mac.plist entitlements.mas.plist entitlements.mas.inherit.plist
```

- [ ] **Step 3: Split `lib/runtime.js`**

Delete from it: `limaHome`, `limaEnv`, `nerdctlArgs`, `parseVmList`,
`vmStatus`, `isVmUsable`, `resolveLimactl`, `limactlMissingError`,
`HOMEBREW_CANDIDATES` — all now in `sdk/logic/lima`. Keep `runtimeFor`,
`CONTAINER_NAME`, `BEDROCK_PORT`, `VM_NAME`, `LIMA_DIR_NAME`,
`consolePipeArgs`, `containerLogArgs`, `shellQuote`, `sendCommandLine`: the
container half has one consumer.

`consolePipeArgs` and `containerLogArgs` call `nerdctlArgs`, so re-import it:

```js
const { nerdctlArgs } = require('../sdk/logic/lima');
const consolePipeArgs = () => nerdctlArgs(VM_NAME, ['exec', '-i', CONTAINER_NAME, 'sh']);
const containerLogArgs = () => nerdctlArgs(VM_NAME, ['logs', '-f', '--tail', '200', CONTAINER_NAME]);
```

Delete the moved tests from `test/test_runtime.js` and the moved mutations from
`test/discriminates.sh`.

- [ ] **Step 4: Rewire `electron-main.js`** — as Task 1 Step 4, with these differences:

```js
const LIMA = require('./sdk/logic/lima');

const settings = createSettingsStore({ dir: dataDir });   // plain settings.json

registerTunnelIpc(ipcMain, {
  getWindow: () => mainWindow,
  tunnelName: 'mentat-mc',
  services: [{ name: 'game', scheme: 'udp', port: serverPort() }],
  settings,
  configPath: path.join(os.homedir(), '.cloudflared', 'config.yml'),
  credentialsDir: path.join(os.homedir(), '.cloudflared'),
  deps: { run, tryRun, spawn, fs },
  note: 'Bedrock is UDP. Cloudflare carries UDP over a tunnel for private '
    + 'access only, so players must be on WARP (or Cloudflare Spectrum). For '
    + 'open public play, forward the port on your router instead.',
});

registerPtyIpc(ipcMain, { /* as Task 1, args: ['/mentat-mcbes'] */ });
```

Lima calls become `LIMA.resolveLimactl({...})`, `LIMA.vmStatus(out, RT.VM_NAME)`,
`LIMA.isVmUsable(...)`, `LIMA.limaEnv(os.homedir(), RT.LIMA_DIR_NAME, base)`.
The `memoize` wrapper around `vmStatus`/`isServerInstalled` stays — it is this
app's fix for its own polling.

The window keeps `webSecurity: true` (its current value) and has no
`headerRewrite`.

- [ ] **Step 5–8:** stylesheet, `package.json`, harness pruning and verification exactly as Task 1 Steps 5–8. minecraft's `app.css` keeps its own rules (console pane, macro builder, player list) and loses the 74 shared ones.

- [ ] **Step 9: Drive the GUI** — `launch`, `tab macros`, `ss`, `errors`, and confirm the builder still renders and DevTools stay shut.

- [ ] **Step 10: Commit.**

---

### Task 3: ai-mentat-coolify-local

**Files:** delete `lib/failsafe.js`, `lib/lima.js`, `test/test_failsafe.js`, `test/test_lima.js`, `vendor/`, three plists; modify `electron-main.js`, `app.html`, `app.css`, `package.json`, `test/discriminates.sh`, `sdk`.

- [ ] **Step 1: Bump the submodule.**

- [ ] **Step 2: Delete**

```bash
git rm -q lib/failsafe.js lib/lima.js test/test_failsafe.js test/test_lima.js
git rm -q -r vendor
git rm -q entitlements.mac.plist entitlements.mas.plist entitlements.mas.inherit.plist
```

- [ ] **Step 3: Rewire `electron-main.js`**

Imports as Task 1, plus `const LIMA = require('./sdk/logic/lima');`.
`execSyncEnv` callers become `run`/`tryRun`.

**The tunnel has TWO services** — this is the case the SDK's ingress list
exists for:

```js
registerTunnelIpc(ipcMain, {
  getWindow: () => mainWindow,
  tunnelName: 'mentat-coolify',
  services: [
    { name: 'web', scheme: 'http', port: 8000 },
    { name: 'ssh', scheme: 'ssh', port: 2222 },
  ],
  settings,
  configPath: path.join(os.homedir(), '.cloudflared', 'config.yml'),
  credentialsDir: path.join(os.homedir(), '.cloudflared'),
  deps: { run, tryRun, spawn, fs },
});
```

**The window keeps its current insecurity, explicitly:**

```js
mainWindow = createWindow_({
  BrowserWindow,
  width: 1200,
  height: 820,
  title: 'Coolify Mentat',
  preload: path.join(__dirname, 'preload.js'),
  load: { file: path.join(__dirname, 'app.html') },
  // FIXME(security): this app still needs webSecurity off, and it cannot be
  // launched in the current environment to prove otherwise. n8n turned the
  // same flag ON with no ill effect once headerRewrite was scoped, so this is
  // very likely safe to flip — but flipping it blind on an app nobody can run
  // is how a refactor breaks a product. Verify by launching, then delete this.
  webPreferences: { webSecurity: false },
  headerRewrite: {
    urls: ['http://localhost:8000/*', 'http://127.0.0.1:8000/*'],
    stripFrameHeaders: true,
    sameSiteNone: true,
  },
  onReady: (win) => setupAutoUpdate(win),
});
```

Note the second half of that change: the header rewrite moves from
`<all_urls>` to coolify's own origin. That part IS applied, because it can
only narrow what the app strips.

- [ ] **Step 4–7:** stylesheet, `package.json`, harness pruning, verification. `npm test` and `npm run bundle` only — this app cannot be launched here.

- [ ] **Step 8: Commit,** naming the unverified `webSecurity` decision.

---

### Task 4: ai-mentat-roblox-studio

**Files:** delete `lib/settings.js`, `test/test_settings.js`, `vendor/`, three plists; modify `electron-main.js`, `app.html`, `app.css`, `package.json`, `test/discriminates.sh`, `sdk`.

`lib/platform.js` and `lib/skills.js` are roblox-specific and stay.

- [ ] **Step 1: Bump the submodule.**

- [ ] **Step 2: Delete**

```bash
git rm -q lib/settings.js test/test_settings.js
git rm -q -r vendor
git rm -q entitlements.mac.plist entitlements.mas.plist entitlements.mas.inherit.plist
```

If `lib/platform.js` duplicates `buildPath`, delete that function from it and
import from `sdk/utils/env` instead; keep the rest.

- [ ] **Step 3: Rewire `electron-main.js`**

Imports as Task 1, minus tunnel (this app has none). MCP wiring uses the SDK's
`detectMcpInstalled`/`removeAllScopes` with `serverName: 'Roblox_Studio'`; the
argv stays local. PTY uses `args: ['/mentat-rbxs']`. Window: 1100×750,
'Roblox Studio Mentat', no `headerRewrite`.

- [ ] **Step 4–7:** stylesheet, `package.json`, harness pruning, verification (`npm test`, `npm run bundle`).

- [ ] **Step 8: Commit.**

---

### Task 5: ai-mentat-local-studio

The smallest migration: no pty, no mcp, no tunnel, no `lib/`.

**Files:** delete `vendor/`, three plists; modify `electron-main.js`, `app.html`, `app.css`, `package.json`, `sdk`.

- [ ] **Step 1: Bump the submodule.**

- [ ] **Step 2: Delete**

```bash
git rm -q -r vendor
git rm -q entitlements.mac.plist entitlements.mas.plist entitlements.mas.inherit.plist
```

- [ ] **Step 3: Rewire `electron-main.js`**

```js
const { createSettingsStore, registerSettingsIpc } = require('./sdk/logic/settings');
const { registerOpenExternal, openPathHandler } = require('./sdk/logic/shell');
const { createWindow: createWindow_ } = require('./sdk/ui/window');

const settings = createSettingsStore({ dir: dataDir });
registerSettingsIpc(ipcMain, settings);   // replaces settings:get / settings:set
```

Window: 1240×860, 'Hexstack Mentat Local Studio', `backgroundColor` preserved,
no `headerRewrite`.

- [ ] **Step 4–6:** stylesheet, `package.json`, verification (`npm test`, `npm run bundle`).

- [ ] **Step 7: Commit.**

---

### Task 6: ai-mentat-dejavu — join the family

The only app gaining rather than shedding. It has **no** IPC surface, **no**
auto-update (the maintainer's explicit instruction), and its `src/failsafe.ts`
stays where it is because browser code imports it.

**Files:** rename `electron-main.js` → `electron-main.cjs`; create `scripts/setup.js`, `scripts/build-app.js`, `scripts/start-built.js`; add `.gitmodules` + `sdk`; modify `package.json`, `.gitignore`.

- [ ] **Step 1: Add the SDK as a submodule**

```bash
cd /Users/rchuvilev/Projects/ai-mentat-dejavu
git submodule add -b main https://github.com/hexstack-apps/ai-mentat-sdk.git sdk
(cd sdk && git checkout -q FETCH_HEAD 2>/dev/null || git checkout -q main)
```

- [ ] **Step 2: Convert the wrapper to CommonJS**

```bash
git mv electron-main.js electron-main.cjs
```

Rewrite its ESM header as CommonJS — the file spawns the compiled ESM server
as a child process, so it imports nothing from `src/` and the conversion is
mechanical:

```js
const { app, BrowserWindow, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { createWindow: createWindow_ } = require('./sdk/ui/window');

const ROOT = __dirname;
```

Delete the `fileURLToPath`/`import.meta.url` lines. Replace the app's own
`BrowserWindow` construction with the factory, using `load: { url }` because
this app points at a local HTTP server rather than a file:

```js
mainWindow = createWindow_({
  BrowserWindow,
  width: 1280,
  height: 860,
  title: 'AI Déjà Vu',
  preload: undefined,        // no preload: this app exposes no IPC at all
  load: { url: serverUrl },
});
```

Update the header comment: the "ESM, not CommonJS" paragraph is now wrong and
must be replaced with why the file is `.cjs` in an ESM package.

- [ ] **Step 3: Add the family scripts**

Three wrappers identical in shape to the other apps' (`scripts/setup.js`,
`scripts/build-app.js`, `scripts/start-built.js`), each calling into
`sdk/logic/app-scripts` with `appName: 'ai-mentat-dejavu'`.

- [ ] **Step 4: Add packaging to `package.json`**

`main` becomes `electron-main.bundle.cjs`. Add `bundle`, `gui`, `setup`,
`check` scripts; a `signing` block matching the family; and a `build` block
with `appId: 'app.hexstack.dejavu'`, `files` listing the bundle, `site/`,
`dist/`, `package.json`, and `mac.entitlements` pointing at
`sdk/build/entitlements.mac.plist`. Add `electron-builder` and `esbuild` to
`devDependencies`.

**No `publish` block and no `auto-update` import** — dejavu ships without an
update path, by instruction.

- [ ] **Step 5: Verify**

```bash
npm install
npm run bundle && ls electron-main.bundle.cjs
npm run build          # tsc, the existing script
npm test               # the existing dist/test*.js suite
```

Expected: `electron-main.bundle.cjs` (not `.js` — this is the case the SDK
bundler change exists for), and the existing TypeScript suite still green.

- [ ] **Step 6: Drive the GUI**

Launch and confirm the window opens on the local server URL and the classifier
page renders. This app is cheap to launch — plain electron plus tsc.

- [ ] **Step 7: Commit.**

---

### Task 7: Cross-repo verification

- [ ] **Step 1: Every pointer matches the SDK head, read back from GitHub**

```bash
SDK=$(gh api repos/hexstack-apps/ai-mentat-sdk/commits/main --jq '.sha')
for r in ai-mentat-n8n ai-mentat-minecraft ai-mentat-coolify-local \
         ai-mentat-roblox-studio ai-mentat-local-studio ai-mentat-dejavu ai-mentat-interviews; do
  ptr=$(gh api "repos/hexstack-apps/$r/contents/sdk" --jq '.sha')
  printf "  %-26s %s\n" "$r" "$([ "$ptr" = "$SDK" ] && echo current || echo STALE)"
done
```

- [ ] **Step 2: No app still contains a file the SDK owns**

```bash
for r in n8n minecraft coolify-local roblox-studio local-studio; do
  for f in lib/failsafe.js lib/cloudflared.js vendor/xterm.js entitlements.mac.plist; do
    [ -e "ai-mentat-$r/$f" ] && echo "  LEFTOVER: $r/$f"
  done
done
```

Expected: no output.

- [ ] **Step 3: Every app bundles and its suite passes**

```bash
for r in n8n minecraft coolify-local roblox-studio local-studio dejavu; do
  (cd ai-mentat-$r && npm test >/dev/null 2>&1; t=$?; npm run bundle >/dev/null 2>&1; b=$?
   printf "  %-16s tests=%s bundle=%s\n" "$r" "$([ $t = 0 ] && echo ok || echo FAIL)" "$([ $b = 0 ] && echo ok || echo FAIL)")
done
```

- [ ] **Step 4: No DevTools auto-open survives anywhere**

```bash
grep -rn "openDevTools" ai-mentat-*/electron-main.js ai-mentat-*/electron-main.cjs 2>/dev/null || echo "  none"
```

- [ ] **Step 5: Report the LOC delta** — total lines removed across the apps against lines added to the SDK.

---

## Done when

- All six apps consume the SDK; none contains a file the SDK owns.
- Every app's existing suite passes and every app bundles.
- All seven submodule pointers match the SDK head on GitHub.
- No `openDevTools` call remains in any app.
- n8n and minecraft GUI-verified; dejavu GUI-verified; coolify, roblox and local-studio verified by tests and bundle only, stated as such.
