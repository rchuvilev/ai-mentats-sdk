#!/usr/bin/env node
/**
 * Shared publish script for Electron apps.
 *
 * Steps:
 *   1. Increment minor version in package.json
 *   2. Bundle with esbuild (copies vendor files)
 *   3. Build signed platform installers via electron-builder
 *   4. Copy update artifacts (yml + installers) to app-updates-repo/<app>/
 *   5. Commit & push the updates repo
 *   6. Upload to itch.io via butler
 *
 * Usage:
 *   node shared/electron-publish.js --app=mentat-rbxs
 *   node shared/electron-publish.js --app=mentat-rbxs --platform=mac
 *   node shared/electron-publish.js --app=mentat-rbxs --skip-itch --skip-updates
 *
 * Options:
 *   --app=<name>       Required. App key from config.updates.json
 *   --platform=<p>     mac, win, linux, or all (default: current platform)
 *   --skip-itch        Skip itch.io butler upload
 *   --skip-updates     Skip copying to updates repo and pushing
 *   --skip-build       Skip build step (use existing dist/)
 *   --skip-bundle      Skip esbuild bundle step
 *   --patch            Increment patch instead of minor
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Parse arguments ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag) => {
  const a = args.find(a => a.startsWith(`--${flag}=`));
  return a ? a.split('=')[1] : undefined;
};
const hasFlag = (flag) => args.includes(`--${flag}`);

const appName = getArg('app');
if (!appName) { console.error('Usage: electron-publish.js --app=<name>'); process.exit(1); }

const platform = getArg('platform') || (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux');
const skipItch = hasFlag('skip-itch');
const skipUpdates = hasFlag('skip-updates');
const skipBuild = hasFlag('skip-build');
const skipBundle = hasFlag('skip-bundle');
const patchMode = hasFlag('patch');

// ─── Load config ──────────────────────────────────────────────────────────

const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(repoRoot, 'config.updates.json');

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error('Failed to read config.updates.json:', e.message);
  process.exit(1);
}

const appConfig = config.apps[appName];
if (!appConfig) {
  console.error(`App "${appName}" not found in config.updates.json. Available: ${Object.keys(config.apps).join(', ')}`);
  process.exit(1);
}

const appDir = path.join(repoRoot, appConfig.dir);
const pkgPath = path.join(appDir, 'package.json');

// ─── Step 1: Version bump ─────────────────────────────────────────────────

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
if (patchMode) {
  pkg.version = `${major}.${minor}.${patch + 1}`;
} else {
  pkg.version = `${major}.${minor + 1}.0`;
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`\n=> Version bumped: ${major}.${minor}.${patch} -> ${pkg.version}`);

const version = pkg.version;
const productName = pkg.build?.productName || pkg.name;

// Warn if auto-update feed URL is not configured
if (!skipUpdates && !pkg.build?.publish?.url) {
  console.warn('\n⚠  build.publish.url is empty — auto-update will not work for this build');
}

// ─── Step 2: Bundle ───────────────────────────────────────────────────────

if (!skipBundle) {
  console.log('\n=> Bundling...');
  execSync(`node shared/bundle-electron.js ${appConfig.dir}`, { cwd: repoRoot, stdio: 'inherit' });
}

// ─── Step 3: Build ────────────────────────────────────────────────────────

if (!skipBuild) {
  const platforms = platform === 'all' ? ['mac', 'win', 'linux'] : [platform];

  for (const p of platforms) {
    console.log(`\n=> Building for ${p}...`);
    const buildScript = `build:${p}:signed`;
    const fallbackScript = `build:${p}`;

    // Prefer signed build, fall back to unsigned
    const scriptToRun = pkg.scripts?.[buildScript] ? buildScript : fallbackScript;
    if (!pkg.scripts?.[scriptToRun]) {
      console.warn(`No build script "${scriptToRun}" in ${appName}/package.json, skipping ${p}`);
      continue;
    }

    execSync(`npm run ${scriptToRun}`, { cwd: appDir, stdio: 'inherit' });
  }
}

// ─── Step 4: Copy to updates repo ─────────────────────────────────────────

const distDir = path.join(appDir, 'dist');

if (!skipUpdates) {
  const updatesDir = path.join(repoRoot, 'app-updates-repo', appConfig.updatesRepo.subdir);
  if (!fs.existsSync(updatesDir)) {
    fs.mkdirSync(updatesDir, { recursive: true });
  }

  console.log(`\n=> Copying update artifacts to ${updatesDir}`);

  // Copy yml files (latest.yml, latest-mac.yml, latest-linux.yml) and installers
  const distFiles = fs.existsSync(distDir) ? fs.readdirSync(distDir) : [];
  let copied = 0;
  for (const file of distFiles) {
    const full = path.join(distDir, file);
    if (fs.statSync(full).isDirectory()) continue;
    // Copy yml files (update metadata) and installers
    if (/\.(yml|yaml|dmg|exe|msi|AppImage|deb|zip)$/.test(file)) {
      fs.copyFileSync(full, path.join(updatesDir, file));
      console.log(`  ${file}`);
      copied++;
    }
  }

  if (copied === 0) {
    console.warn('  No update artifacts found in dist/');
  }

  // Commit & push updates repo
  const updatesRepoDir = path.join(repoRoot, 'app-updates-repo');
  try {
    execSync('git add .', { cwd: updatesRepoDir, stdio: 'pipe' });
    const hasChanges = execSync('git status --porcelain', { cwd: updatesRepoDir, encoding: 'utf8' }).trim();
    if (hasChanges) {
      execSync(`git commit -m "${appName} v${version}"`, { cwd: updatesRepoDir, stdio: 'inherit' });
      execSync('git push', { cwd: updatesRepoDir, stdio: 'inherit' });
      console.log(`\n=> Updates repo pushed: ${appName} v${version}`);
    } else {
      console.log('\n=> Updates repo: no changes to commit');
    }
  } catch (e) {
    console.warn('Updates repo push failed (may not be a git repo yet):', e.message);
  }
}

// ─── Step 5: itch.io butler ───────────────────────────────────────────────

if (!skipItch && appConfig.itchIo) {
  const { user, game, channels } = appConfig.itchIo;
  const channelMap = channels || { mac: 'osx', win: 'windows', linux: 'linux' };
  const platforms = platform === 'all' ? ['mac', 'win', 'linux'] : [platform];

  for (const p of platforms) {
    const channel = channelMap[p];
    if (!channel) continue;
    const target = `${user}/${game}:${channel}`;

    if (!fs.existsSync(distDir)) {
      console.warn(`dist/ not found, skipping butler push for ${p}`);
      continue;
    }

    console.log(`\n=> Pushing to itch.io: ${target} v${version}`);
    try {
      execSync(`butler push "${distDir}" ${target} --userversion ${version}`, { stdio: 'inherit' });
    } catch (e) {
      console.error(`Butler push failed for ${target}:`, e.message);
    }
  }
}

// ─── Step 6: Git tag ──────────────────────────────────────────────────────

const tag = `${appName}-v${version}`;
try {
  execSync(`git tag -a ${tag} -m "${productName} v${version}"`, { cwd: repoRoot, stdio: 'pipe' });
  console.log(`\n=> Tagged: ${tag}`);
} catch {
  console.warn(`Tag ${tag} may already exist`);
}

console.log(`\n=> Done! ${productName} v${version} published.`);
