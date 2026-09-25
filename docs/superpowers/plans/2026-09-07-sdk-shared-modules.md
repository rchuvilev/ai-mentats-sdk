# ai-mentat-sdk Shared Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every shared module in `ai-mentat-sdk` — with tests and mutation checks — so the six consuming apps can later delete their duplicated copies.

**Architecture:** Pure logic and IPC-registration functions in CommonJS, one module per subsystem, each requiring only Node builtins plus the `electron` objects passed in by the caller. Nothing imports `electron` directly, so every module is unit-testable under plain `node --test` with no display and no Electron runtime. IPC modules are *registrars*: they take `ipcMain` and a per-app config object and attach handlers, rather than owning app state.

**Tech Stack:** Node >= 22.16, CommonJS, `node:test` + `node:assert` (no test framework), esbuild (bundling only), POSIX `sh` for the mutation harness.

**Spec:** `docs/superpowers/specs/2026-09-07-sdk-extraction-design.md`

## Global Constraints

Copied verbatim from the spec; every task's requirements implicitly include these.

- **No module may `require('electron')`.** Electron objects (`ipcMain`, `shell`, `app`, `BrowserWindow`) are passed in as parameters. This is what keeps the modules testable.
- **Every child process gets an argv array, never a composed command string.** An API key or hostname containing a shell metacharacter must be passed, not executed.
- **`newline` is refused, never stripped**, in any value that reaches a command line or a config file.
- **A missing file is not a failure.** First-run absence reads as empty and must not be recorded in the failsafe buffer, which exists to surface real errors.
- **`limactl list --json` is JSONL** — one object per line, not an array.
- **A VM entry with no status reports `Unknown`, never `Running`.**
- **DevTools are never opened automatically and no option restores it.**
- **`ingress` is a list.** n8n has one HTTP entry, minecraft one UDP entry, coolify two (HTTP + SSH).
- **Secure window defaults:** `nodeIntegration: false`, `contextIsolation: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, `sandbox: false`.
- Test command is the glob form: `node --test 'utils/*.test.js' 'logic/*.test.js' 'ui/*.test.js'`. `node --test <dir>` treats a bare directory as a file named after it and reports a spurious failure.
- Every task ends with the full suite green and, for modules with behavioural rules, a mutation check that fails when the rule is reverted.

---

## File Structure

| File | Responsibility |
|---|---|
| `utils/failsafe.js` | Suppress-and-record helpers. Moved verbatim from the apps. |
| `utils/env.js` | PATH construction and argv-array child-process helpers. |
| `utils/proc.js` | Process-group termination and a run-once cleanup registry. |
| `logic/settings.js` | JSON settings store + `settings:get`/`settings:set`. |
| `logic/shell.js` | `shell:open-external` with an https allowlist; a folder-opening handler body. |
| `logic/lima.js` | Lima resolution, JSONL VM parsing, nerdctl argv. |
| `logic/tunnel.js` | cloudflared config parse/render over an ingress **list**, plus 9 IPC handlers. |
| `logic/mcp.js` | Claude Code MCP registration mechanics; the server identity is per app. |
| `logic/pty.js` | Embedded-terminal IPC and asar-aware helper path resolution. |
| `ui/window.js` | `createWindow(config)` with secure defaults and scoped header rewriting. |
| `ui/base.css` | The stylesheet rules shared by five apps. |
| `build/entitlements.*.plist` | The three signing entitlement files, one copy. |
| `vendor/xterm.js`, `xterm.css`, `addon-fit.js` | One copy of the terminal assets. |
| `test/discriminates.sh` | Mutation harness, parameterised by the consuming repo. |
| `utils/bundle-electron.js` | **Modified** — accept a `.cjs` entry, emit a `.cjs` bundle. |
| `package.json` | **Modified** — `files` array gains `build`, `vendor`, `test`. |
| `README.md` | **Modified** — document each new module. |

Each `<module>.js` has a sibling `<module>.test.js`, which is how the existing
`utils/data-dir.test.js` and `utils/bundle-electron.test.js` are laid out.

**One refinement on the spec's structure:** the spec lists a single
`logic/tunnel.js`. The plan splits it into `logic/tunnel.js` (pure config
parse/render/validate, Task 7) and `logic/tunnel-ipc.js` (the nine handlers,
Task 8). The pure half is ~190 LOC of parsing that three apps depend on and
that carries ten mutation checks; the IPC half is process supervision. A
reviewer could reasonably accept one and reject the other, which is where the
skill says to draw a task boundary — and it keeps each file small enough to
hold in context. Same modules, same exports, two files.

---

### Task 1: `utils/failsafe.js` — move the identical copy

**Files:**
- Create: `utils/failsafe.js`
- Create: `utils/failsafe.test.js`
- Reference (do not modify): `/Users/rchuvilev/Projects/ai-mentat-n8n/lib/failsafe.js`, `/Users/rchuvilev/Projects/ai-mentat-n8n/test/test_failsafe.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `{ quiet, quietAsync, attempt, attemptAsync, recentFailures, clearFailures, setSink }`.
  - `quiet(op: string, fn: () => T, fallback: T, context?: any) -> T`
  - `quietAsync(op, fn: () => Promise<T>, fallback: T, context?) -> Promise<T>` — never rejects
  - `attempt(op, fn: () => void, context?) -> boolean`
  - `attemptAsync(op, fn, context?) -> Promise<boolean>`
  - `recentFailures() -> Array<{at, op, message, context}>` — a copy
  - `clearFailures() -> void`
  - `setSink(fn: (level, op, message, context) => void) -> previousSink`

Every later task in this plan calls `quiet` and `attempt` from here.

- [ ] **Step 1: Copy the file and its test verbatim**

The file is byte-identical in `ai-mentat-n8n`, `ai-mentat-minecraft` and
`ai-mentat-coolify-local` (verified by sha1). Copying is the whole
implementation — do not retype it.

```bash
cd /Users/rchuvilev/Projects/ai-mentat-sdk
cp /Users/rchuvilev/Projects/ai-mentat-n8n/lib/failsafe.js utils/failsafe.js
cp /Users/rchuvilev/Projects/ai-mentat-n8n/test/test_failsafe.js utils/failsafe.test.js
```

- [ ] **Step 2: Point the copied test at the new location**

The app test used `require('../lib/failsafe')`; as a sibling it is `./failsafe`.

```bash
sed -i '' "s|require('../lib/failsafe')|require('./failsafe')|" utils/failsafe.test.js
grep -n "require('./failsafe')" utils/failsafe.test.js
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `node --test 'utils/*.test.js'`
Expected: PASS — 11 failsafe tests plus the existing data-dir and
bundle-electron tests. A move must not change behaviour, so a red suite here
means the copy or the require path is wrong.

- [ ] **Step 4: Add the mutation harness for this module**

Create `test/discriminates.sh` with the shared runner and the failsafe
mutations. Later tasks append their own blocks to this file.

```sh
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

echo
echo "caught $PASS / $((PASS+FAIL))"
[ "$FAIL" -eq 0 ] || exit 1
```

- [ ] **Step 5: Run the mutation harness**

Run: `sh test/discriminates.sh`
Expected: `caught 3 / 3`. A `NOT CAUGHT` line means the copied test does not
actually pin that behaviour — fix the test, not the harness.

- [ ] **Step 6: Wire both into package.json**

Replace the `scripts.test` value and add the mutation script. The glob form is
required (see Global Constraints).

```json
"scripts": {
  "test": "node --test 'utils/*.test.js' 'logic/*.test.js' 'ui/*.test.js'",
  "test:mutation": "sh test/discriminates.sh"
}
```

- [ ] **Step 7: Verify both scripts run from a clean shell**

Run: `npm test && npm run test:mutation`
Expected: suite green, `caught 3 / 3`.

- [ ] **Step 8: Commit**

```bash
git add utils/failsafe.js utils/failsafe.test.js test/discriminates.sh package.json
git commit -m "Add utils/failsafe.js, moved verbatim from the apps

Identical in n8n, minecraft and coolify-local (sha1-verified), so this is a
move rather than a rewrite. Its 11 tests come with it, and test/discriminates.sh
gains the three mutations that prove they discriminate: recording, the bounded
buffer, and recentFailures returning a copy rather than the live array."
```

---

### Task 2: `utils/env.js` — PATH and child processes

**Files:**
- Create: `utils/env.js`
- Create: `utils/env.test.js`
- Modify: `test/discriminates.sh` (append a block)
- Reference: `/Users/rchuvilev/Projects/ai-mentat-n8n/lib/n8n.js` (`buildPath`), `/Users/rchuvilev/Projects/ai-mentat-minecraft/electron-main.js` (`shellEnv`, `run`, `tryRun`)

**Interfaces:**
- Consumes: `utils/failsafe.js` → `quiet`.
- Produces:
  - `buildPath(home: string, platform?: string, envPath?: string) -> string`
  - `shellEnv({ home, platform?, baseEnv?, extra? }) -> object`
  - `run(bin: string, args: string[], opts?: object) -> string` — throws on failure
  - `tryRun(op: string, bin: string, args: string[], opts?: object) -> string|null`

Tasks 6, 7, 8 and 9 all call `shellEnv`, `run` and `tryRun` from here.

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const E = require('./env');

// A GUI app launched from Finder inherits a launchd PATH without Homebrew or
// the user's own bin dirs, which is how "cloudflared is not installed" was
// reported on machines where it plainly was.
test('buildPath prepends the app install locations so they win', () => {
  const p = E.buildPath('/Users/x', 'darwin', '/usr/bin:/bin');
  const parts = p.split(':');
  assert.ok(parts.indexOf('/Users/x/.bun/bin') < parts.indexOf('/usr/bin'),
    'app locations must come before the inherited PATH');
  assert.ok(p.includes('/opt/homebrew/bin'));
  assert.ok(p.endsWith('/usr/bin:/bin'), 'the inherited PATH must survive');
});

test('buildPath falls back to a usable PATH when the environment has none', () => {
  // Pass '' not undefined: undefined triggers the process.env.PATH default
  // parameter and the assertion would then read the test machine's own PATH.
  const p = E.buildPath('/Users/x', 'darwin', '');
  assert.ok(p.includes('/usr/bin:/bin'));
  assert.ok(!p.includes('::'), 'an empty PATH entry means the current directory');
  assert.ok(!p.endsWith(':'));
});

test('buildPath uses Windows separators and locations on win32', () => {
  const p = E.buildPath('C:\\Users\\x', 'win32', 'C:\\Windows');
  assert.ok(p.includes(';'));
  assert.ok(!p.includes('/opt/homebrew/bin'));
  assert.ok(p.includes(path.join('C:\\Users\\x', 'AppData', 'Local', 'Programs', 'claude-code')));
});

test('shellEnv merges the base environment and the extra entries', () => {
  const env = E.shellEnv({
    home: '/Users/x', platform: 'darwin',
    baseEnv: { HOME: '/Users/x', PATH: '/usr/bin' },
    extra: { LIMA_HOME: '/Users/x/.mc-lima' },
  });
  assert.strictEqual(env.HOME, '/Users/x');
  assert.strictEqual(env.LIMA_HOME, '/Users/x/.mc-lima');
  assert.ok(env.PATH.startsWith('/Users/x/.local/bin'));
});

test('shellEnv lets extra override a base entry', () => {
  // lima.js relies on this: LIMA_HOME must win over an inherited one.
  const env = E.shellEnv({
    home: '/Users/x', baseEnv: { LIMA_HOME: '/wrong' }, extra: { LIMA_HOME: '/right' },
  });
  assert.strictEqual(env.LIMA_HOME, '/right');
});

test('run passes arguments as an array, never a shell string', () => {
  // The shipped n8n build interpolated an API key into an execSync string, so
  // a key containing a metacharacter was executed rather than passed.
  const seen = [];
  const out = E.run('echo', ['a b', '$(whoami)'], {
    exec: (bin, args) => { seen.push([bin, args]); return 'ok'; },
  });
  assert.strictEqual(out, 'ok');
  assert.deepStrictEqual(seen[0][1], ['a b', '$(whoami)'],
    'arguments arrive intact and unsplit');
});

test('tryRun returns null on failure instead of throwing', () => {
  const r = E.tryRun('probe.missing', 'nope', ['--version'], {
    exec: () => { throw new Error('ENOENT'); },
  });
  assert.strictEqual(r, null);
});

test('tryRun records the failure under its op label', () => {
  const F = require('./failsafe');
  F.clearFailures();
  const restore = F.setSink(() => {});
  E.tryRun('probe.missing', 'nope', [], { exec: () => { throw new Error('boom'); } });
  F.setSink(restore);
  const ops = F.recentFailures().map((f) => f.op);
  assert.ok(ops.includes('probe.missing'), 'a suppressed failure must be traceable');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test utils/env.test.js`
Expected: FAIL — `Cannot find module './env'`.

- [ ] **Step 3: Write the implementation**

