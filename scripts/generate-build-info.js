#!/usr/bin/env node
// Writes src/main/build-info.json with a git-derived build identifier —
// commit count (a monotonically increasing "build number" across the
// repo's history, no counter file to maintain) plus the short commit
// hash, so a running app's footer can be matched back to an exact commit
// instead of guessing whether it's a stale build.
//
// Run via prestart/prepack/predist (package.json) so both `npm start`
// and packaged builds always ship a fresh one. preload.js falls back to
// "unknown" if this file is somehow missing (e.g. `electron .` run
// directly without going through npm).

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');

function git(args, fallback) {
  try {
    return execSync(`git ${args}`, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return fallback;
  }
}

const buildNumber = git('rev-list --count HEAD', '0');
const shortCommit = git('rev-parse --short HEAD', 'unknown');
const isDirty = git('status --porcelain', '') !== '';

const info = {
  buildNumber,
  commit: isDirty ? `${shortCommit}+dirty` : shortCommit,
  builtAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(repoRoot, 'src', 'main', 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`Build info: #${info.buildNumber} (${info.commit})`);
