# ai-mentat-sdk extraction — design

**Date:** 2026-09-07
**Status:** approved for planning
**Scope:** `ai-mentat-sdk` plus six consuming apps

## Goal

Move the functionality duplicated across the ai-mentat apps into
`ai-mentat-sdk` and have the apps consume it, so that each behaviour has one
implementation. Bring `ai-mentat-dejavu` into the family's packaging shape.

## Decisions taken before design (by the maintainer)

| Decision | Choice | Consequence accepted |
|---|---|---|
| Extraction threshold | **2+ apps, config objects allowed** | `ui/window.js` and `ui/base.css` couple five shipping apps to one SDK file. One SDK edit changes all five. |
| Test safety | **Move first, test the SDK copy** | No characterisation tests pin current per-app behaviour. Where variants differ, the SDK resolves to one behaviour; the resolution is recorded (see Drift ledger) rather than proven. |
| Sequencing | **Approach B — whole SDK first, then one migration per app** | The shared surface is designed with no consumer proving it. A wrong boundary surfaces during migration and costs an SDK revision plus a re-bump. |
| Branching | **main** | No review gate before changes land. |
| dejavu module format | **Rename its wrapper to `electron-main.cjs`** | Requires the SDK bundler to accept a `.cjs` entry and emit a `.cjs` bundle. |
| dejavu auto-update | **None** | Overrules the design's initial proposal; dejavu ships packaged with no update path. |
| DevTools on dev launch | **Removed everywhere, no opt-in** | Five apps lose their auto-open line; developers use the platform shortcut. |

The threshold and test-safety choices were made after the alternatives and
their costs were presented. They are recorded here so a later reader does not
mistake them for oversights.

## Current state, measured

Eight repos: the SDK and seven apps. Five are Electron apps already consuming
the SDK (`n8n`, `minecraft`, `roblox-studio`, `coolify-local`,
`local-studio`); `interviews` uses electron-forge and has no
`electron-main.js`; `dejavu` is an ESM Electron wrapper around a static site
and consumes nothing from the SDK.

### Byte-identical files

| File | Copies | Waste |
|---|---|---|
| `vendor/xterm.js`, `xterm.css`, `addon-fit.js` | 5 | ~1.9 MB |
| `pty-helper.py` | 5 | 9 KB — the SDK already ships this at `utils/pty-helper.py` |
| `lib/failsafe.js` + `test/test_failsafe.js` | 3 | 13 KB |
| `entitlements.mac.plist`, `.mas.plist`, `.mas.inherit.plist` | 5 each | 5 KB |
| `scripts/download-lima.js` | 2 | 3 KB |

### Duplicated subsystems

| Subsystem | Apps | LOC | Collapsible |
|---|---|---|---|
| `cloudflared:*` + `tunnel:*`, 9 IPC channels | n8n, minecraft, coolify | 560 | ~360 |
| `mcp:*`, 3 IPC channels | n8n, minecraft, roblox | 195 | ~113 |
| `pty:*`, 4 IPC channels | n8n, minecraft, roblox, coolify | 185 | ~118 |
| Lima/VM | coolify `lib/lima.js` (148), minecraft `lib/runtime.js` (197) | 345 | overlapping: `parseVmList`, `vmStatus`, `isVmUsable`, `buildPath` |
| `shellEnv`/`buildPath` | 4 apps, 3 variants | — | — |
| `loadSettings`/`saveSettings` | 4 apps, 4 variants | — | — |
| `createWindow` | 5 apps, 5 variants | — | — |
| `shell:open-external` | 5 apps | — | — |
| `test/discriminates.sh` | 4 apps | — | — |

## Target SDK structure

```
ai-mentat-sdk/
├── index.js                        unchanged — apps require modules directly
├── logic/
│   ├── app-scripts.js              existing
│   ├── auto-update.js              existing
│   ├── publish.js  release.js      existing
│   ├── tunnel.js                   NEW  cloudflared + tunnel
│   ├── mcp.js                      NEW  Claude Code MCP registration
│   ├── pty.js                      NEW  embedded terminal
│   ├── lima.js                     NEW  Lima VM + nerdctl
│   ├── settings.js                 NEW  JSON settings store
│   └── shell.js                    NEW  guarded shell operations
├── ui/
│   ├── update-bar.js               existing
│   ├── window.js                   NEW  createWindow(config)
│   └── base.css                    NEW  shared stylesheet
├── utils/
│   ├── data-dir.js                 existing
│   ├── bundle-electron.js          existing — gains .cjs support
│   ├── pty-helper.py               existing
│   ├── env.js                      NEW  PATH + child-process helpers
│   ├── failsafe.js                 NEW  moved verbatim from the apps
│   └── proc.js                     NEW  process termination
├── build/
│   └── entitlements.{mac,mas,mas.inherit}.plist   NEW
├── vendor/
│   └── xterm.js  xterm.css  addon-fit.js          NEW
└── test/
    └── discriminates.sh            NEW  mutation harness
```