```js
'use strict';
//
// PATH construction and child-process helpers shared by the apps.
//
// WHY PATH IS PREPENDED
// --------------------
// A GUI app launched from Finder inherits a launchd PATH without
// `/opt/homebrew/bin`, `~/.local/bin` or `~/.bun/bin`, so `claude`, `bun` and
// `cloudflared` all read as "not installed" for anyone who did not start the
// app from a terminal. These entries go FIRST so the app's own install
// locations win over whatever else is on the machine.

const { execFileSync } = require('child_process');
const path = require('path');
const { quiet } = require('./failsafe');

function buildPath(home, platform = process.platform, envPath = process.env.PATH) {
  const isWin = platform === 'win32';
  const sep = isWin ? ';' : ':';
  const extra = [path.join(home, '.local', 'bin'), path.join(home, '.bun', 'bin')];
  if (isWin) {
    extra.push(
      path.join(home, 'AppData', 'Roaming', 'npm'),
      path.join(home, 'AppData', 'Local', 'Programs', 'claude-code'),
    );
  } else {
    extra.push('/opt/homebrew/bin', '/usr/local/bin');
  }
  // Guard the empty case: joining onto '' leaves a trailing separator, which
  // some shells read as the current directory.
  const base = envPath || (isWin ? '' : '/usr/bin:/bin');
  return base ? extra.join(sep) + sep + base : extra.join(sep);
}

/**
 * Environment for every child process an app spawns.
 * `extra` wins over `baseEnv` so a caller can pin a variable (lima.js pins
 * LIMA_HOME, which must not be inherited from the user's shell).
 */
function shellEnv({ home, platform = process.platform, baseEnv = process.env, extra = {} }) {
  return {
    ...baseEnv,
    ...extra,
    PATH: buildPath(home, platform, baseEnv.PATH),
  };
}

/**
 * Run a binary with an argument ARRAY — never a composed command string.
 * User input (an API key, a hostname) reaches several call sites, and a value
 * containing a shell metacharacter must be passed, not executed.
 *
 * `opts.exec` is injectable so callers are testable without spawning.
 */
function run(bin, args, opts = {}) {
  const { exec = execFileSync, ...rest } = opts;
  return exec(bin, args, { encoding: 'utf8', ...rest });
}

/** `run` for calls whose failure is expected and non-fatal. */
function tryRun(op, bin, args, opts = {}) {
  return quiet(op, () => run(bin, args, opts), null);
}

module.exports = { buildPath, shellEnv, run, tryRun };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test utils/env.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 5: Append the mutation block**

Insert before the final `echo` in `test/discriminates.sh`:

```sh
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
```

- [ ] **Step 6: Run the mutation harness**

Run: `sh test/discriminates.sh`
Expected: `caught 7 / 7`.

- [ ] **Step 7: Commit**

```bash
git add utils/env.js utils/env.test.js test/discriminates.sh
git commit -m "Add utils/env.js — PATH construction and argv-array exec

Replaces four per-app shellEnv/buildPath variants. Two behaviours are pinned
by mutation checks because both were real bugs: PATH must be PREPENDED (a
Finder-launched app inherits a launchd PATH without Homebrew, so tools read as
missing), and the empty-PATH case must not leave a trailing separator, which
some shells read as the current directory.

run() takes an argv array. The shipped n8n build interpolated the user's n8n
API key into an execSync string, so a key containing a shell metacharacter was
executed rather than passed."
```

---

### Task 3: `utils/proc.js` — process termination

**Files:**
- Create: `utils/proc.js`
- Create: `utils/proc.test.js`
- Modify: `test/discriminates.sh`
- Reference: `/Users/rchuvilev/Projects/ai-mentat-minecraft/electron-main.js` (`killProcess`, `cleanup`)

**Interfaces:**
- Consumes: `utils/failsafe.js` → `attempt`.
- Produces:
  - `killProcess(proc, name: string, { platform?, run?, kill?, setTimeout? }) -> void`
  - `createCleanup(fn: () => void) -> () => void` — runs `fn` at most once

Task 9 (`logic/pty.js`) calls `killProcess`.

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('./proc');

const fakeProc = (pid = 1234) => ({ pid, killed: false, kill() { this.killed = true; } });

test('a POSIX kill targets the process GROUP, not the pid', () => {
  // These apps spawn detached children that outlive a bare kill; the negative
  // pid is what takes the whole group down.
  const signals = [];
  P.killProcess(fakeProc(555), 'server', {
    platform: 'darwin',
    kill: (pid, sig) => signals.push([pid, sig]),
    setTimeout: () => {},
  });
  assert.deepStrictEqual(signals, [[-555, 'SIGTERM']]);
});

test('on Windows it shells out to taskkill with the process tree', () => {
  const calls = [];
  P.killProcess(fakeProc(777), 'server', {
    platform: 'win32',
    run: (bin, args) => calls.push([bin, args]),
    setTimeout: () => {},
  });
  assert.strictEqual(calls[0][0], 'taskkill');
  assert.ok(calls[0][1].includes('/T'), '/T kills the child tree');
  assert.ok(calls[0][1].includes('777'));
});

test('an already-killed process is left alone', () => {
  const proc = fakeProc();
  proc.killed = true;
  let called = false;
  P.killProcess(proc, 'x', { platform: 'darwin', kill: () => { called = true; }, setTimeout: () => {} });
  assert.strictEqual(called, false);
});

test('a null process is not an error', () => {
  assert.doesNotThrow(() => P.killProcess(null, 'x', { setTimeout: () => {} }));
});

test('SIGKILL follows after the grace period if the process survives', () => {
  const signals = [];
  let scheduled = null;
  P.killProcess(fakeProc(42), 'x', {
    platform: 'darwin',
    kill: (pid, sig) => signals.push([pid, sig]),
    setTimeout: (fn, ms) => { scheduled = { fn, ms }; },
  });
  assert.strictEqual(scheduled.ms, 3000);
  scheduled.fn();
  assert.deepStrictEqual(signals, [[-42, 'SIGTERM'], [-42, 'SIGKILL']]);
});

test('a kill failure is suppressed, not thrown', () => {
  // Killing an already-dead process is the expected case, not an incident.
  assert.doesNotThrow(() => P.killProcess(fakeProc(1), 'x', {
    platform: 'darwin',
    kill: () => { throw new Error('ESRCH'); },
    setTimeout: () => {},
  }));
});

test('cleanup runs exactly once however many times it is called', () => {
  // window-all-closed, before-quit, SIGTERM and the window close handler can
  // all fire in one shutdown; running the body four times double-kills.
  let runs = 0;
  const cleanup = P.createCleanup(() => { runs += 1; });
  cleanup(); cleanup(); cleanup();
  assert.strictEqual(runs, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test utils/proc.test.js`
Expected: FAIL — `Cannot find module './proc'`.

- [ ] **Step 3: Write the implementation**

```js
'use strict';
//
// Process termination and shutdown sequencing.
//
// These apps spawn DETACHED children (a server, a tunnel, a PTY), so a bare
// `proc.kill()` leaves the grandchildren running and the port bound. Killing
// the process group is what actually stops them.

const { attempt } = require('./failsafe');

/**
 * Terminate a child and its group: SIGTERM, then SIGKILL after a grace period.
 *
 * `run`, `kill` and `setTimeout` are injectable so this is testable without
 * spawning anything.
 */
function killProcess(proc, name, options = {}) {
  const {
    platform = process.platform,
    kill = process.kill.bind(process),
    run: runFn,
    setTimeout: schedule = setTimeout,
    log = console.log,
  } = options;

  if (!proc || proc.killed) return;
  log(`Terminating ${name} (pid ${proc.pid})...`);

  attempt(`kill.${name}.term`, () => {
    if (platform === 'win32') {
      if (runFn) runFn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      kill(-proc.pid, 'SIGTERM');
    }
  });

  schedule(() => {
    // Killing an already-dead process is the expected case here, so this stays
    // quiet by design rather than being recorded as a failure.
    try {
      if (!proc.killed) {
        if (platform !== 'win32') kill(-proc.pid, 'SIGKILL');
        proc.kill('SIGKILL');
      }
    } catch { /* already gone */ }
  }, 3000);
}

/**
 * Wrap a shutdown routine so it runs at most once.
 *
 * `window-all-closed`, `before-quit`, `SIGTERM` and the window's own `closed`
 * handler can all fire during a single shutdown; without this the body runs
 * four times and double-kills every child.
 */
function createCleanup(fn) {
  let done = false;
  return function cleanup(...args) {
    if (done) return;
    done = true;
    return fn(...args);
  };
}

module.exports = { killProcess, createCleanup };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test utils/proc.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Append the mutation block**

```sh
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
  "    if (done) return;
    done = true;" \
  "    ;"
```

- [ ] **Step 6: Run the mutation harness**

Run: `sh test/discriminates.sh`
Expected: `caught 11 / 11`.

- [ ] **Step 7: Commit**

```bash
git add utils/proc.js utils/proc.test.js test/discriminates.sh
git commit -m "Add utils/proc.js — process-group termination and run-once cleanup

Replaces four per-app killProcess/cleanup pairs. Two behaviours are pinned
because both matter at shutdown: the POSIX path kills the process GROUP
(process.kill(-pid)) since these apps spawn detached children that survive a
bare kill and keep their port bound, and createCleanup runs its body at most
once because window-all-closed, before-quit, SIGTERM and the window's closed
handler can all fire in one shutdown."
```

---

### Task 4: `logic/settings.js` — the JSON settings store

**Files:**
- Create: `logic/settings.js`
- Create: `logic/settings.test.js`
- Modify: `test/discriminates.sh`
- Reference: `/Users/rchuvilev/Projects/ai-mentat-minecraft/electron-main.js` (`loadSettings`, `saveSettings`)

**Interfaces:**
- Consumes: `utils/failsafe.js` → `quiet`, `attempt`.
- Produces:
  - `createSettingsStore({ dir, file?, fs? }) -> { load(), save(patch), path }`
  - `registerSettingsIpc(ipcMain, store) -> void` — attaches `settings:get`, `settings:set`

`logic/tunnel-ipc.js` (Task 8) and `logic/mcp.js` (Task 9) both take a store built here.

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const S = require('./settings');
const F = require('../utils/failsafe');

/** In-memory fs double, so no test touches a disk. */
function fakeFs(initial = {}) {
  const files = { ...initial };
  return {
    files,
    existsSync: (p) => p in files,
    readFileSync: (p) => {
      if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files[p];
    },
    writeFileSync: (p, data) => { files[p] = data; },
    mkdirSync: () => {},
  };
}

test('the settings file lives at dir/file with settings.json as the default', () => {
  assert.strictEqual(createStorePath({}), path.join('/data', 'settings.json'));
  // n8n keeps its own filename so existing user settings are not discarded.
  assert.strictEqual(createStorePath({ file: 'mentat-settings.json' }),
    path.join('/data', 'mentat-settings.json'));
  function createStorePath(opts) {
    return S.createSettingsStore({ dir: '/data', fs: fakeFs(), ...opts }).path;
  }
});

test('a missing file loads as an empty object', () => {
  const store = S.createSettingsStore({ dir: '/data', fs: fakeFs() });
  assert.deepStrictEqual(store.load(), {});
});

test('a missing file is NOT recorded as a failure', () => {
  // First-run absence is expected. Recording it on every status poll floods
  // the bounded failsafe buffer that exists to surface real errors.
  F.clearFailures();
  const restore = F.setSink(() => {});
  S.createSettingsStore({ dir: '/data', fs: fakeFs() }).load();
  F.setSink(restore);
  assert.deepStrictEqual(F.recentFailures(), []);
});

test('a corrupt file loads as empty AND is recorded', () => {
  // Unlike absence, unreadable content is a real problem worth finding.
  F.clearFailures();
  const restore = F.setSink(() => {});
  const store = S.createSettingsStore({ dir: '/data', fs: fakeFs({ '/data/settings.json': '{ truncated' }) });
  assert.deepStrictEqual(store.load(), {});
  F.setSink(restore);
  assert.ok(F.recentFailures().some((f) => f.op === 'settings.read'));
});

test('save merges a patch rather than replacing the document', () => {
  const fs = fakeFs({ '/data/settings.json': JSON.stringify({ a: 1, b: 2 }) });
  const store = S.createSettingsStore({ dir: '/data', fs });
  const merged = store.save({ b: 3, c: 4 });
  assert.deepStrictEqual(merged, { a: 1, b: 3, c: 4 });
  assert.deepStrictEqual(JSON.parse(fs.files['/data/settings.json']), { a: 1, b: 3, c: 4 });
});

test('a failed write is recorded, and the app keeps running', () => {
  const fs = fakeFs();
  fs.writeFileSync = () => { throw new Error('EROFS'); };
  F.clearFailures();
  const restore = F.setSink(() => {});
  const store = S.createSettingsStore({ dir: '/data', fs });
  assert.doesNotThrow(() => store.save({ a: 1 }));
  F.setSink(restore);
  assert.ok(F.recentFailures().some((f) => f.op === 'settings.write'),
    'losing a write means the next launch forgets a change that really happened');
});

test('registerSettingsIpc attaches get and set', async () => {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const store = S.createSettingsStore({ dir: '/data', fs: fakeFs() });
  S.registerSettingsIpc(ipcMain, store);
  assert.deepStrictEqual(Object.keys(handlers).sort(), ['settings:get', 'settings:set']);
  await handlers['settings:set'](null, { theme: 'dark' });
  assert.deepStrictEqual(await handlers['settings:get'](null), { theme: 'dark' });
});

test('settings:set rejects a non-object patch', async () => {
  const handlers = {};
  S.registerSettingsIpc({ handle: (ch, fn) => { handlers[ch] = fn; } },
    S.createSettingsStore({ dir: '/data', fs: fakeFs() }));
  for (const bad of [null, 'nope', 42, ['a']]) {
    const r = await handlers['settings:set'](null, bad);
    assert.strictEqual(r.ok, false, String(bad));
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test logic/settings.test.js`
Expected: FAIL — `Cannot find module './settings'`.

