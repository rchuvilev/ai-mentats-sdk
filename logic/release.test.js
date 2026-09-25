/**
 * Tests for the release script's pure decisions.
 *
 * The notes range is the one that had teeth. With no previous tag the script
 * asked git for `HEAD~20..HEAD`, which is only a valid revision in a repo that
 * HAS twenty commits; `git log` fails outright otherwise, the failure was
 * swallowed, and the release shipped with a generic one-line note instead of
 * its changelog. Every app in this family is short enough to hit that — they
 * were squashed to a single commit during the migration.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const { mkdtempSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { notesRange, isReleaseAsset } = require('./release.js');

/* ── the range ──────────────────────────────────────────────────────────── */

test('with a previous tag, notes cover everything since it', () => {
  assert.deepStrictEqual(notesRange('ai-mentat-n8n-v1.2.0'),
    { range: 'ai-mentat-n8n-v1.2.0..HEAD', limit: null });
});

test('with no previous tag, the range is HEAD with a cap — not HEAD~20', () => {
  // HEAD~20 is not a revision in a young repo, so git log failed and the
  // changelog silently became the fallback line.
  const r = notesRange('');
  assert.strictEqual(r.range, 'HEAD');
  assert.strictEqual(r.limit, 20);
  assert.ok(!r.range.includes('~'), 'must not name a commit that may not exist');
});

test('a missing tag is treated the same as an empty one', () => {
  assert.strictEqual(notesRange(undefined).range, 'HEAD');
  assert.strictEqual(notesRange(null).range, 'HEAD');
});

test('the untagged range actually resolves in a one-commit repo', () => {
  // The bug was a git-level failure, so this asserts against real git rather
  // than against the string.
  const dir = mkdtempSync(join(tmpdir(), 'release-range-'));
  const git = (c) => execSync(`git ${c}`, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init -q');
  git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m "only commit"');

  const { range, limit } = notesRange('');
  const out = git(`log -n ${limit} --pretty=format:"- %s" ${range}`).trim();
  assert.strictEqual(out, '- only commit');

  // CONTROL: the old range really does fail here, so the fix is not cosmetic.
  assert.throws(() => git('log --pretty=format:"- %s" HEAD~20..HEAD'),
    /./, 'HEAD~20..HEAD must be unusable in a one-commit repo');
});

/* ── assets ─────────────────────────────────────────────────────────────── */

test('update metadata is not uploaded as a release asset', () => {
  for (const f of ['latest-mac.yml', 'latest.yaml', 'app-1.0.0.dmg.blockmap']) {
    assert.ok(!isReleaseAsset(f), `${f} should be excluded`);
  }
});

test('the installers are', () => {
  for (const f of ['Mentat-1.2.0-universal.dmg', 'mentat_1.2.0_amd64.deb', 'mentat-1.2.0.msi']) {
    assert.ok(isReleaseAsset(f), `${f} should be uploaded`);
  }
});

test('a name that merely contains yml is still an asset', () => {
  // The check is an extension, not a substring — `ymlviewer.dmg` ships.
  assert.ok(isReleaseAsset('ymlviewer-1.0.0.dmg'));
  assert.ok(isReleaseAsset('yaml.dmg'));
});