## Module contracts

Every signature below is derived from the existing implementations, not
invented. Each module is required directly (`require('./sdk/logic/tunnel')`);
`index.js` re-exports only what is commonly needed, as it does today.

### `utils/failsafe.js`

Moved verbatim from `lib/failsafe.js` (identical in three apps). Exports
`quiet`, `quietAsync`, `attempt`, `attemptAsync`, `recentFailures`,
`clearFailures`, `setSink`.

`dejavu`'s `src/failsafe.ts` is **not** merged: it is imported by code that
runs in the browser (`site/dist/mvp.js`), and the SDK module is Node
CommonJS. Merging would break dejavu's web build. Its `setFailureSink` is
named differently from the SDK's `setSink`; both names stay, because renaming
either breaks working code for cosmetics.

### `utils/env.js`

```js
buildPath(home, platform = process.platform, envPath = process.env.PATH) -> string
shellEnv({ home, platform, baseEnv, extra = {} }) -> object
run(bin, args, opts)      // execFileSync with shellEnv; argv array, never a string
tryRun(op, bin, args, opts)  // run() through quiet(); null on failure
```

`buildPath` prepends `~/.local/bin`, `~/.bun/bin`, and then platform entries
(`/opt/homebrew/bin`, `/usr/local/bin` on POSIX; `AppData/Roaming/npm`,
`AppData/Local/Programs/claude-code` on Windows), guarding the empty-PATH case.
A GUI app launched from Finder inherits a launchd PATH without these, which is
why prepending is load-bearing.

`extra` exists for `lima.js`, which must add `LIMA_HOME` to every invocation.

### `logic/settings.js`

```js
createSettingsStore({ dir, file = 'settings.json' }) -> {
  load(), save(patch), path
}
registerSettingsIpc(ipcMain, store)   // settings:get, settings:set
```

A missing file reads as `{}` **without** being recorded as a failure —
first-run absence is expected, and recording it on every status poll floods
the bounded failsafe buffer that exists to surface real errors.

`file` is a parameter because `n8n` stores `mentat-settings.json` while the
other three use `settings.json`. Renaming n8n's would silently discard
existing user settings, so n8n passes its filename.

### `logic/shell.js`

```js
registerOpenExternal(ipcMain, shell, { channel = 'shell:open-external' })
openPathHandler(shell, path) -> () => Promise   // register under the app's OWN channel
```

`open-external` is worth sharing because it carries real logic: it parses the
URL and requires `https:`, since a renderer-supplied string reaching
`openExternal` can otherwise launch `file://` or a custom protocol handler.
All five apps already use the same channel name, so nothing renames.

**Opening a local folder is deliberately *not* unified into one
`shell:open-path` channel.** The apps name it differently today
(`shell:open-logs-dir`, `shell:open-n8n-data`, `shell:open-data`) and each
handler is a single `shell.openPath(dir)` call. Replacing three one-liners
with a generic channel plus a name→path registry would mean editing every
app's preload and renderer for no behaviour change — more machinery than it
removes, and churn in five renderers is exactly the cost YAGNI is meant to
avoid. Apps keep their channel names and use `openPathHandler` as the body.

### `utils/proc.js`

```js
killProcess(proc, name, { platform, run, log })   // group SIGTERM, SIGKILL after 3s
createCleanup(fn) -> cleanup                      // idempotent; runs once
```

Termination kills the process **group** (`process.kill(-pid)`) because these
apps spawn detached children that outlive a bare `kill`.

### `logic/pty.js`

```js
registerPtyIpc(ipcMain, {
  getWindow, command, args = [], cwd, env = {}, helperPath,
})
// pty:spawn, pty:write, pty:resize, pty:kill
```