- [ ] **Step 3: Write the implementation**

```js
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
 * @param {string} o.dir   the app's data directory
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
      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test logic/settings.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 5: Append the mutation block**

```sh
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

mutate "settings:set accepts a non-object patch" logic/settings.js \
  "    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {" \
  "    if (false) {"
```

Note: the third mutation also needs the closing `});` to remain balanced —
the harness replaces one occurrence only, and `(() => {` … `});` is still
valid JavaScript (an immediately-invoked arrow), so the file still parses and
the test fails for the right reason.

- [ ] **Step 6: Run the mutation harness**

Run: `sh test/discriminates.sh`
Expected: `caught 15 / 15`.

- [ ] **Step 7: Commit**

```bash
git add logic/settings.js logic/settings.test.js test/discriminates.sh
git commit -m "Add logic/settings.js — JSON settings store plus its IPC

Replaces four per-app loadSettings/saveSettings variants. The filename is a
parameter because n8n stores mentat-settings.json while the other three use
settings.json; renaming n8n's would silently discard existing user settings.

The load path distinguishes a MISSING file from a BROKEN one: absence is the
normal first-run state and is not recorded, because these apps poll status
every few seconds and recording an expected absence each time floods the
bounded failsafe buffer that exists to make real errors findable. Unreadable
content is recorded."
```

---

### Task 5: `logic/shell.js` — guarded shell operations

**Files:**
- Create: `logic/shell.js`
- Create: `logic/shell.test.js`
- Modify: `test/discriminates.sh`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `registerOpenExternal(ipcMain, shell, { channel? }) -> void`
  - `openPathHandler(shell, dirPath) -> () => Promise<{success: boolean}>`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('./shell');

function harness() {
  const handlers = {};
  const opened = [];
  return {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    shell: { openExternal: async (u) => { opened.push(u); }, openPath: async (p) => { opened.push(p); } },
    handlers, opened,
  };
}

test('an https url is opened', async () => {
  const h = harness();
  S.registerOpenExternal(h.ipcMain, h.shell);
  const r = await h.handlers['shell:open-external'](null, 'https://hexstack.app/');
  assert.strictEqual(r.success, true);
  assert.deepStrictEqual(h.opened, ['https://hexstack.app/']);
});

test('every other scheme is refused', async () => {
  // A renderer-supplied string reaching openExternal can otherwise launch
  // file:// or a custom protocol handler registered on the machine.
  const h = harness();
  S.registerOpenExternal(h.ipcMain, h.shell);
  for (const url of [
    'file:///etc/passwd',
    'http://insecure.example',
    'javascript:alert(1)',
    'vscode://file/etc/passwd',
    'data:text/html,<script>1</script>',
  ]) {
    const r = await h.handlers['shell:open-external'](null, url);
    assert.strictEqual(r.success, false, url);
  }
  assert.deepStrictEqual(h.opened, [], 'nothing was launched');
});

test('a non-string or unparseable value is refused without throwing', async () => {
  const h = harness();
  S.registerOpenExternal(h.ipcMain, h.shell);
  for (const bad of [null, undefined, 42, {}, 'not a url', '']) {
    const r = await h.handlers['shell:open-external'](null, bad);
    assert.strictEqual(r.success, false, String(bad));
  }
});

test('the channel name is overridable but defaults to the family name', async () => {
  const h = harness();
  S.registerOpenExternal(h.ipcMain, h.shell);
  assert.ok(h.handlers['shell:open-external'], 'all five apps already use this name');
  const h2 = harness();
  S.registerOpenExternal(h2.ipcMain, h2.shell, { channel: 'shell:open-url' });
  assert.ok(h2.handlers['shell:open-url']);
});

test('openPathHandler opens the path it was built with, taking none from the renderer', async () => {
  // The renderer never passes a filesystem path across the bridge.
  const h = harness();
  const handler = S.openPathHandler(h.shell, '/data/logs');
  const r = await handler(null, '/etc');
  assert.strictEqual(r.success, true);
  assert.deepStrictEqual(h.opened, ['/data/logs'], 'the renderer argument is ignored');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test logic/shell.test.js`
Expected: FAIL — `Cannot find module './shell'`.

- [ ] **Step 3: Write the implementation**

```js
'use strict';
//
// Guarded shell operations.
//
// Only `open-external` is shared, because it carries real logic: a
// renderer-supplied string reaching `shell.openExternal` can launch `file://`
// or any custom protocol handler registered on the machine, so the scheme is
// allowlisted.
//
// Opening a local folder is deliberately NOT unified into one channel. The
// apps name it differently today (`shell:open-logs-dir`, `shell:open-n8n-data`,
// `shell:open-data`) and each handler is a single `shell.openPath(dir)` call.
// A generic channel plus a name→path registry would mean editing five preloads
// and five renderers for no behaviour change. `openPathHandler` gives them a
// shared BODY while each keeps its own channel name.

const HTTPS = 'https:';

/** Attach an https-only external-link handler. */
function registerOpenExternal(ipcMain, shell, { channel = 'shell:open-external' } = {}) {
  ipcMain.handle(channel, async (_, url) => {
    if (typeof url !== 'string') return { success: false };
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { success: false };
    }
    if (parsed.protocol !== HTTPS) return { success: false };
    await shell.openExternal(parsed.toString());
    return { success: true };
  });
}

/**
 * A handler body that opens ONE fixed path.
 * The path is bound at registration, so the renderer cannot choose it — it
 * never passes a filesystem path across the bridge.
 */
function openPathHandler(shell, dirPath) {
  return async () => {
    await shell.openPath(dirPath);
    return { success: true };
  };
}

module.exports = { registerOpenExternal, openPathHandler, HTTPS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test logic/shell.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Append the mutation block**

```sh
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
```

- [ ] **Step 6: Run the mutation harness**

Run: `sh test/discriminates.sh`
Expected: `caught 19 / 19`.

- [ ] **Step 7: Commit**

```bash
git add logic/shell.js logic/shell.test.js test/discriminates.sh
git commit -m "Add logic/shell.js — https-only external links

open-external is shared because it carries real logic: a renderer-supplied
string reaching shell.openExternal can otherwise launch file:// or any custom
protocol handler registered on the machine. All five apps already use this
channel name, so nothing renames.

Opening a local folder is deliberately NOT unified into one channel. The three
apps name it differently and each handler is a single shell.openPath call;
a generic channel plus a path registry would mean editing five preloads and
five renderers for no behaviour change. openPathHandler shares the body and
binds the path at registration, so the renderer never passes a filesystem path
across the bridge."
```

---

### Task 6: `logic/lima.js` — Lima VM resolution and status

**Files:**
- Create: `logic/lima.js`
- Create: `logic/lima.test.js`
- Modify: `test/discriminates.sh`
- Reference: `/Users/rchuvilev/Projects/ai-mentat-coolify-local/lib/lima.js`, `/Users/rchuvilev/Projects/ai-mentat-minecraft/lib/runtime.js`

**Interfaces:**
- Consumes: nothing (probes are injected).
- Produces:
  - `resolveLimactl({ bundledPath, exists, canRun }) -> string|null`
  - `limaHome(homedir, dirName) -> string`
  - `limaEnv(homedir, dirName, baseEnv?) -> object`
  - `nerdctlArgs(vmName, args: string[]) -> string[]`
  - `parseVmList(output: string) -> { vms: object[], skipped: string[] }`
  - `vmStatus(output: string, vmName: string) -> string`
  - `isVmUsable(status: string) -> boolean`
  - `missingLimaMessage({ downloadScript }) -> string`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const L = require('./lima');

const only = (...paths) => (p) => paths.includes(p);

// ─── VM listing ──────────────────────────────────────────────────────────

test('parseVmList reads JSONL — one object per line, not an array', () => {
  // A single JSON.parse of the whole blob works on a one-VM machine and fails
  // on every multi-VM one, which is exactly the case a clean-machine test
  // never reaches.
  const out = '{"name":"mc","status":"Running"}\n{"name":"coolify","status":"Stopped"}\n';
  const { vms, skipped } = L.parseVmList(out);
  assert.strictEqual(vms.length, 2);
  assert.deepStrictEqual(skipped, []);
});

test('parseVmList skips a malformed line, records it, and keeps the good ones', () => {
  const out = '{"name":"mc","status":"Running"}\nnot json\n{"name":"b","status":"Stopped"}\n';
  const { vms, skipped } = L.parseVmList(out);
  assert.strictEqual(vms.length, 2);
  assert.strictEqual(skipped.length, 1);
});

test('parseVmList tolerates empty and blank output', () => {
  for (const out of ['', '\n\n', null, undefined]) {
    assert.deepStrictEqual(L.parseVmList(out), { vms: [], skipped: [] }, String(out));
  }
});

test('vmStatus returns a STRING, never a boolean', () => {
  // Stopped, Broken and Absent each need different UI and a different remedy.
  assert.strictEqual(L.vmStatus('{"name":"mc","status":"Stopped"}\n', 'mc'), 'Stopped');
  assert.strictEqual(L.vmStatus('{"name":"mc","status":"Broken"}\n', 'mc'), 'Broken');
  assert.strictEqual(L.vmStatus('{"name":"other","status":"Running"}\n', 'mc'), 'Absent');
  assert.strictEqual(L.vmStatus('', 'mc'), 'Absent');
});

test('a VM entry with no status is Unknown, never Running', () => {
  // Defaulting to Running makes the app try to use a dead VM.
  assert.strictEqual(L.vmStatus('{"name":"mc"}\n', 'mc'), 'Unknown');
});

test('only Running counts as usable', () => {
  assert.strictEqual(L.isVmUsable('Running'), true);
  for (const s of ['Stopped', 'Broken', 'Absent', 'Unknown', '', null]) {
    assert.strictEqual(L.isVmUsable(s), false, String(s));
  }
});

// ─── limactl resolution ──────────────────────────────────────────────────

test('the bundled binary wins over anything installed', () => {
  // Behaviour must not change based on what the user happens to have.
  const found = L.resolveLimactl({ bundledPath: '/app/lima-bin/limactl', exists: () => true, canRun: () => true });
  assert.strictEqual(found, '/app/lima-bin/limactl');
});

test('a present-but-unrunnable binary does not abort the search', () => {
  // It is as useless as a missing one, so the search continues.
  const found = L.resolveLimactl({
    bundledPath: '/app/lima-bin/limactl',
    exists: only('/app/lima-bin/limactl', '/opt/homebrew/bin/limactl'),
    canRun: (p) => p === '/opt/homebrew/bin/limactl',
  });
  assert.strictEqual(found, '/opt/homebrew/bin/limactl');
});

test('Homebrew locations are reachable for a Finder-launched app', () => {
  // A GUI app inherits a launchd PATH without /opt/homebrew/bin, so a working
  // `brew install lima` was reported as "not installed".
  const found = L.resolveLimactl({
    bundledPath: null,
    exists: only('/opt/homebrew/bin/limactl'),
    canRun: (p) => p === '/opt/homebrew/bin/limactl',
  });
  assert.strictEqual(found, '/opt/homebrew/bin/limactl');
});

test('a bare limactl on PATH is used when nothing else resolves', () => {
  const found = L.resolveLimactl({ bundledPath: null, exists: () => false, canRun: (p) => p === 'limactl' });
  assert.strictEqual(found, 'limactl');
});

test('resolveLimactl returns null when Lima is genuinely absent', () => {
  assert.strictEqual(L.resolveLimactl({ bundledPath: null, exists: () => false, canRun: () => false }), null);
});

// ─── homes and argv ──────────────────────────────────────────────────────

test('lima home is per app and short by necessity', () => {
  // Lima puts its control socket inside its home; macOS UNIX_PATH_MAX is 104
  // bytes and overrunning it fails as a confusing "socket path too long".
  assert.strictEqual(L.limaHome('/Users/x', '.mc-lima'), path.join('/Users/x', '.mc-lima'));
  assert.ok(L.limaHome('/Users/x', '.mc-lima').length < 40);
});

test('limaEnv pins LIMA_HOME over an inherited value', () => {
  // The default (~/.lima) is a different path and a different set of VMs.
  const env = L.limaEnv('/Users/x', '.mc-lima', { LIMA_HOME: '/wrong', PATH: '/bin' });
  assert.strictEqual(env.LIMA_HOME, '/Users/x/.mc-lima');
  assert.strictEqual(env.PATH, '/bin');
});

test('nerdctl runs through the named VM with sudo', () => {
  // containerd runs as a system service in these VMs, not rootless.
  assert.deepStrictEqual(L.nerdctlArgs('mc', ['ps']), ['shell', 'mc', 'sudo', 'nerdctl', 'ps']);
  assert.throws(() => L.nerdctlArgs('mc', 'ps'), TypeError);
  assert.throws(() => L.nerdctlArgs('', ['ps']), TypeError);
});

test('the missing-Lima message names both remedies', () => {
  // Either genuinely fixes it, and which is right depends on whether the user
  // wants the app-local copy.
  const msg = L.missingLimaMessage({ downloadScript: 'npm run download:lima' });
  assert.ok(msg.includes('npm run download:lima'));
  assert.ok(msg.includes('brew install lima'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test logic/lima.test.js`
Expected: FAIL — `Cannot find module './lima'`.

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test logic/lima.test.js`
Expected: PASS — 15 tests.

- [ ] **Step 5: Append the mutation block**

```sh
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
```

- [ ] **Step 6: Run the mutation harness**

Run: `sh test/discriminates.sh`
Expected: `caught 28 / 28`.

- [ ] **Step 7: Commit**

```bash
git add logic/lima.js logic/lima.test.js test/discriminates.sh
git commit -m "Add logic/lima.js — merged from coolify and minecraft

coolify's lib/lima.js and the Lima half of minecraft's lib/runtime.js both
implemented parseVmList, vmStatus, isVmUsable and a resolution search. One
module now, with the VM name and lima home as parameters (minecraft uses
~/.mc-lima and VM mc; the short home is required because Lima's control socket
lives inside it and macOS UNIX_PATH_MAX is 104 bytes).

Four behaviours are mutation-pinned because each was a real bug: limactl list
--json is JSONL so a single JSON.parse fails on any multi-VM machine; a VM
entry with no status is Unknown never Running, or the app tries to use a dead
VM; an unrunnable binary must not end the resolution search; and sudo is
mandatory because containerd runs as a system service in these VMs.

Container-specific helpers stay in minecraft — one consumer."
```

---

### Task 7: `logic/tunnel.js` — cloudflared config over an ingress LIST

**Files:**
- Create: `logic/tunnel.js`
- Create: `logic/tunnel.test.js`
- Modify: `test/discriminates.sh`
- Reference: `/Users/rchuvilev/Projects/ai-mentat-n8n/lib/cloudflared.js` (single HTTP service), `/Users/rchuvilev/Projects/ai-mentat-minecraft/lib/cloudflared.js` (single UDP service), `/Users/rchuvilev/Projects/ai-mentat-coolify-local/electron-main.js:690-730` (**two** services: HTTP + SSH)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseTunnelConfig(text: string) -> { tunnel: string|null, credentialsFile: string|null, ingress: Array<{hostname: string|null, service: string|null}> }`
  - `findIngress(config, { scheme: string, port: number }) -> string|null` — the hostname
  - `isConfigured(config, services: Array<{scheme, port}>) -> boolean`
  - `renderTunnelConfig({ tunnelId, credentialsFile, ingress: Array<{hostname, scheme, port}> }) -> string`
  - `parseTunnelId(output: string) -> string|null`
  - `isValidHostname(value) -> boolean`
  - `isTunnelConnectedLine(text) -> boolean`
  - `normalizeService(service: string) -> string`
  - `CLOUDFLARED_SERVICE_404` constant

Task 8 (`registerTunnelIpc`) consumes all of these.

**This is the task the spec's ingress-list correction exists for.** n8n needs one HTTP entry, minecraft one UDP entry, coolify **two** (`http://localhost:8000` and `ssh://localhost:2222`). A single-service API — the obvious one from reading only n8n and minecraft — serves two apps and silently breaks the third.

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('./tunnel');

const OURS = `tunnel: 8f1c9e64-1111-2222-3333-444455556666
credentials-file: /home/u/.cloudflared/8f1c9e64-1111-2222-3333-444455556666.json

ingress:
  - hostname: n8n.example.com
    service: http://localhost:5678
  - service: http_status:404

metrics: 127.0.0.1:0
`;

// ─── Reading ─────────────────────────────────────────────────────────────

test('parses a config this family wrote', () => {
  const cfg = T.parseTunnelConfig(OURS);
  assert.strictEqual(cfg.tunnel, '8f1c9e64-1111-2222-3333-444455556666');
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 5678 }), 'n8n.example.com');
});

test('parses an entry with the keys in the OTHER order', () => {
  // Valid YAML that cloudflared honours. The shipped build matched the
  // `service:` line and read the hostname from the line ABOVE it, so this read
  // as "no tunnel configured" and the app offered to create a second tunnel
  // over a working one.
  const cfg = T.parseTunnelConfig(`tunnel: abc
ingress:
  - service: http://localhost:5678
    hostname: n8n.example.com
  - service: http_status:404
`);
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 5678 }), 'n8n.example.com');
});

