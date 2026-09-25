#!/usr/bin/env node
/**
 * Release script for Electron apps.
 *
 * Uploads to GitHub (gh) and itch.io (butler) from a single dist/ directory.
 *
 * Usage, from the app directory:
 *   npm run release
 *   node sdk/logic/release.js --github-only
 *   node sdk/logic/release.js --itch-only --platform=mac
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * The commit range release notes are built from.
 *
 * With a previous tag it is everything since. Without one it used to be
 * `HEAD~20..HEAD`, which is only a valid revision in a repo that HAS twenty
 * commits — `git log` fails outright otherwise, the failure was swallowed, and
 * the release went out with the generic one-line fallback instead of its real
 * changelog. Every one of these repos is short enough to hit that: they were
 * squashed to a single commit during the migration.
 *
 * `HEAD` with a count cap means "the last N, however few exist".
 */
function notesRange(lastTag) {
  return lastTag ? { range: `${lastTag}..HEAD`, limit: null } : { range: 'HEAD', limit: 20 };
}

/** Which dist/ files are release assets. */
function isReleaseAsset(name) {
  return !/\.(blockmap|yaml|yml)$/.test(name);
}

module.exports = { notesRange, isReleaseAsset };

// Only run the release when invoked as a script, so the helpers are testable.
if (require.main !== module) return;


const args = process.argv.slice(2);
const get = (flag) => {
  const a = args.find((a) => a.startsWith(`--${flag}=`));
  return a ? a.split('=')[1] : undefined;
};

const githubOnly = args.includes('--github-only');
const itchOnly = args.includes('--itch-only');
const platform = get('platform');

const cwd = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
const version = pkg.version || '0.0.0';
const productName = (pkg.build && pkg.build.productName) || pkg.name;
const appName = pkg.name;
const tag = `${appName}-v${version}`;

// Resolve repo root
let repoRoot = cwd;
while (!fs.existsSync(path.join(repoRoot, '.git')) && repoRoot !== path.dirname(repoRoot)) {
  repoRoot = path.dirname(repoRoot);
}
const appDir = path.relative(repoRoot, cwd) || '.';

// Generate release notes
function generateNotes() {
  let lastTag = '';
  try {
    lastTag = execSync(`git tag -l "${appName}-v*" --sort=-v:refname`, { cwd: repoRoot, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)[0] || '';
  } catch {}

  const { range, limit } = notesRange(lastTag);
  const count = limit ? `-n ${limit} ` : '';
  let notes = '';
  try {
    notes = execSync(`git log ${count}--pretty=format:"- %s" ${range} -- "${appDir}/"`,
                     { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch (e) {
    // Recorded, not swallowed: an empty changelog on a release is the kind of
    // thing nobody notices until they go looking for it later.
    console.warn(`  could not read the log for ${range}: ${e.message.split('\n')[0]}`);
  }

  return notes || `- ${productName} v${version} release`;
}

const notes = generateNotes();
const notesFile = path.join(os.tmpdir(), `${appName}-release-notes.txt`);
fs.writeFileSync(notesFile, `${productName} v${version}\n\n${notes}`, 'utf8');
console.log(`\nRelease notes:\n${notes}\n`);

const distDir = path.join(cwd, 'dist');
if (!fs.existsSync(distDir)) {
  console.error('Error: dist/ not found. Run build first.');
  process.exit(1);
}

// Collect assets (skip directories, blockmap, yaml)
const assets = fs.readdirSync(distDir)
  .filter(f => {
    const full = path.join(distDir, f);
    if (fs.statSync(full).isDirectory()) return false;
    return isReleaseAsset(f);
  })
  .map(f => `"${path.join(distDir, f)}"`);

// GitHub release
if (!itchOnly && assets.length > 0) {
  try {
    execSync(`git tag -a ${tag} -m "${productName} v${version}"`, { cwd: repoRoot, stdio: 'inherit' });
    execSync(`git push origin ${tag}`, { cwd: repoRoot, stdio: 'inherit' });
  } catch { console.warn(`Tag ${tag} may already exist, continuing...`); }

  const assetArgs = assets.join(' ');
  try {
    execSync(`gh release create ${tag} ${assetArgs} --title "${productName} v${version}" --notes-file "${notesFile}"`, { cwd: repoRoot, stdio: 'inherit' });
    console.log(`\n=> GitHub release created: ${tag}`);
  } catch {
    execSync(`gh release upload ${tag} ${assetArgs} --clobber`, { cwd: repoRoot, stdio: 'inherit' });
    console.log(`\n=> Assets uploaded to existing release: ${tag}`);
  }
}

// itch.io butler
if (!githubOnly && pkg.itch_io && pkg.itch_io.user && pkg.itch_io.game) {
  const channelMap = { mac: 'osx', win: 'windows', linux: 'linux' };
  const platforms = platform ? [platform] : ['mac', 'win', 'linux'];

  for (const p of platforms) {
    const channel = channelMap[p];
    if (!channel) continue;
    const target = `${pkg.itch_io.user}/${pkg.itch_io.game}:${channel}`;
    try {
      execSync(`butler push "${distDir}" ${target} --userversion ${version} --note-file "${notesFile}"`, { stdio: 'inherit' });
      console.log(`\n=> itch.io: ${target} v${version}`);
    } catch (e) {
      console.error(`Failed to push to ${target}:`, e.message);
    }
  }
}

try { fs.unlinkSync(notesFile); } catch {}