`getWindow` is a function rather than a window reference because macOS
recreates the window on `activate` after all windows close; a captured
reference would send to a destroyed window.

`command`/`args` are per app: each launches `claude` with its own slash
command (`/mentat-n8na`, `/mentat-mcbes`, `/mentat-rbxs`) and an optional
`--dangerously-skip-permissions`. `helperPath` resolution handles the
`app.asar` → `app.asar.unpacked` rewrite, because python3 cannot execute a
script inside the archive.

### `logic/lima.js`

Merges coolify's `lib/lima.js` and the Lima half of minecraft's
`lib/runtime.js`.

```js
resolveLimactl({ bundledPath, exists, canRun }) -> string|null
limaHome(homedir, dirName)          // dirName differs per app
limaEnv(homedir, dirName, baseEnv)  // sets LIMA_HOME
nerdctlArgs(vmName, args)           // ['shell', vm, 'sudo', 'nerdctl', ...args]
parseVmList(output) -> { vms, skipped }
vmStatus(output, vmName) -> string
isVmUsable(status) -> boolean
missingLimaMessage({ downloadScript }) -> string
```

Load-bearing behaviours preserved from both sources: `limactl list --json` is
**JSONL** (one object per line, not an array — a single `JSON.parse` works on a
one-VM machine and fails on every multi-VM one); a VM entry with no status
reports `Unknown`, never `Running`; a present-but-unrunnable binary does not
abort the resolution search; `sudo` is mandatory because containerd runs as a
system service in these VMs.

`dirName` and `vmName` are parameters: minecraft uses `~/.mc-lima` and VM
`mc`, coolify uses its own. Minecraft's `~/.mc-lima` is deliberately short —
Lima's control socket lives inside its home and macOS `UNIX_PATH_MAX` is 104
bytes.

Container-specific helpers (`consolePipeArgs`, `containerLogArgs`,
`shellQuote`, `sendCommandLine`) stay in minecraft: one consumer.

### `logic/tunnel.js`

```js
parseTunnelConfig(text) -> { tunnel, credentialsFile, ingress: [{hostname, service}] }
findIngress(config, { scheme, port }) -> hostname|null
renderTunnelConfig({ tunnelId, credentialsFile, ingress: [{hostname, scheme, port}] })
parseTunnelId(output) -> string|null
isValidHostname(value) -> boolean
isTunnelConnectedLine(text) -> boolean
registerTunnelIpc(ipcMain, { getWindow, tunnelName, services, settings })
```

**`ingress` is a list, not a single service.** This is the correction that
approach B nearly missed: n8n needs one HTTP entry (`http://localhost:5678`),
minecraft one UDP entry (`udp://localhost:19132`), and **coolify needs two**
— `http://localhost:8000` and `ssh://localhost:2222`. A single-service API
would have served two of the three apps and silently broken the third.

`services` is therefore `[{ name, scheme, port }]` per app, and `settings` is
a store from `logic/settings.js` — the tunnel handlers persist the applied
domain, which is what lets an app hand its public URL to a child process on
the next start.

The parser reads whole ingress entries rather than matching a `service:` line
and taking the hostname from the line above it. The line-pair approach fails
on a hand-edited entry with the keys in the other order — valid YAML that
cloudflared honours — and then offers to create a second tunnel over a working
one. A malformed file reads as "not configured" and never throws.

`isValidHostname` gates the value before it reaches a command line or a config
file.

### `logic/mcp.js`

```js
detectMcpInstalled(claudeConfig, serverName) -> boolean
mcpRemoveAllScopes(serverName, { run })       // user, local, project
registerMcpIpc(ipcMain, {
  serverName, addArgs, commandFile, commandBody, settings, extraInstall,
})
// mcp:status, mcp:install, mcp:uninstall
```

Only the mechanics are shared; the server being registered is per app and
differs completely — n8n registers `n8n-mcp` via `npx n8n-mcp` with an
optional API key, minecraft registers `minecraft` via
`node bedrock-mcp-server.mjs --port`, roblox registers `Roblox_Studio`. So
`addArgs` is supplied by the app as an **argv array**, never an interpolated
string: an API key containing a shell metacharacter must be passed, not
executed.

`detectMcpInstalled` checks both the top-level `mcpServers` map and every
entry under `projects` in `~/.claude.json`; a project-scoped registration
reading as "not installed" made the install button re-run and duplicate it. A
malformed file reads as not-installed rather than throwing.