test('COOLIFY: reads both of two ingress entries', () => {
  // The case a single-service API would have broken.
  const cfg = T.parseTunnelConfig(`tunnel: abc
credentials-file: /c/abc.json

ingress:
  - hostname: coolify.example.com
    service: http://localhost:8000
  - hostname: ssh.example.com
    service: ssh://localhost:2222
  - service: http_status:404
`);
  assert.strictEqual(cfg.ingress.length, 3);
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 8000 }), 'coolify.example.com');
  assert.strictEqual(T.findIngress(cfg, { scheme: 'ssh', port: 2222 }), 'ssh.example.com');
});

test('findIngress matches on BOTH scheme and port', () => {
  // A shared cloudflared config must not hand back another app's hostname.
  const cfg = T.parseTunnelConfig(`tunnel: abc
ingress:
  - hostname: grafana.example.com
    service: http://localhost:3000
  - hostname: mc.example.com
    service: udp://localhost:19132
  - service: http_status:404
`);
  assert.strictEqual(T.findIngress(cfg, { scheme: 'udp', port: 19132 }), 'mc.example.com');
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 19132 }), null,
    'right port, wrong scheme — a udp game cannot ride an http ingress');
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 5678 }), null);
});

test('127.0.0.1 and localhost are the same service', () => {
  const cfg = T.parseTunnelConfig(`tunnel: abc
ingress:
  - hostname: mc.example.com
    service: udp://127.0.0.1:19132
  - service: http_status:404
`);
  assert.strictEqual(T.findIngress(cfg, { scheme: 'udp', port: 19132 }), 'mc.example.com');
});

test('comments and quotes are stripped from a hostname', () => {
  const cfg = T.parseTunnelConfig(`tunnel: abc
ingress:
  - hostname: "n8n.example.com"   # the editor
    service: http://localhost:5678
  - service: http_status:404
`);
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 5678 }), 'n8n.example.com');
});

test('junk reads as not-configured instead of throwing', () => {
  for (const input of ['', null, undefined, '\t\n', 'not yaml at all', 'ingress:\n  - \n']) {
    const cfg = T.parseTunnelConfig(input);
    assert.strictEqual(cfg.tunnel, null, String(input));
    assert.strictEqual(T.isConfigured(cfg, [{ scheme: 'http', port: 1 }]), false);
  }
});

test('isConfigured needs a tunnel id AND every declared service', () => {
  // An id with no hostname routes nothing; a hostname with no id cannot run.
  const both = T.parseTunnelConfig(`tunnel: abc
ingress:
  - hostname: a.example.com
    service: http://localhost:8000
  - hostname: b.example.com
    service: ssh://localhost:2222
  - service: http_status:404
`);
  const services = [{ scheme: 'http', port: 8000 }, { scheme: 'ssh', port: 2222 }];
  assert.strictEqual(T.isConfigured(both, services), true);

  const onlyHttp = T.parseTunnelConfig(`tunnel: abc
ingress:
  - hostname: a.example.com
    service: http://localhost:8000
  - service: http_status:404
`);
  assert.strictEqual(T.isConfigured(onlyHttp, services), false,
    'a partially configured two-service tunnel is not configured');
  assert.strictEqual(T.isConfigured(onlyHttp, [services[0]]), true);
});

// ─── Writing ─────────────────────────────────────────────────────────────

test('render round-trips through the parser, for one service and for two', () => {
  const one = T.renderTunnelConfig({
    tunnelId: 'x', credentialsFile: '/c/x.json',
    ingress: [{ hostname: 'mc.example.com', scheme: 'udp', port: 19132 }],
  });
  assert.strictEqual(T.findIngress(T.parseTunnelConfig(one), { scheme: 'udp', port: 19132 }), 'mc.example.com');

  const two = T.renderTunnelConfig({
    tunnelId: 'y', credentialsFile: '/c/y.json',
    ingress: [
      { hostname: 'app.example.com', scheme: 'http', port: 8000 },
      { hostname: 'ssh.example.com', scheme: 'ssh', port: 2222 },
    ],
  });
  const cfg = T.parseTunnelConfig(two);
  assert.strictEqual(T.findIngress(cfg, { scheme: 'http', port: 8000 }), 'app.example.com');
  assert.strictEqual(T.findIngress(cfg, { scheme: 'ssh', port: 2222 }), 'ssh.example.com');
});

test('render always ends with the mandatory catch-all', () => {
  // cloudflared refuses to start a config whose ingress has no final
  // catch-all rule.
  const cfg = T.parseTunnelConfig(T.renderTunnelConfig({
    tunnelId: 'x', credentialsFile: '/c/x.json',
    ingress: [{ hostname: 'h.example.com', scheme: 'http', port: 1 }],
  }));
  assert.strictEqual(cfg.ingress[cfg.ingress.length - 1].service, T.CLOUDFLARED_SERVICE_404);
});

test('render refuses a config that cannot work', () => {
  const ing = [{ hostname: 'h.example.com', scheme: 'http', port: 1 }];
  assert.throws(() => T.renderTunnelConfig({ credentialsFile: '/c', ingress: ing }), /tunnelId/);
  assert.throws(() => T.renderTunnelConfig({ tunnelId: 'x', credentialsFile: '/c', ingress: [] }), /ingress/);
  assert.throws(() => T.renderTunnelConfig({
    tunnelId: 'x', credentialsFile: '/c', ingress: [{ scheme: 'http', port: 1 }],
  }), /hostname/);
});

// ─── Values that reach a command line ────────────────────────────────────

test('parseTunnelId extracts the UUID cloudflared reports', () => {
  assert.strictEqual(
    T.parseTunnelId('Created tunnel mentat with id 8f1c9e64-1111-2222-3333-444455556666'),
    '8f1c9e64-1111-2222-3333-444455556666');
  assert.strictEqual(T.parseTunnelId('something went wrong'), null);
  assert.strictEqual(T.parseTunnelId(''), null);
});

test('isValidHostname accepts real hostnames', () => {
  for (const h of ['n8n.example.com', 'a.b.c.example.co.uk', 'mc-1.example.com']) {
    assert.strictEqual(T.isValidHostname(h), true, h);
  }
});

test('isValidHostname rejects shell metacharacters', () => {
  // This value reaches `cloudflared tunnel route dns` and a generated config.
  for (const h of [
    'n8n.example.com; rm -rf /', 'a && curl evil.sh', '$(whoami).example.com',
    'a`id`.example.com', 'a | tee /tmp/x', 'host name.example.com',
  ]) {
    assert.strictEqual(T.isValidHostname(h), false, h);
  }
});

test('isValidHostname rejects malformed names', () => {
  for (const h of ['', '   ', 'localhost', 'a.example.com.', '-bad.example.com', 'a'.repeat(300), null, 42]) {
    assert.strictEqual(T.isValidHostname(h), false, String(h));
  }
});

