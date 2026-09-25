# ai-mentat-sdk

Shared logic, UI and utilities for the **ai-mentat** family of Electron apps.

Consumed as a **git submodule** (mounted at `sdk/`) by:

- [ai-mentat-coolify-local](https://github.com/hexstack-apps/ai-mentat-coolify-local)
- [ai-mentat-interviews](https://github.com/hexstack-apps/ai-mentat-interviews)
- [ai-mentat-local-studio](https://github.com/hexstack-apps/ai-mentat-local-studio)
- [ai-mentat-minecraft](https://github.com/hexstack-apps/ai-mentat-minecraft)
- [ai-mentat-n8n](https://github.com/hexstack-apps/ai-mentat-n8n)
- [ai-mentat-roblox-studio](https://github.com/hexstack-apps/ai-mentat-roblox-studio)

## Structure

```
logic/   app behaviour and release orchestration
  app-scripts.js       setup / build / check implementations
  auto-update.js       electron-updater wiring (generic provider)
  publish.js           version bump → bundle → build → update feed → itch.io
  release.js           upload dist/ to GitHub (gh) and itch.io (butler)
  settings.js          JSON settings store + settings:get/set
  shell.js             https-only open-external; a folder-opening handler body
  lima.js              Lima resolution, JSONL VM parsing, nerdctl argv
  tunnel.js            cloudflared config over an ingress LIST
  tunnel-ipc.js        the nine cloudflared/tunnel handlers
  mcp.js               Claude Code MCP registration mechanics
  pty.js               embedded terminal IPC, asar-aware helper path
ui/
  update-bar.js        "Restart to update" bar (plain <script>)
  window.js            createWindow(config) — secure defaults, no DevTools
  base.css             the shell five apps share
utils/
  data-dir.js          resolves <root>/.hexstack-app/<app-name>/data
  bundle-electron.js   esbuild bundling; accepts .js or .cjs entries
  env.js               PATH construction and argv-array exec helpers
  failsafe.js          suppress-and-record helpers
  proc.js              process-group termination, run-once cleanup
  pty-helper.py        real PTY bridge, no native Node modules
build/                 signing entitlements (mac, mas, mas.inherit)
vendor/                xterm.js, xterm.css, addon-fit.js
test/discriminates.sh  mutation harness
```

Every file here was **extracted verbatim** from code that already existed
identically in 2–3 of the consuming repos — nothing was invented for the sake of
having an SDK. `utils/data-dir.js` is the sole new module: it defines the shared
data-directory contract that all four apps moved to.

`ui/base.css` ships the shell all five Electron apps share — top bar, tab bar,
panels, cards, rows, status dots, buttons, the loading overlay, FAQ items and
the terminal overlay. This **reverses an earlier decision recorded here**: when
only one app defined CSS custom properties, a shared sheet would have had a
single user. Five apps now share 76–94% of one stylesheet, and every one of its
74 selectors is used by at least three of them, so it earns its place. An app
loads `base.css` first and keeps its own `app.css` for what is genuinely its
own; do not add a rule here that only one app uses.

## Bundling the main process

```sh
node sdk/utils/bundle-electron.js          # finds the app automatically
node sdk/utils/bundle-electron.js /path    # or bundle a specific one
```

The project directory is located by **walking up from this file** until a
directory containing `electron-main.js` is found, so it is correct whether the
SDK is mounted at `sdk/` as a submodule or installed at
`node_modules/ai-mentat-sdk/`.

It used to default to `path.resolve(__dirname, '..')`, which was the repo root
back when this file lived at `__shared__/scripts/` in the monorepo and is
`<repo>/sdk` at `sdk/utils/`. Since every consuming repo invokes it with no
argument, `bundle`, `gui` and every `build:*` script was failing with
`Could not resolve ".../sdk/electron-main.js"`. A hardcoded `'..', '..'` would
have moved the same assumption one level rather than removing it.

`ui/update-bar.js` is copied into the app as **`update-ui.js`**, which is the
name the consuming apps' `app.html` references and their `.gitignore` excludes.
That copy previously looked for `update-ui.js` inside `utils/`, where it has
never existed, so it silently copied nothing and the "Restart to update" bar
never appeared in any app.

## The data directory contract

```js
const { resolveDataDir, dataDir, ensureDataDir } = require('./sdk/utils/data-dir');

resolveDataDir('ai-mentat-interviews');
// POSIX  -> /.hexstack-app/ai-mentat-interviews/data
// Windows-> C:\.hexstack-app\ai-mentat-interviews\data
```

The filesystem root is not writable by an unprivileged user on most systems, so:

- `dataDir(app)` is pure — it computes the path and touches nothing.
- `ensureDataDir(app)` creates it and **returns** `{ok:false, error, fallback}`
  instead of throwing, so startup can report a real message.
- `resolveDataDir(app)` returns the root path when writable and otherwise falls
  back to `~/.hexstack-app/<app>/data`, always returning a usable directory.

Run `npm run setup` in a consuming repo (or `sudo mkdir -p /.hexstack-app &&
sudo chown $(whoami) /.hexstack-app`) to make the root location writable.

## Tests

```sh
npm test        # node --test utils/*.test.js
```

`utils/data-dir.test.js` covers the path contract, the POSIX literal, the
path-traversal guard and the read-only-root fallback. The suite is
mutation-checked: pointing the root at `homedir()` fails 2 tests and removing
the traversal guard fails 1.

## License

MIT

## Module rules

Two properties hold for every module added in the 2026-09 extraction, and both
are checked by `npm test` plus `npm run test:mutation`:

1. **No module requires `electron` directly.** Electron objects (`ipcMain`,
   `shell`, `BrowserWindow`) are passed in as parameters. That is what lets the
   whole suite run under plain `node --test` with no display and no Electron
   runtime.
2. **Every module has a sibling `<name>.test.js`.**

**Known exceptions, all predating the extraction:** `logic/auto-update.js`
requires `electron` for `ipcMain` and has no test; `logic/app-scripts.js`,
`logic/publish.js`, `logic/release.js` and `ui/update-bar.js` have no tests.
Fixing the first would change `setupAutoUpdate(mainWindow)`, which four
shipping apps call, so it is deliberately left for a change that has a reason
to touch those apps. New modules do not get to join this list.