`extraInstall` is a hook for n8n's skills-pack clone, which no other app has.

### `ui/window.js`

```js
createWindow({
  width, height, title, icon, backgroundColor,
  preload, load: { file } | { url },
  webPreferences = {},          // merged over secure defaults
  headerRewrite,                // { urls, stripFrameHeaders, sameSiteNone }
  onReady,
}) -> BrowserWindow
```

The five variants differ **only** in width, height, title, and one
`backgroundColor`, so a config object genuinely serves all five rather than
replacing five readable functions with a bigger one plus five configs.

Secure defaults: `nodeIntegration: false`, `contextIsolation: true`,
`webSecurity: true`, `allowRunningInsecureContent: false`. `sandbox: false` is
kept, as all five apps rely on a preload that needs it.

**DevTools are never opened automatically, and there is no option to.** Five
of the six apps currently run
`if (!app.isPackaged) mainWindow.webContents.openDevTools()` on every dev
launch (`local-studio` with `{ mode: 'detach' }`); dejavu has no such line.
All five lose it. No config flag replaces it: Electron already binds
Cmd+Opt+I / Ctrl+Shift+I, so a knob would be machinery for something the
platform provides — and an inspector that opens itself is noise in every
screenshot and every driven GUI session.

`headerRewrite` is scoped to named origins. Two apps embed a localhost HTTP
service in an iframe and must strip `X-Frame-Options` and the
`frame-ancestors` CSP for that origin, plus set `SameSite=None` on its
cookies.

### `ui/base.css`

The shared stylesheet: `.tab-bar`, `.panel`, `.card`, `.row`, `.status-dot`,
`.msg`, `.btn`, `.faq-item`, `.terminal-overlay`, inputs and selects.
Similarity across the five apps is 76–94%, all against the same origin.

Each app keeps its own `app.css` for what is genuinely its own and loads
`sdk/ui/base.css` first. App-specific rules stay in the app: minecraft's
`.console-log`/`.builder__*`, local-studio's media grid, roblox's compact
layout.

### `utils/bundle-electron.js` — change

`ENTRY_NAME` becomes an ordered list: `['electron-main.js',
'electron-main.cjs']`. The output name follows the entry — a `.cjs` entry
produces `electron-main.bundle.cjs`, because in a `"type": "module"` package a
`.js` bundle would be parsed as ESM while esbuild emits CommonJS.

## Security findings that fall out of the extraction

Two are pre-existing bugs in `coolify-local`, identical to ones already fixed
in `n8n`:

1. **`webSecurity: false`.** Turning it off disables the same-origin policy for
   the whole renderer. It is not needed to embed a localhost service in an
   iframe — framing is governed by the response headers below. n8n was
   switched to `webSecurity: true` and its embedded n8n editor was verified to
   still render.
2. **Header stripping on `<all_urls>`.** coolify removes `X-Frame-Options` and
   CSP for *every* URL the app can load, not just the origin it embeds.

The SDK defaults to secure and requires an explicit opt-out.

**How this is handled, given coolify cannot be GUI-verified here:** coolify's
migration passes `webSecurity: false` **explicitly**, with a comment and a
follow-up note, and scopes `headerRewrite` to `http://localhost:8000`. That
preserves today's behaviour exactly while making the opt-out visible in one
place, and leaves flipping it a one-line change once someone can launch the
app. Silently hardening an app nobody can run is how a refactor breaks a
product.

## Drift ledger

Recorded because the maintainer chose "move first" over characterisation
tests. Each row is a behaviour difference the extraction resolves.

| Behaviour | Variants found | Resolution |
|---|---|---|
| Settings filename | n8n `mentat-settings.json`; other three `settings.json` | Parameter. n8n keeps its name so existing settings survive. |
| `webSecurity` | roblox/local-studio unset (secure); minecraft `true`; n8n env-gated; coolify `false` | SDK default `true`; coolify opts out explicitly. |
| Header rewrite scope | n8n scoped to its origin; coolify `<all_urls>` | Scoped per app; coolify scoped to `localhost:8000`. |
| Tunnel ingress | n8n 1 HTTP; minecraft 1 UDP; coolify 2 (HTTP + SSH) | List of services. |
| `shellEnv` entries | minecraft and coolify identical; n8n in `lib/n8n.js`; roblox its own | One implementation with the union of entries. |
| MCP server identity | three unrelated servers and commands | Per-app `addArgs`; only mechanics shared. |
| Window size/title | five different | Config object. |
| failsafe sink name | JS `setSink`; dejavu TS `setFailureSink` | Both kept; dejavu's copy not merged. |
| DevTools auto-open | 4 apps plain, `local-studio` detached, dejavu none | Removed from all; none opt in. |