test('isTunnelConnectedLine only fires on the edge registration line', () => {
  assert.strictEqual(T.isTunnelConnectedLine('INF Registered tunnel connection connIndex=0'), true);
  assert.strictEqual(T.isTunnelConnectedLine('INF Starting tunnel'), false);
  assert.strictEqual(T.isTunnelConnectedLine(undefined), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test logic/tunnel.test.js`
Expected: FAIL — `Cannot find module './tunnel'`.

- [ ] **Step 3: Write the implementation**

```js
'use strict';
//
// cloudflared config parsing and rendering, over an ingress LIST.
//
// WHY A LIST AND NOT ONE SERVICE
// ------------------------------
// n8n tunnels one HTTP service (localhost:5678); minecraft one UDP service
// (localhost:19132, RakNet); coolify TWO — its web UI on http://localhost:8000
// AND ssh://localhost:2222. An API shaped around a single service would have
// served two of the three apps and silently broken the third.
//
// WHY ENTRIES ARE PARSED WHOLE
// ----------------------------
// The shipped implementations scanned for a line matching the service URL and
// took the hostname from the line ABOVE it. A hand-edited entry with the keys
// in the other order —
//
//     - service: http://localhost:5678
//       hostname: n8n.example.com
//
// — is valid YAML that cloudflared honours, and it read as "no tunnel
// configured"; the app then offered to create a second tunnel over a working
// one. Parsing whole entries fixes that class of bug.
//
// This is deliberately not a full YAML parser: no dependency is worth it here,
// and a partial parse must never throw — a bad config reads as "not
// configured", it does not crash the tunnel tab.

const CLOUDFLARED_SERVICE_404 = 'http_status:404';

/** Strip a trailing `# comment` and surrounding quotes/space from a scalar. */
function cleanScalar(raw) {
  if (typeof raw !== 'string') return '';
  let v = raw.trim();
  // '#' only starts a comment at the start or after whitespace, so a legal
  // value like `a#b` survives.
  const hash = v.search(/(^|\s)#/);
  if (hash !== -1) v = v.slice(0, hash === 0 ? 0 : hash).trim();
  return v.replace(/^["']|["']$/g, '').trim();
}

function applyKey(entry, key, value) {
  const v = cleanScalar(value);
  if (key === 'hostname') entry.hostname = v || null;
  if (key === 'service') entry.service = v || null;
}

/** `udp://127.0.0.1:19132` and `udp://localhost:19132` mean the same thing. */
function normalizeService(service) {
  return String(service).trim().replace('127.0.0.1', 'localhost').replace(/\/+$/, '');
}

function parseTunnelConfig(text) {
  const empty = { tunnel: null, credentialsFile: null, ingress: [] };
  if (typeof text !== 'string' || !text.trim()) return empty;

  let tunnel = null;
  let credentialsFile = null;
  const ingress = [];
  let inIngress = false;
  let current = null;

  const pushCurrent = () => {
    if (current) ingress.push(current);
    current = null;
  };

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    // A top-level key is unindented, and reaching one ends the ingress block.
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      pushCurrent();
      inIngress = top[1] === 'ingress';
      if (top[1] === 'tunnel') tunnel = cleanScalar(top[2]) || null;
      if (top[1] === 'credentials-file') credentialsFile = cleanScalar(top[2]) || null;
      continue;
    }
    if (!inIngress) continue;

    // `- hostname: x` / `- service: y` opens a new entry.
    const item = line.match(/^\s*-\s*(.*)$/);
    if (item) {
      pushCurrent();
      current = { hostname: null, service: null };
      const inline = item[1].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (inline) applyKey(current, inline[1], inline[2]);
      continue;
    }

    // A continuation key belongs to the entry opened above it. Order-free.
    const kv = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv && current) applyKey(current, kv[1], kv[2]);
  }
  pushCurrent();

  return { tunnel, credentialsFile, ingress };
}

/** The hostname routed to `scheme://localhost:port`, or null. */
function findIngress(config, { scheme, port }) {
  const wanted = normalizeService(`${scheme}://localhost:${port}`);
  const match = (config.ingress || []).find(
    (e) => e.service && normalizeService(e.service) === wanted && e.hostname,
  );
  return match ? match.hostname : null;
}

/**
 * A tunnel is configured only when it has an id AND a hostname for EVERY
 * service the app declares. A partially configured two-service tunnel would
 * otherwise report ready and then fail to route half its traffic.
 */
function isConfigured(config, services) {
  if (!config || !config.tunnel) return false;
  if (!Array.isArray(services) || services.length === 0) return false;
  return services.every((s) => findIngress(config, s) !== null);
}

/**
 * Render the config.yml this family manages.
 * The trailing `http_status:404` is mandatory — cloudflared refuses to start
 * a config whose ingress list has no final catch-all.
 */
function renderTunnelConfig({ tunnelId, credentialsFile, ingress }) {
  if (!tunnelId) throw new Error('renderTunnelConfig: tunnelId is required');
  if (!Array.isArray(ingress) || ingress.length === 0) {
    throw new Error('renderTunnelConfig: ingress must be a non-empty array');
  }
  const lines = [`tunnel: ${tunnelId}`, `credentials-file: ${credentialsFile}`, '', 'ingress:'];
  for (const entry of ingress) {
    if (!entry.hostname) throw new Error('renderTunnelConfig: every ingress entry needs a hostname');
    lines.push(`  - hostname: ${entry.hostname}`);
    lines.push(`    service: ${entry.scheme}://localhost:${entry.port}`);
  }
  lines.push(`  - service: ${CLOUDFLARED_SERVICE_404}`, '', 'metrics: 127.0.0.1:0', '');
  return lines.join('\n');
}

/** Pull the tunnel UUID out of `cloudflared tunnel create` output. */
function parseTunnelId(output) {
  const m = String(output || '').match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return m ? m[0] : null;
}

/**
 * Reject anything that is not a plain DNS hostname. This value reaches
 * `cloudflared tunnel route dns` and the generated YAML, so an unvalidated
 * string is an injection point as well as a corrupt-config source.
 */
function isValidHostname(value) {
  if (typeof value !== 'string') return false;
  const host = value.trim();
  if (!host || host.length > 253) return false;
  if (host.startsWith('-') || host.endsWith('-') || host.endsWith('.')) return false;
  // At least one dot: a tunnel must point at a real FQDN.
  if (!host.includes('.')) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host);
}

/** cloudflared logs this once a connection is registered with the edge. */
function isTunnelConnectedLine(text) {
  return typeof text === 'string' && text.includes('Registered tunnel connection');
}

module.exports = {
  CLOUDFLARED_SERVICE_404,
  cleanScalar,
  normalizeService,
  parseTunnelConfig,
  findIngress,
  isConfigured,
  renderTunnelConfig,
  parseTunnelId,
  isValidHostname,
  isTunnelConnectedLine,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test logic/tunnel.test.js`
Expected: PASS — 16 tests.

- [ ] **Step 5: Append the mutation block**

```sh
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
```

- [ ] **Step 6: Run the mutation harness**

Run: `sh test/discriminates.sh`
Expected: `caught 38 / 38`.

- [ ] **Step 7: Commit**

```bash
git add logic/tunnel.js logic/tunnel.test.js test/discriminates.sh
git commit -m "Add logic/tunnel.js — cloudflared config over an ingress LIST

Replaces three per-app implementations. The list is the point: n8n tunnels one
HTTP service, minecraft one UDP service, and coolify TWO (http://localhost:8000
plus ssh://localhost:2222). An API shaped around a single service — the obvious
one from reading only n8n and minecraft — would have served two apps and
silently broken the third.

Entries are parsed WHOLE rather than by matching the service line and reading
the hostname from the line above it. That line-pair approach fails on a
hand-edited entry with the keys in the other order, which is valid YAML that
cloudflared honours; it read as \"no tunnel configured\" and the app then
offered to create a second tunnel over a working one.

isConfigured requires a hostname for EVERY declared service, so a half-routed
two-service tunnel does not report ready. findIngress matches on scheme AND
port, so a shared cloudflared config cannot hand back another app's hostname
and a UDP game cannot be pointed at an HTTP ingress."
```

---

### Task 8: `logic/tunnel-ipc.js` — the nine tunnel handlers

**Files:**
- Create: `logic/tunnel-ipc.js`
- Create: `logic/tunnel-ipc.test.js`
- Modify: `test/discriminates.sh`

**Interfaces:**
- Consumes: `logic/tunnel.js` (all exports), `logic/settings.js` → a store, `utils/failsafe.js` → `quiet`.
- Produces: `registerTunnelIpc(ipcMain, config) -> void`, where `config` is:

```js
{
  getWindow,        // () => BrowserWindow|null — a function, because macOS
                    //   recreates the window on `activate`
  tunnelName,       // 'mentat' (n8n), 'mentat-mc' (minecraft), etc.
  services,         // [{ name, scheme, port }] — the ingress list
  settings,         // store from logic/settings.js; persists publicDomain
  configPath,       // ~/.cloudflared/config.yml
  credentialsDir,   // ~/.cloudflared
  deps: { run, tryRun, spawn, fs },
  note,             // optional string returned by setup-tunnel (minecraft's
                    //   UDP caveat)
}
```

Attaches: `cloudflared:check`, `cloudflared:install`, `cloudflared:auth-status`, `cloudflared:login`, `cloudflared:tunnel-status`, `cloudflared:setup-tunnel`, `tunnel:start`, `tunnel:stop`, `tunnel:status`.

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('./tunnel-ipc');

function harness(overrides = {}) {
  const handlers = {};
  const sent = [];
  const files = { ...(overrides.files || {}) };
  const calls = [];
  const settingsData = {};
  const config = {
    getWindow: () => ({ isDestroyed: () => false, webContents: { send: (ch, p) => sent.push([ch, p]) } }),
    tunnelName: 'mentat',
    services: [{ name: 'web', scheme: 'http', port: 5678 }],
    settings: { load: () => ({ ...settingsData }), save: (p) => Object.assign(settingsData, p) },
    configPath: '/home/u/.cloudflared/config.yml',
    credentialsDir: '/home/u/.cloudflared',
    deps: {
      run: (bin, args) => { calls.push([bin, ...args]); return overrides.runOut || ''; },
      tryRun: (op, bin, args) => { calls.push([bin, ...args]); return overrides.tryRunOut ?? ''; },
      spawn: () => ({ stdout: { on() {} }, stderr: { on() {} }, on() {}, kill() {}, killed: false }),
      fs: {
        existsSync: (p) => p in files,
        readFileSync: (p) => files[p],
        writeFileSync: (p, d) => { files[p] = d; },
        mkdirSync: () => {},
      },
    },
    ...overrides.config,
  };
  R.registerTunnelIpc({ handle: (ch, fn) => { handlers[ch] = fn; } }, config);
  return { handlers, sent, files, calls, settingsData };
}

test('all nine channels are attached', () => {
  const h = harness();
  assert.deepStrictEqual(Object.keys(h.handlers).sort(), [
    'cloudflared:auth-status', 'cloudflared:check', 'cloudflared:install',
    'cloudflared:login', 'cloudflared:setup-tunnel', 'cloudflared:tunnel-status',
    'tunnel:start', 'tunnel:status', 'tunnel:stop',
  ]);
});

test('auth-status reports on the presence of cert.pem', async () => {
  const absent = harness();
  assert.strictEqual((await absent.handlers['cloudflared:auth-status']()).authenticated, false);
  const present = harness({ files: { '/home/u/.cloudflared/cert.pem': '' } });
  assert.strictEqual((await present.handlers['cloudflared:auth-status']()).authenticated, true);
});

test('tunnel-status reads the real config and reports every service', async () => {
  const h = harness({
    files: {
      '/home/u/.cloudflared/config.yml': `tunnel: abc
ingress:
  - hostname: n8n.example.com
    service: http://localhost:5678
  - service: http_status:404
`,
    },
  });
  const r = await h.handlers['cloudflared:tunnel-status']();
  assert.strictEqual(r.configured, true);
  assert.strictEqual(r.tunnelName, 'abc');
  assert.deepStrictEqual(r.hostnames, { web: 'n8n.example.com' });
});

test('setup-tunnel refuses an invalid hostname before running anything', async () => {
  const h = harness();
  const r = await h.handlers['cloudflared:setup-tunnel'](null, 'evil.com; rm -rf /');
  assert.strictEqual(r.success, false);
  assert.match(r.error, /not a valid hostname/);
  assert.deepStrictEqual(h.calls, [], 'nothing was executed');
});

test('setup-tunnel refuses an empty hostname', async () => {
  const h = harness();
  assert.strictEqual((await h.handlers['cloudflared:setup-tunnel'](null, '   ')).success, false);
  assert.strictEqual((await h.handlers['cloudflared:setup-tunnel'](null, null)).success, false);
});

test('setup-tunnel writes one ingress entry per declared service', async () => {
  const h = harness({
    config: { services: [
      { name: 'web', scheme: 'http', port: 8000 },
      { name: 'ssh', scheme: 'ssh', port: 2222 },
    ] },
    runOut: 'Created tunnel mentat with id 8f1c9e64-1111-2222-3333-444455556666',
  });
  const r = await h.handlers['cloudflared:setup-tunnel'](null, 'app.example.com');
  assert.strictEqual(r.success, true);
  const written = h.files['/home/u/.cloudflared/config.yml'];
  assert.ok(written.includes('service: http://localhost:8000'));
  assert.ok(written.includes('service: ssh://localhost:2222'),
    'coolify needs both entries; one would half-route the tunnel');
});

test('setup-tunnel persists the domain so the app can hand it to a child', async () => {
  const h = harness({ runOut: 'id 8f1c9e64-1111-2222-3333-444455556666' });
  await h.handlers['cloudflared:setup-tunnel'](null, 'n8n.example.com');
  assert.strictEqual(h.settingsData.publicDomain, 'n8n.example.com');
});

test('setup-tunnel passes the hostname as an argv entry, not a shell string', async () => {
  const h = harness({ runOut: 'id 8f1c9e64-1111-2222-3333-444455556666' });
  await h.handlers['cloudflared:setup-tunnel'](null, 'n8n.example.com');
  const dns = h.calls.find((c) => c.includes('route'));
  assert.ok(dns, 'a DNS route is created');
  assert.ok(dns.includes('n8n.example.com'), 'the hostname is its own argv entry');
});

test('tunnel:start refuses when nothing is configured', async () => {
  const h = harness();
  const r = await h.handlers['tunnel:start']();
  assert.strictEqual(r.success, false);
  assert.match(r.error, /No tunnel configured/);
});

test('tunnel:status reports not-running before a start', async () => {
  const h = harness();
  assert.deepStrictEqual(await h.handlers['tunnel:status'](), { running: false, url: null });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test logic/tunnel-ipc.test.js`
Expected: FAIL — `Cannot find module './tunnel-ipc'`.

- [ ] **Step 3: Write the implementation**

```js
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
      return resolve({ success: false, error: e.message });
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
    return { configured: T.isConfigured(cfg, services), tunnelName: cfg.tunnel, hostnames };
  });

  ipcMain.handle('cloudflared:setup-tunnel', async (_, domain) => {
    const hostname = typeof domain === 'string' ? domain.trim() : '';
    if (!hostname) return { success: false, error: 'Domain is required' };
    // Validated BEFORE anything runs: this value reaches a command line and a
    // config file.
    if (!T.isValidHostname(hostname)) {
      return { success: false, error: `"${hostname}" is not a valid hostname — use something like app.example.com` };
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
            return { success: false, error: `DNS route failed for ${entry.hostname}: ${err.trim() || e.message}` };
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test logic/tunnel-ipc.test.js`
Expected: PASS — 10 tests.

- [ ] **Step 5: Append the mutation block**

```sh
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

mutate "tunnel:start proceeds with no configured hostname" logic/tunnel-ipc.js \
  "    if (!primary) return { success: false, error: 'No tunnel configured — complete setup first' };" \
  "    ;"
```

- [ ] **Step 6: Run the mutation harness**

Run: `sh test/discriminates.sh`
Expected: `caught 42 / 42`.

- [ ] **Step 7: Commit**

```bash
git add logic/tunnel-ipc.js logic/tunnel-ipc.test.js test/discriminates.sh
git commit -m "Add logic/tunnel-ipc.js — the nine tunnel handlers

One implementation for three apps with different ports, schemes and tunnel
names. The module owns no app state beyond the running child; everything else
arrives in the config object.

setup-tunnel writes one ingress entry per DECLARED service, which is what
coolify's HTTP+SSH pair needs — a single-entry writer would half-route its
tunnel. The hostname is validated before anything executes, because it reaches
both a command line and a generated config file, and it travels as its own
argv entry.

getWindow is a function rather than a captured reference: macOS recreates the
window on activate after all windows close, and a captured one would send to a
destroyed window."
```

---

### Task 9: `logic/mcp.js` — Claude Code MCP registration mechanics

**Files:**
- Create: `logic/mcp.js`, `logic/mcp.test.js`
- Modify: `test/discriminates.sh`
- Reference: n8n (`n8n-mcp` via `npx`), minecraft (`minecraft` via `node bedrock-mcp-server.mjs --port`), roblox-studio (`Roblox_Studio`)

**Interfaces:**
- Consumes: `utils/failsafe.js` → `quiet`, `attempt`.
- Produces:
  - `MCP_SCOPES` — `['user', 'local', 'project']`
  - `detectMcpInstalled(claudeConfig: object|string|null, serverName: string) -> boolean`
  - `removeAllScopes(serverName, { run }) -> void`
  - `registerMcpIpc(ipcMain, { serverName, addArgs, commandFile, commandBody, settings, claudeJsonPath, skillsDir, extraInstall, deps }) -> void`

Only the mechanics are shared. The server identity differs completely between the three apps, so `addArgs` is supplied by the app as an **argv array**.

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const M = require('./mcp');

test('a user-scope registration is detected', () => {
  assert.strictEqual(M.detectMcpInstalled({ mcpServers: { 'n8n-mcp': {} } }, 'n8n-mcp'), true);
});

test('a PROJECT-scope registration is detected too', () => {
  // Reporting "not installed" here made the Install button re-run and
  // duplicate the registration.
  assert.strictEqual(
    M.detectMcpInstalled({ projects: { '/p': { mcpServers: { minecraft: {} } } } }, 'minecraft'), true);
});

test('an unrelated server is not a match', () => {
  assert.strictEqual(M.detectMcpInstalled({ mcpServers: { other: {} } }, 'n8n-mcp'), false);
});

test('raw JSON text is accepted and a broken file reads as not-installed', () => {
  assert.strictEqual(M.detectMcpInstalled('{"mcpServers":{"x":{}}}', 'x'), true);
  for (const bad of ['{ truncated', '', null, undefined, 'null', 42, { projects: 'nope' }]) {
    assert.strictEqual(M.detectMcpInstalled(bad, 'x'), false, String(bad));
  }
});

test('removeAllScopes clears user, local and project', () => {
  const calls = [];
  M.removeAllScopes('n8n-mcp', { run: (bin, args) => calls.push(args.join(' ')) });
  assert.deepStrictEqual(M.MCP_SCOPES, ['user', 'local', 'project']);
  assert.strictEqual(calls.length, 3);
  for (const scope of M.MCP_SCOPES) {
    assert.ok(calls.some((c) => c.includes(`-s ${scope}`)), scope);
  }
});

test('a scope that fails to clear does not abort the others', () => {
  // The usual reason a remove fails is that nothing was registered there.
  let n = 0;
  M.removeAllScopes('x', { run: () => { n += 1; if (n === 1) throw new Error('not found'); } });
  assert.strictEqual(n, 3);
});

function harness(overrides = {}) {
  const handlers = {};
  const calls = [];
  const files = { ...(overrides.files || {}) };
  const settingsData = {};
  M.registerMcpIpc({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    serverName: 'minecraft',
    addArgs: ['mcp', 'add', 'minecraft', '-s', 'user', '--', 'node', '/app/server.mjs'],
    commandFile: '/home/u/.claude/commands/mentat-mcbes.md',
    commandBody: '---\nname: mentat-mcbes\n---\n',
    claudeJsonPath: '/home/u/.claude.json',
    settings: { load: () => ({ ...settingsData }), save: (p) => Object.assign(settingsData, p) },
    deps: {
      run: (bin, args) => { calls.push([bin, ...args]); return ''; },
      tryRun: (op, bin, args) => { calls.push([bin, ...args]); return ''; },
      fs: {
        existsSync: (p) => p in files,
        readFileSync: (p) => files[p],
        writeFileSync: (p, d) => { files[p] = d; },
        mkdirSync: () => {},
      },
    },
    ...overrides.config,
  });
  return { handlers, calls, files, settingsData };
}

test('the three mcp channels are attached', () => {
  assert.deepStrictEqual(Object.keys(harness().handlers).sort(),
    ['mcp:install', 'mcp:status', 'mcp:uninstall']);
});

test('install registers with the exact argv the app supplied', async () => {
  const h = harness();
  const r = await h.handlers['mcp:install']();
  assert.strictEqual(r.success, true);
  const add = h.calls.find((c) => c[0] === 'claude' && c.includes('add'));
  assert.deepStrictEqual(add, ['claude', 'mcp', 'add', 'minecraft', '-s', 'user', '--', 'node', '/app/server.mjs'],
    'the argv array is passed through untouched — never joined into a shell string');
});

test('install writes the slash-command doc and records the flag', async () => {
  const h = harness();
  await h.handlers['mcp:install']();
  assert.ok(h.files['/home/u/.claude/commands/mentat-mcbes.md'].includes('mentat-mcbes'));
  assert.strictEqual(h.settingsData.mcpInstalled, true);
});

test('status trusts the on-disk registration over the stored flag', async () => {
  const h = harness({ files: { '/home/u/.claude.json': '{"mcpServers":{"minecraft":{}}}' } });
  assert.strictEqual((await h.handlers['mcp:status']()).mcpInstalled, true);
});

test('extraInstall runs after a successful registration', async () => {
  let ran = false;
  const h = harness({ config: { extraInstall: () => { ran = true; } } });
  await h.handlers['mcp:install']();
  assert.strictEqual(ran, true, 'n8n clones its skills pack here; no other app has one');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test logic/mcp.test.js` → FAIL, `Cannot find module './mcp'`.

- [ ] **Step 3: Write the implementation**

```js
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
    quiet(`mcp.remove.${scope}`,
      () => run('claude', ['mcp', 'remove', serverName, '-s', scope], { timeout: 15000, stdio: 'pipe', cwd }),
      null);
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test logic/mcp.test.js` → PASS, 11 tests.

- [ ] **Step 5: Append the mutation block**

```sh
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
  "    quiet(\`mcp.remove.\${scope}\`," \
  "    (() => run('claude', ['mcp', 'remove', serverName, '-s', scope]))(); (() => null)("

mutate "install stops writing the slash-command doc" logic/mcp.js \
  "      writeCommand();" \
  "      ;"
```

- [ ] **Step 6: Run the mutation harness** → `caught 47 / 47`.

- [ ] **Step 7: Commit**

```bash
git add logic/mcp.js logic/mcp.test.js test/discriminates.sh
git commit -m "Add logic/mcp.js — MCP registration mechanics, not identity

Three apps register three unrelated servers (n8n-mcp via npx, minecraft via
node bedrock-mcp-server.mjs, Roblox_Studio), so only the mechanics are shared
and addArgs arrives from the app as an ARGV ARRAY. The shipped n8n build joined
its args into a string for execSync with the user's API key inside it, so a key
containing a shell metacharacter was executed rather than passed.

detectMcpInstalled checks the per-project map as well as user scope: a
project-scoped entry reading as \"not installed\" made the Install button re-run
and duplicate the registration. A malformed .claude.json reads as
not-installed rather than throwing into the status handler."
```

---

### Task 10: `logic/pty.js` — the embedded terminal

**Files:**
- Create: `logic/pty.js`, `logic/pty.test.js`
- Modify: `test/discriminates.sh`

**Interfaces:**
- Consumes: `utils/proc.js` → `killProcess`; `utils/failsafe.js` → `attempt`.
- Produces:
  - `resolveHelperPath(dirname, { isPackaged }) -> string`
  - `registerPtyIpc(ipcMain, { getWindow, command, args, cwd, env, helperPath, platform, deps }) -> void`

Attaches `pty:spawn` (handle), `pty:write`, `pty:resize`, `pty:kill` (on).

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('./pty');

test('the helper path is rewritten out of the asar when packaged', () => {
  // python3 cannot execute a script inside the archive, which is why the file
  // is asarUnpack'd — and why the path must be rewritten to match.
  const packaged = P.resolveHelperPath('/App.app/Contents/Resources/app.asar', { isPackaged: true });
  assert.ok(packaged.includes('app.asar.unpacked'));
  assert.ok(packaged.endsWith('pty-helper.py'));
});

test('an unpackaged path is left alone', () => {
  const dev = P.resolveHelperPath('/repo', { isPackaged: false });
  assert.strictEqual(dev, '/repo/pty-helper.py');
});

test('a dev path that merely contains app.asar is still rewritten', () => {
  const p = P.resolveHelperPath('/x/app.asar/logic', { isPackaged: false });
  assert.ok(p.includes('app.asar.unpacked'), 'the rewrite follows the path, not just the flag');
});

function harness(overrides = {}) {
  const handlers = {};
  const listeners = {};
  const spawned = [];
  const sent = [];
  const child = {
    stdin: { written: [], write(d) { this.written.push(d); } },
    stdout: { on(_, fn) { this.fn = fn; } },
    stderr: { on() {} },
    on(ev, fn) { this[`on_${ev}`] = fn; },
    kill() { this.killed = true; },
    killed: false,
    pid: 4242,
  };
  P.registerPtyIpc(
    { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { listeners[ch] = fn; } },
    {
      getWindow: () => ({ isDestroyed: () => false, webContents: { send: (ch, p) => sent.push([ch, p]) } }),
      command: 'claude',
      args: ['/mentat-mcbes'],
      cwd: '/home/u',
      env: { TERM: 'xterm-256color' },
      helperPath: '/repo/pty-helper.py',
      platform: 'darwin',
      deps: { spawn: (bin, a, o) => { spawned.push([bin, a, o]); return child; } },
      ...overrides,
    },
  );
  return { handlers, listeners, spawned, sent, child };
}

test('all four pty channels are attached', () => {
  const h = harness();
  assert.deepStrictEqual(Object.keys(h.handlers), ['pty:spawn']);
  assert.deepStrictEqual(Object.keys(h.listeners).sort(), ['pty:kill', 'pty:resize', 'pty:write']);
});

test('POSIX spawns the command through the python PTY helper', () => {
  // A real TTY without a native Node module.
  const h = harness();
  h.handlers['pty:spawn'](null, 80, 24, false);
  const [bin, args] = h.spawned[0];
  assert.strictEqual(bin, 'python3');
  assert.strictEqual(args[0], '/repo/pty-helper.py');
  assert.deepStrictEqual(args.slice(1), ['claude', '/mentat-mcbes']);
});

test('Windows spawns the command directly, with no helper', () => {
  const h = harness({ platform: 'win32' });
  h.handlers['pty:spawn'](null, 80, 24, false);
  assert.strictEqual(h.spawned[0][0], 'claude');
});

test('skipPerms prepends the flag ahead of the app slash command', () => {
  const h = harness();
  h.handlers['pty:spawn'](null, 80, 24, true);
  const args = h.spawned[0][1];
  assert.ok(args.includes('--dangerously-skip-permissions'));
  assert.ok(args.indexOf('--dangerously-skip-permissions') < args.indexOf('/mentat-mcbes'));
});

test('the terminal size reaches the child environment', () => {
  const h = harness();
  h.handlers['pty:spawn'](null, 120, 40, false);
  const env = h.spawned[0][2].env;
  assert.strictEqual(env.COLUMNS, '120');
  assert.strictEqual(env.LINES, '40');
  assert.strictEqual(env.TERM, 'xterm-256color');
});

test('a second spawn replaces the first rather than leaking it', () => {
  const h = harness();
  h.handlers['pty:spawn'](null, 80, 24, false);
  h.handlers['pty:spawn'](null, 80, 24, false);
  assert.strictEqual(h.child.killed, true);
});

test('pty:write only forwards strings', () => {
  const h = harness();
  h.handlers['pty:spawn'](null, 80, 24, false);
  h.listeners['pty:write'](null, 'ls\n');
  h.listeners['pty:write'](null, { evil: true });
  h.listeners['pty:write'](null, 42);
  assert.deepStrictEqual(h.child.stdin.written, ['ls\n']);
});

test('stdout is relayed to the renderer', () => {
  const h = harness();
  h.handlers['pty:spawn'](null, 80, 24, false);
  h.child.stdout.fn(Buffer.from('hello'));
  assert.deepStrictEqual(h.sent[0], ['pty:data', 'hello']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test logic/pty.test.js` → FAIL, `Cannot find module './pty'`.

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test logic/pty.test.js` → PASS, 11 tests.

- [ ] **Step 5: Append the mutation block**

```sh
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
```

- [ ] **Step 6: Run the mutation harness** → `caught 52 / 52`.

- [ ] **Step 7: Commit**

```bash
git add logic/pty.js logic/pty.test.js test/discriminates.sh
git commit -m "Add logic/pty.js — the embedded terminal for four apps

command and args stay per app (each launches claude with its own slash
command); the PTY plumbing does not. On POSIX the command runs through
pty-helper.py, which gives a real TTY without a native Node module.

Three behaviours are mutation-pinned: the asar path must be rewritten to
app.asar.unpacked because python3 cannot execute a script inside the archive;
a second spawn must replace the first rather than leak it; and pty:write
forwards strings only, since the renderer is writing into a process running
with the user's own privileges."
```

---

### Task 11: `ui/window.js` — one window factory, secure by default, no DevTools

**Files:**
- Create: `ui/window.js`, `ui/window.test.js`
- Modify: `test/discriminates.sh`

**Interfaces:**
- Consumes: nothing (`BrowserWindow` is injected).
- Produces: `createWindow(config) -> BrowserWindow`, `SECURE_DEFAULTS`, `buildWebPreferences(overrides, preload)`, `rewriteHeaders(responseHeaders, { stripFrameHeaders, sameSiteNone }) -> object`

```js
createWindow({
  BrowserWindow,                       // injected
  width, height, title, icon, backgroundColor,
  preload,
  load: { file: '...' } | { url: '...' },
  webPreferences = {},                 // merged OVER the secure defaults
  headerRewrite = null,                // { session, urls, stripFrameHeaders, sameSiteNone }
  onReady = null,
})
```

The five apps differ **only** in width, height, title and one `backgroundColor`, so a config object genuinely serves all five.

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const W = require('./window');

function FakeBrowserWindow(opts) {
  this.opts = opts;
  this.loaded = null;
  this.handlers = {};
  this.shown = false;
  this.webContents = {
    openDevToolsCalled: false,
    openDevTools() { this.openDevToolsCalled = true; },
    on() {},
    session: { webRequest: { onHeadersReceived: (filter, cb) => { this.session._filter = filter; this.session._cb = cb; } } },
  };
  this.webContents.session = { webRequest: { onHeadersReceived: (f, cb) => { this._filter = f; this._cb = cb; } } };
  this.loadFile = (f) => { this.loaded = { file: f }; };
  this.loadURL = (u) => { this.loaded = { url: u }; };
  this.once = (ev, fn) => { this.handlers[ev] = fn; };
  this.on = (ev, fn) => { this.handlers[ev] = fn; };
  this.show = () => { this.shown = true; };
  this.isDestroyed = () => false;
}

const base = { BrowserWindow: FakeBrowserWindow, width: 1200, height: 800, title: 'T', preload: '/p.js', load: { file: '/a.html' } };

test('the secure defaults are applied', () => {
  const win = W.createWindow({ ...base });
  const wp = win.opts.webPreferences;
  assert.strictEqual(wp.nodeIntegration, false);
  assert.strictEqual(wp.contextIsolation, true);
  assert.strictEqual(wp.webSecurity, true);
  assert.strictEqual(wp.allowRunningInsecureContent, false);
  assert.strictEqual(wp.preload, '/p.js');
});

test('DevTools are NEVER opened automatically', () => {
  // Five apps used to run `if (!app.isPackaged) openDevTools()`. There is no
  // option to restore it: Electron already binds Cmd+Opt+I, and a
  // self-opening inspector is noise in every screenshot.
  const win = W.createWindow({ ...base });
  win.handlers['ready-to-show']();
  assert.strictEqual(win.webContents.openDevToolsCalled, false);
});

test('there is no config key that turns DevTools back on', () => {
  const win = W.createWindow({ ...base, openDevTools: true, devTools: true });
  win.handlers['ready-to-show']();
  assert.strictEqual(win.webContents.openDevToolsCalled, false);
});

test('an app can override a default, and coolify must do so explicitly', () => {
  // coolify still needs webSecurity:false and cannot be GUI-verified here, so
  // it opts out in one visible place rather than being silently hardened.
  const win = W.createWindow({ ...base, webPreferences: { webSecurity: false } });
  assert.strictEqual(win.opts.webPreferences.webSecurity, false);
  assert.strictEqual(win.opts.webPreferences.contextIsolation, true, 'the other defaults still hold');
});

test('load takes a file or a url — dejavu points at a local server', () => {
  assert.deepStrictEqual(W.createWindow({ ...base }).loaded, { file: '/a.html' });
  assert.deepStrictEqual(
    W.createWindow({ ...base, load: { url: 'http://127.0.0.1:8772/' } }).loaded,
    { url: 'http://127.0.0.1:8772/' });
});

test('createWindow rejects a load with neither', () => {
  assert.throws(() => W.createWindow({ ...base, load: {} }), /load/);
});

test('size, title and backgroundColor pass through', () => {
  const win = W.createWindow({ ...base, width: 1240, height: 860, title: 'X', backgroundColor: '#101018' });
  assert.strictEqual(win.opts.width, 1240);
  assert.strictEqual(win.opts.title, 'X');
  assert.strictEqual(win.opts.backgroundColor, '#101018');
  assert.strictEqual(win.opts.show, false, 'the window is shown on ready-to-show, not before');
});

test('rewriteHeaders strips only the framing headers it is asked to', () => {
  const out = W.rewriteHeaders(
    { 'X-Frame-Options': ['DENY'], 'Content-Security-Policy': ["frame-ancestors 'none'"], 'X-Other': ['keep'] },
    { stripFrameHeaders: true });
  assert.ok(!('X-Frame-Options' in out));
  assert.ok(!('Content-Security-Policy' in out));
  assert.deepStrictEqual(out['X-Other'], ['keep']);
});

test('rewriteHeaders sets SameSite=None only when asked', () => {
  const cookie = { 'Set-Cookie': ['a=1; HttpOnly'] };
  assert.deepStrictEqual(W.rewriteHeaders(cookie, {})['Set-Cookie'], ['a=1; HttpOnly']);
  const out = W.rewriteHeaders(cookie, { sameSiteNone: true });
  assert.match(out['Set-Cookie'][0], /SameSite=None/);
});

test('an existing SameSite is replaced, not appended twice', () => {
  const out = W.rewriteHeaders({ 'Set-Cookie': ['a=1; SameSite=Lax'] }, { sameSiteNone: true });
  assert.strictEqual(out['Set-Cookie'][0].match(/SameSite/g).length, 1);
});

test('header rewriting is scoped to the urls it is given, never <all_urls>', () => {
  // coolify strips CSP for EVERY url it can load. The filter is required here.
  const win = W.createWindow({
    ...base,
    headerRewrite: { urls: ['http://localhost:8000/*'], stripFrameHeaders: true },
  });
  assert.deepStrictEqual(win._filter, { urls: ['http://localhost:8000/*'] });
  assert.throws(() => W.createWindow({ ...base, headerRewrite: { stripFrameHeaders: true } }),
    /urls/, 'a rewrite with no url filter is refused');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test ui/window.test.js` → FAIL, `Cannot find module './window'`.

- [ ] **Step 3: Write the implementation**

```js
'use strict';
//
// One window factory for five apps. They differ only in size, title and one
// background colour, so a config object genuinely serves all of them rather
// than replacing five readable functions with a bigger one plus five configs.
//
// TWO RULES THIS FILE ENFORCES
// ----------------------------
// 1. Secure defaults. An app may override one explicitly — coolify still needs
//    `webSecurity: false` and cannot be GUI-verified, so it opts out in one
//    visible place instead of being silently hardened.
// 2. DevTools never open by themselves, and no config key turns that back on.
//    Electron already binds Cmd+Opt+I, so a flag would be machinery for what
//    the platform provides — and a self-opening inspector is noise in every
//    screenshot and every driven GUI session.

const SECURE_DEFAULTS = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,           // all five rely on a preload that needs it
  webSecurity: true,
  allowRunningInsecureContent: false,
});

function buildWebPreferences(overrides = {}, preload) {
  return { ...SECURE_DEFAULTS, ...overrides, preload };
}

/**
 * Rewrite response headers for an embedded origin.
 * Apps that put a localhost service in an iframe must drop its framing
 * headers and loosen its cookies — but only for that origin.
 */
function rewriteHeaders(responseHeaders, { stripFrameHeaders = false, sameSiteNone = false } = {}) {
  const headers = { ...responseHeaders };
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (stripFrameHeaders && (lower === 'x-frame-options' || lower === 'content-security-policy')) {
      delete headers[key];
    }
    if (sameSiteNone && lower === 'set-cookie') {
      headers[key] = headers[key].map((cookie) => (
        /samesite/i.test(cookie)
          ? cookie.replace(/samesite=\w+/i, 'SameSite=None')
          : `${cookie}; SameSite=None; Secure`
      ));
    }
  }
  return headers;
}

function createWindow(config) {
  const {
    BrowserWindow, width, height, title, icon, backgroundColor,
    preload, load, webPreferences = {}, headerRewrite = null, onReady = null,
  } = config;

  if (!load || (!load.file && !load.url)) {
    throw new Error('createWindow: load must be { file } or { url }');
  }

  const options = {
    width,
    height,
    title,
    show: false,   // shown on ready-to-show, so no white flash
    webPreferences: buildWebPreferences(webPreferences, preload),
  };
  if (icon) options.icon = icon;
  if (backgroundColor) options.backgroundColor = backgroundColor;

  const win = new BrowserWindow(options);

  if (headerRewrite) {
    if (!Array.isArray(headerRewrite.urls) || headerRewrite.urls.length === 0) {
      throw new Error('createWindow: headerRewrite.urls is required — never rewrite <all_urls>');
    }
    win.webContents.session.webRequest.onHeadersReceived(
      { urls: headerRewrite.urls },
      (details, callback) => callback({ responseHeaders: rewriteHeaders(details.responseHeaders, headerRewrite) }),
    );
  }

  if (load.file) win.loadFile(load.file);
  else win.loadURL(load.url);

  win.once('ready-to-show', () => {
    win.show();
    // No openDevTools call, and no branch that could add one.
    if (onReady) onReady(win);
  });

  return win;
}

module.exports = { SECURE_DEFAULTS, buildWebPreferences, rewriteHeaders, createWindow };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test ui/window.test.js` → PASS, 11 tests.

- [ ] **Step 5: Append the mutation block**

```sh
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
```

- [ ] **Step 6: Run the mutation harness** → `caught 58 / 58`.

- [ ] **Step 7: Commit**

```bash
git add ui/window.js ui/window.test.js test/discriminates.sh
git commit -m "Add ui/window.js — one factory, secure by default, no DevTools

The five apps differ only in size, title and one background colour, so a
config object serves all of them.

Two rules the factory enforces. Secure defaults, which an app may override
explicitly — coolify still needs webSecurity:false and cannot be GUI-verified
here, so it opts out in one visible place rather than being silently hardened.
And DevTools never open by themselves, with no config key to restore it:
Electron already binds Cmd+Opt+I, so a flag would be machinery for what the
platform provides.

headerRewrite REQUIRES a url filter. coolify currently strips X-Frame-Options
and CSP for every url it can load; scoping is not optional here."
```

---

### Task 12: `ui/base.css` — the shared stylesheet

**Files:**
- Create: `ui/base.css`
- Reference: the five `app.css` files (76–94% similar, all from one origin)

- [ ] **Step 1: Extract the rules common to at least two apps**

```bash
cd /Users/rchuvilev/Projects
python3 - <<'PY'
import re, collections, os
APPS = ['n8n','minecraft','roblox-studio','coolify-local','local-studio']
blocks = collections.defaultdict(set)
order = []
for a in APPS:
    src = open(f'ai-mentat-{a}/app.css').read()
    for m in re.finditer(r'([^{}]+)\{([^}]*)\}', src):
        sel = ' '.join(m.group(1).split())
        if sel not in blocks: order.append(sel)
        blocks[sel].add(a)
shared = [s for s in order if len(blocks[s]) >= 2]
print(f"{len(shared)} selectors appear in 2+ apps, of {len(order)} total")
for s in shared[:40]: print(' ', s, sorted(blocks[s]))
PY
```

Expected: the family shell — `*`, `body`, `.tab-bar`, `.tab-bar button`,
`.tab-content`, `.panel`, `.panel-scroll`, `.card`, `.card h3`, `.status-dot`
and its colour modifiers, `.row`, `input[type="text"]`, `button.btn` and its
modifiers, `.msg`, `.url-display`, `.icon-btn`, `.section-title`, `.faq-item`,
`.faq-body`, `.terminal-overlay`, `.terminal-popup`, `.terminal-header`,
`.terminal-body`, `.top-bar` and its children.

- [ ] **Step 2: Write `ui/base.css` from n8n's copy, which is the origin**

n8n's `app.css` is the 362-line original the others diverged from; coolify is
94% identical to it. Take it as the base and delete the app-specific rules.

```bash
cd /Users/rchuvilev/Projects/ai-mentat-sdk
mkdir -p ui
cp /Users/rchuvilev/Projects/ai-mentat-n8n/app.css ui/base.css
```

Then prepend this header and remove any rule the extraction above did **not**
list as shared (n8n-only rules such as `.loading-overlay`, `.install-log`,
`.progress-bar-*` belong in n8n's own `app.css`):

```css
/* ai-mentat base stylesheet.
 *
 * The shell every app shares: tab bar, panels, cards, rows, status dots,
 * buttons, messages, FAQ items and the terminal overlay. Extracted from the
 * five app.css files, which were 76-94% identical because they all descend
 * from one original.
 *
 * An app loads this FIRST and keeps its own app.css for what is genuinely its
 * own — minecraft's console pane and macro builder, local-studio's media grid,
 * roblox's compact layout. Do not add a rule here that only one app uses.
 */
```

- [ ] **Step 3: Verify the file is valid CSS and has no app-specific rules left**

```bash
node -e "
const css = require('fs').readFileSync('ui/base.css','utf8');
const open = (css.match(/{/g)||[]).length, close = (css.match(/}/g)||[]).length;
if (open !== close) { console.error('unbalanced braces', open, close); process.exit(1); }
const appOnly = ['.builder__','.console-log','.player-list','.loading-overlay','.install-log','.progress-bar'];
const found = appOnly.filter(s => css.includes(s));
if (found.length) { console.error('app-specific rules left behind:', found); process.exit(1); }
console.log('base.css OK —', css.split('\n').length, 'lines,', open, 'rules');
"
```

Expected: `base.css OK — <n> lines, <n> rules`.

- [ ] **Step 4: Commit**

```bash
git add ui/base.css
git commit -m "Add ui/base.css — the shell five apps share

Extracted from the five app.css files, which were 76-94% identical because
they all descend from one original. n8n's is that original, so it is the base;
its app-specific rules (loading overlay, install log, progress bar) are left
behind for n8n's own app.css.

The SDK README previously recorded a deliberate decision NOT to ship a shared
stylesheet, on the grounds that only one app defined CSS custom properties and
a common sheet would have had a single user. That is no longer true — five
apps now share the same shell — and the maintainer chose the 2+ threshold
knowingly. The cost is real: an edit here changes the look of five shipping
apps at once."
```

---

### Task 13: `build/` and `vendor/` — the identical assets

**Files:**
- Create: `build/entitlements.mac.plist`, `build/entitlements.mas.plist`, `build/entitlements.mas.inherit.plist`
- Create: `vendor/xterm.js`, `vendor/xterm.css`, `vendor/addon-fit.js`
- Modify: `package.json` (`files` array)

- [ ] **Step 1: Copy the identical files, verifying identity first**

```bash
cd /Users/rchuvilev/Projects/ai-mentat-sdk
mkdir -p build vendor

# Prove they really are identical before collapsing five copies into one.
for f in entitlements.mac.plist entitlements.mas.plist entitlements.mas.inherit.plist \
         vendor/xterm.js vendor/xterm.css vendor/addon-fit.js; do
  printf "%-34s " "$f"
  shasum -a 1 /Users/rchuvilev/Projects/ai-mentat-{n8n,minecraft,roblox-studio,coolify-local,local-studio}/"$f" \
    | awk '{print $1}' | sort -u | wc -l | xargs -I{} sh -c '[ {} -eq 1 ] && echo "identical x5" || echo "DIFFER — stop"'
done
```

Expected: `identical x5` on all six lines. A `DIFFER` means one app has drifted
and the difference must be understood before collapsing.

```bash
cp /Users/rchuvilev/Projects/ai-mentat-n8n/entitlements.mac.plist build/
cp /Users/rchuvilev/Projects/ai-mentat-n8n/entitlements.mas.plist build/
cp /Users/rchuvilev/Projects/ai-mentat-n8n/entitlements.mas.inherit.plist build/
cp /Users/rchuvilev/Projects/ai-mentat-n8n/vendor/xterm.js vendor/
cp /Users/rchuvilev/Projects/ai-mentat-n8n/vendor/xterm.css vendor/
cp /Users/rchuvilev/Projects/ai-mentat-n8n/vendor/addon-fit.js vendor/
```

- [ ] **Step 2: Add the new directories to the published file list**

`package.json` currently has `"files": ["logic", "ui", "utils", "index.js"]`.
Without `build` and `vendor` an npm consumer would not receive them, and
`test` carries the shared mutation harness.

```json
"files": ["logic", "ui", "utils", "build", "vendor", "test", "index.js"]
```

- [ ] **Step 3: Verify the assets are readable and the plists parse**

```bash
for p in build/*.plist; do plutil -lint "$p"; done
node -e "
const fs=require('fs');
for (const f of ['vendor/xterm.js','vendor/xterm.css','vendor/addon-fit.js']) {
  const n = fs.statSync(f).size;
  if (n < 1000) { console.error(f, 'looks truncated:', n); process.exit(1); }
  console.log(f, n, 'bytes');
}"
```

Expected: three `OK` lines from `plutil`, then the three vendor sizes
(xterm.js ~488 KB).

- [ ] **Step 4: Commit**

```bash
git add build vendor package.json
git commit -m "Add build/ entitlements and vendor/ terminal assets

Six files that were byte-identical in five apps, sha1-verified before
collapsing: three signing entitlement plists and the xterm bundle. The xterm
copies alone were ~1.9 MB of duplication across the repos.

package.json files gains build, vendor and test so an npm consumer receives
them; test carries the shared mutation harness."
```

---

### Task 14: `utils/bundle-electron.js` — accept a `.cjs` entry

**Files:**
- Modify: `utils/bundle-electron.js`, `utils/bundle-electron.test.js`

**Interfaces:**
- Changed: `ENTRY_NAME` (string) becomes `ENTRY_NAMES` (string[]). New:
  `findEntry(dir, exists) -> string|null`, `outputFor(entryPath) -> string`.

dejavu is `"type": "module"`, so its CommonJS wrapper must be
`electron-main.cjs` — and the **output** must be `.cjs` too, since esbuild
emits CommonJS and a `.js` bundle in an ESM package is parsed as ESM.

- [ ] **Step 1: Write the failing tests**

```js
test('an electron-main.cjs entry is found when there is no .js', () => {
  const dir = B.resolveProjectDir({
    startDir: '/repo/sdk/utils', cwd: '/x',
    exists: (p) => p === '/repo/electron-main.cjs',
  });
  assert.strictEqual(dir, '/repo');
});

test('a .js entry still wins when both exist', () => {
  // Only dejavu is ESM; every other app keeps electron-main.js.
  assert.strictEqual(B.findEntry('/repo', () => true), '/repo/electron-main.js');
});

test('the bundle extension follows the entry extension', () => {
  // A .js bundle in a "type": "module" package is parsed as ESM, and esbuild
  // emits CommonJS — the app would fail to boot.
  assert.strictEqual(B.outputFor('/repo/electron-main.js'), '/repo/electron-main.bundle.js');
  assert.strictEqual(B.outputFor('/repo/electron-main.cjs'), '/repo/electron-main.bundle.cjs');
});

test('ENTRY_NAMES lists both, in resolution order', () => {
  assert.deepStrictEqual(B.ENTRY_NAMES, ['electron-main.js', 'electron-main.cjs']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test utils/bundle-electron.test.js`
Expected: FAIL — `B.findEntry is not a function`.

- [ ] **Step 3: Change the implementation**

Replace the `ENTRY_NAME` constant and its uses:

```js
/** Entry filenames, in resolution order. `.cjs` is for ESM packages (dejavu). */
const ENTRY_NAMES = ['electron-main.js', 'electron-main.cjs'];

/** The entry this project uses, or null. */
function findEntry(dir, exists) {
  for (const name of ENTRY_NAMES) {
    const p = path.join(dir, name);
    if (exists(p)) return p;
  }
  return null;
}

/**
 * Bundle path for an entry. The extension is carried over: a `.js` bundle in a
 * `"type": "module"` package would be parsed as ESM while esbuild emits CJS.
 */
function outputFor(entryPath) {
  const ext = path.extname(entryPath);            // '.js' | '.cjs'
  return entryPath.replace(new RegExp(`${ext.replace('.', '\\.')}$`), `.bundle${ext}`);
}
```

In `resolveProjectDir`, replace `exists(path.join(dir, ENTRY_NAME))` with
`findEntry(dir, exists) !== null` in both the walk and the cwd fallback, and
update the error message to say `no electron-main.js or electron-main.cjs
found`. In `main()`, replace the entry/out computation with:

```js
  const entry = findEntry(projectDir, (p) => fs.existsSync(p));
  const out = outputFor(entry);
```

Export `ENTRY_NAMES`, `findEntry` and `outputFor`; keep `ENTRY_NAME` exported
as `ENTRY_NAMES[0]` so nothing that already imports it breaks.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS — the four new tests plus the existing ones. The existing
`bundle-electron` tests reference `B.ENTRY_NAME`, which is why it stays.

- [ ] **Step 5: Verify against a real repo, both layouts**

```bash
cd /Users/rchuvilev/Projects/ai-mentat-n8n && npm run bundle && ls -la electron-main.bundle.js
cd /tmp && rm -rf cjscheck && mkdir cjscheck && cd cjscheck
printf '{"type":"module","name":"x"}' > package.json
echo "console.log('hi')" > electron-main.cjs
node /Users/rchuvilev/Projects/ai-mentat-sdk/utils/bundle-electron.js . && ls electron-main.bundle.cjs
```

Expected: n8n bundles as before; the ESM fixture produces
`electron-main.bundle.cjs`, not `.js`.

- [ ] **Step 6: Append the mutation block**

```sh
# ── utils/bundle-electron.js ──────────────────────────────────────────────

mutate "the .cjs entry is no longer recognised (dejavu cannot bundle)" utils/bundle-electron.js \
  "const ENTRY_NAMES = ['electron-main.js', 'electron-main.cjs'];" \
  "const ENTRY_NAMES = ['electron-main.js'];"

mutate "the bundle extension no longer follows the entry" utils/bundle-electron.js \
  "  return entryPath.replace(new RegExp(\`\${ext.replace('.', '\\\\.')}\$\`), \`.bundle\${ext}\`);" \
  "  return entryPath.replace(/\.[cm]?js\$/, '.bundle.js');"
```

- [ ] **Step 7: Run the mutation harness** → `caught 60 / 60`.

- [ ] **Step 8: Commit**

```bash
git add utils/bundle-electron.js utils/bundle-electron.test.js test/discriminates.sh
git commit -m "bundle-electron: accept a .cjs entry and emit a .cjs bundle

dejavu is \"type\": \"module\", so its CommonJS wrapper has to be
electron-main.cjs — and the OUTPUT has to be .cjs too, because esbuild emits
CommonJS and a .js bundle in an ESM package is parsed as ESM, so the app would
fail to boot.

ENTRY_NAME becomes ENTRY_NAMES, .js still wins when both exist (only dejavu is
ESM), and the extension is carried from entry to bundle. ENTRY_NAME stays
exported as ENTRY_NAMES[0] so the existing tests and any consumer keep working.

Verified both ways: n8n still bundles to .js, and an ESM fixture bundles
to .cjs."
```

---

### Task 15: Document the new surface and verify the whole SDK

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add each module to the README structure block**

Extend the existing `## Structure` listing so every new file has a one-line
description, matching the style already there:

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

- [ ] **Step 2: Replace the stale "no shared design system" paragraph**

The README currently says a shared stylesheet would be an abstraction with a
single user. Replace that paragraph with:

```markdown
`ui/base.css` ships the shell all five Electron apps share — tab bar, panels,
cards, rows, status dots, buttons, FAQ items, terminal overlay. This reverses
an earlier decision recorded here: when only one app defined CSS custom
properties, a shared sheet would have had a single user. Five apps now share
76–94% of one stylesheet, so it earns its place. An app loads `base.css` first
and keeps its own `app.css` for what is genuinely its own; do not add a rule
here that only one app uses.
```

- [ ] **Step 3: Run the full verification**

```bash
cd /Users/rchuvilev/Projects/ai-mentat-sdk
npm test
npm run test:mutation
node -e "
// No module may require('electron') — that is what keeps them testable.
const fs=require('fs'), path=require('path');
let bad=[];
for (const d of ['logic','ui','utils']) {
  for (const f of fs.readdirSync(d).filter(n=>n.endsWith('.js'))) {
    if (fs.readFileSync(path.join(d,f),'utf8').match(/require\(['\"]electron['\"]\)/)) bad.push(d+'/'+f);
  }
}
if (bad.length) { console.error('modules importing electron directly:', bad); process.exit(1); }
console.log('no direct electron imports');
"
```

Expected: full suite green, `caught 60 / 60`, `no direct electron imports`.

- [ ] **Step 4: Commit and push**

```bash
git add README.md
git commit -m "Document the extracted modules

Every new module gets a line in the structure block, and the stale
'deliberately no shared design system' paragraph is replaced: that call was
right when one app defined CSS custom properties and is wrong now that five
share 76-94% of one stylesheet. The reversal is recorded rather than silently
overwritten."
git -c credential.helper='!gh auth git-credential' push https://github.com/hexstack-apps/ai-mentat-sdk.git main
```

---

## Mutation totals per task

Each task's harness run asserts a cumulative count; they must line up or a
block was skipped. 3 (failsafe) → 7 (env) → 11 (proc) → 15 (settings) →
19 (shell) → 28 (lima) → 38 (tunnel) → 42 (tunnel-ipc) → 47 (mcp) →
52 (pty) → 58 (window) → 60 (bundler). A `SKIP (pattern absent)` line means
the source no longer matches the mutation and the mutation must be updated,
not deleted.

## Done when

- `npm test` green, `npm run test:mutation` reports `caught 60 / 60`.
- No module in `logic/`, `ui/` or `utils/` requires `electron` directly.
- `ai-mentat-n8n` still bundles with `npm run bundle`; an ESM fixture bundles to `.cjs`.
- Every module in the spec's target structure exists with a sibling test.
- Nothing in any consuming app has changed yet — that is Plan 2.
