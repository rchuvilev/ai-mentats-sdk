#!/usr/bin/env node
/**
 * Release script for Electron apps.
 *
 * Uploads to GitHub (gh) and itch.io (butler) from a single dist/ directory.
 *
 * Usage (from an app directory):
 *   node shared/electron-release.js
 *   node shared/electron-release.js --github-only
 *   node shared/electron-release.js --itch-only --platform=mac
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD~20..HEAD';
  let notes = '';
  try {
    notes = execSync(`git log --pretty=format:"- %s" ${range} -- "${appDir}/"`, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {}

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
    if (/\.(blockmap|yaml|yml)$/.test(f)) return false;
    return true;
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