## dejavu — bringing it into the family

Its wrapper already exists and carries a deliberate decision: *"no
auto-update / SDK / IPC surface: this app has no privileged host operations to
expose."* That decision was made when the app was not distributable. It has no
`build` config, no signing block, no entitlements, no `scripts/`, and no
electron-builder dependency, and its `main` points at
`electron-main.bundle.js` **which nothing ever builds** — so packaging fails
today and `npm start` only works because it names the file explicitly.

What changes:

- `electron-main.js` → `electron-main.cjs`, so it can `require()` the
  CommonJS SDK while `src/` stays ESM. `main` → `electron-main.bundle.cjs`.
- Adopts `ui/window.js` via `load: { url }` — its window points at a local
  HTTP server rather than a file, which is why `load` is a union.
- Adopts `build/` entitlements, an electron-builder config and signing block
  matching the family, and the four standard scripts
  (`setup`, `run`, `build`, `check`) via `logic/app-scripts.js`.
- **No auto-update.** The wrapper's original "deliberately no auto-update"
  decision stands, at the maintainer's instruction. The design initially
  proposed adding it on the reasoning that a packaged app needs an update
  path; that was overruled, and correctly recorded here rather than quietly
  dropped. dejavu therefore adopts `build/` and the family scripts but not
  `logic/auto-update.js`.

What does **not** change: no IPC surface is added (there are still no
privileged operations to expose), no auto-update, `contextIsolation` stays on,
`nodeIntegration` stays off, and `src/failsafe.ts` stays where it is.

`interviews` is out of scope: electron-forge, no `electron-main.js`, and it
shares none of the subsystems. It keeps its SDK pointer for the `sdk/**/*`
files it packages.

## Non-goals

- No extraction of single-consumer logic: minecraft's macro engine, console
  bridge and BDS handling; roblox's Rojo; local-studio's media queue;
  coolify's Coolify-specific setup steps.
- No change to any app's user-visible behaviour, except the dejavu packaging
  additions above.
- No merge of dejavu's browser-side failsafe.
- No new features.
- No auto-update for dejavu.
- No DevTools auto-open, and no setting to restore it.

## Testing

Per the maintainer's choice, the SDK copy is tested rather than current app
behaviour characterised first.

- **SDK:** every new module ships unit tests and mutation checks in the SDK
  repo before any app depends on it. Target: from 18 tests to ~120, with the
  mutation harness proving the tests discriminate.
- **Per app after migration:** existing suite passes, `npm run bundle`
  succeeds (proves every require resolves), `npm test` where present.
- **GUI-driven:** n8n, minecraft, dejavu.
- **Bundle-and-review only:** roblox-studio, coolify-local, local-studio.
  Launching them needs a full install plus an Electron download each, and
  coolify additionally a working Lima VM. "Verified" for these three means
  bundles, tests and code review — not a GUI anyone looked at.

## Sequencing

1. **SDK**: all modules, tests, mutation checks, bundler `.cjs` support. One
   push.
2. **App migrations**, one commit and one submodule bump each, in order:
   `n8n`, `minecraft`, `coolify-local`, `roblox-studio`, `local-studio`,
   `dejavu`.

All on `main`. Each app migration is verified before the next begins, so a
wrong SDK boundary is caught on the first consumer rather than the sixth.

## Risks

| Risk | Mitigation |
|---|---|
| SDK boundary designed without a consumer (approach B) | Modules written directly from the variants already read, not invented; first migration validates before the rest. |
| No characterisation tests (maintainer's choice) | Drift ledger records every resolution; SDK modules are mutation-tested. |
| Three apps cannot be GUI-verified | Stated per app; behaviour preserved rather than "improved" where it cannot be checked — notably coolify's `webSecurity`. |
| `ui/base.css` and `ui/window.js` couple five shipping apps | Per-app overrides via config and app-level CSS; both pinned by tests. |
| Six submodule bumps must not drift | Every pointer verified against the SDK head read back from GitHub after pushing. |
