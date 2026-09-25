/**
 * Implementations behind the four required npm scripts
 * (`setup`, `run`, `build`, `check`) shared by every ai-mentat app.
 *
 * Each repo keeps a 3-line wrapper in `scripts/` that calls in here, so the
 * behaviour is defined once instead of copy-pasted four times.
 */
'use strict';

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { appHome, dataDir } = require('../utils/data-dir');

const sh = (cmd, opts = {}) =>
  execSync(cmd, { stdio: 'inherit', ...opts });

const quiet = (cmd) => {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return null; }
};

/** Executable extension electron-builder produces for the current platform. */
function currentExt() {
  if (process.platform === 'darwin') return 'dmg';
  if (process.platform === 'win32') return 'exe';
  return 'AppImage';
}

/** electron-builder target that yields a single self-contained file. */
function currentTarget() {
  if (process.platform === 'darwin') return 'dmg';
  if (process.platform === 'win32') return 'nsis';
  return 'AppImage';
}

/**
 * `setup` — install every npm and non-npm dependency needed to RUN the app.
 * Non-npm work is declared per repo so this stays one code path.
 *
 * @param {object} o
 * @param {string} o.appName
 * @param {string} o.root         repo root
 * @param {string[]} [o.system]   system binaries the app needs at runtime
 * @param {function} [o.extra]    repo-specific extra setup (downloads etc.)
 */
function setup({ appName, root, system = [], extra }) {
  console.log(`==> setup: ${appName}`);

  // 1. git submodules (the SDK itself)
  if (fs.existsSync(path.join(root, '.gitmodules'))) {
    console.log('--> git submodules');
    try { sh('git submodule update --init --recursive', { cwd: root }); }
    catch { console.warn('    (submodule init skipped)'); }
  }

  // 2. npm dependencies
  console.log('--> npm dependencies');
  const lock = fs.existsSync(path.join(root, 'package-lock.json'));
  sh(lock ? 'npm ci' : 'npm install', { cwd: root });

  // 3. non-npm: report what is missing rather than silently continuing
  const missing = [];
  for (const bin of ['python3', ...system]) {
    if (!quiet(process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`)) missing.push(bin);
  }
  if (missing.length) {
    console.warn(`--> missing system dependencies: ${missing.join(', ')}`);
    console.warn('    install them with your package manager, then re-run `npm run setup`.');
  } else {
    console.log('--> system dependencies present');
  }

  // 4. the data directory this app will write to
  const home = appHome(appName);
  const data = dataDir(appName);
  try {
    fs.mkdirSync(data, { recursive: true });
    console.log(`--> data dir ready: ${data}`);
  } catch (e) {
    console.warn(`--> cannot create ${data} (${e.code}).`);
    const sudo = process.platform === 'win32'
      ? `mkdir "${home}"  (as Administrator)`
      : `sudo mkdir -p "${home}" && sudo chown -R "$(whoami)" "${path.dirname(home)}"`;
    console.warn(`    the filesystem root is not user-writable. Run:\n      ${sudo}`);
    console.warn(`    until then the app falls back to ${path.join(os.homedir(), '.hexstack-app', appName, 'data')}`);
  }

  if (typeof extra === 'function') extra();
  console.log('==> setup complete');
}

/**
 * `build` — build the app for the CURRENT system into
 * `<root>/.hexstack-app/<app-name>/<app-name>.<ext>`.
 */
function build({ appName, root, bundle = true }) {
  const outDir = appHome(appName);
  const ext = currentExt();
  const finalPath = path.join(outDir, `${appName}.${ext}`);
  console.log(`==> build: ${appName} -> ${finalPath}`);

  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {
    console.error(`\nCannot write to ${outDir} (${e.code}).`);
    console.error('Run `npm run setup` first, or create the directory with sudo.');
    process.exit(1);
  }

  if (bundle && fs.existsSync(path.join(root, 'sdk/utils/bundle-electron.js'))) {
    try {
      sh('node sdk/utils/bundle-electron.js', { cwd: root });
    } catch {
      console.error('\nBundling failed (esbuild missing or bundle error).');
      console.error('Run `npm run setup` first — it installs the build toolchain.');
      process.exit(1);
    }
  }

  // electron-builder writes into outDir; artifactName pins the file name.
  const target = currentTarget();
  const platFlag = process.platform === 'darwin' ? 'mac'
                 : process.platform === 'win32'  ? 'win' : 'linux';
  try {
    sh(`npx --no-install electron-builder --${platFlag} ${target} ` +
       `-c.directories.output=${JSON.stringify(outDir)} ` +
       `-c.artifactName=${JSON.stringify(appName + '.' + ext)} ` +
       (process.platform === 'darwin' ? '-c.mac.identity=null ' : ''),
       { cwd: root });
  } catch (e) {
    // Report the actionable cause instead of a Node spawn stack trace.
    console.error(`\nelectron-builder failed for ${appName}.`);
    console.error('Run `npm run setup` first — it installs electron-builder and');
    console.error('the rest of the toolchain this build needs.');
    process.exit(1);
  }

  if (!fs.existsSync(finalPath)) {
    // electron-builder may vary the name; find the newest matching artifact.
    const found = fs.readdirSync(outDir)
      .filter(f => f.toLowerCase().endsWith('.' + ext))
      .map(f => ({ f, m: fs.statSync(path.join(outDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)[0];
    if (found && found.f !== `${appName}.${ext}`) {
      fs.renameSync(path.join(outDir, found.f), finalPath);
      console.log(`--> renamed ${found.f} -> ${appName}.${ext}`);
    }
  }

  if (!fs.existsSync(finalPath)) {
    console.error(`\nBuild finished but ${finalPath} is missing.`);
    process.exit(1);
  }
  const mb = (fs.statSync(finalPath).size / 1048576).toFixed(1);
  console.log(`==> built ${finalPath} (${mb} MB)`);
  return finalPath;
}

/** `check` — start the artifact that `build` produced. */
function startBuilt({ appName }) {
  const ext = currentExt();
  const artifact = path.join(appHome(appName), `${appName}.${ext}`);
  if (!fs.existsSync(artifact)) {
    console.error(`No build found at ${artifact}. Run \`npm run build\` first.`);
    process.exit(1);
  }
  console.log(`==> starting ${artifact}`);
  let cmd, args;
  if (process.platform === 'darwin')      { cmd = 'open';  args = [artifact]; }
  else if (process.platform === 'win32')  { cmd = 'cmd';   args = ['/c', 'start', '', artifact]; }
  else                                    { fs.chmodSync(artifact, 0o755); cmd = artifact; args = []; }
  const child = spawn(cmd, args, { stdio: 'inherit', detached: process.platform !== 'linux' });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (e) => { console.error(`failed to start: ${e.message}`); process.exit(1); });
}

module.exports = { setup, build, startBuilt, currentExt, currentTarget };
