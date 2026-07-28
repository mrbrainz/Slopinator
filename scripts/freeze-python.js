#!/usr/bin/env node
// Freeze master.py + its dependencies into a standalone binary with
// PyInstaller, so the packaged app doesn't depend on system Python. Run
// automatically as a prepack/predist hook (see package.json) — the output
// is bundled as the "master-bin" extraResource, then (on macOS) re-signed
// along with the rest of the .app by scripts/afterSign.js.
//
// A plain Node script rather than bash: PyInstaller can't cross-compile
// (it freezes for whatever OS/arch it actually runs on), so the release
// workflow (.github/workflows/release.yml) runs this natively on each of
// macOS/Windows/Linux — and a venv's executables live in .venv/bin on
// macOS/Linux but .venv/Scripts on Windows, which bash alone doesn't
// account for.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const isWindows = process.platform === 'win32';
const venvBinDir = path.join(repoRoot, '.venv', isWindows ? 'Scripts' : 'bin');
const exe = (name) => path.join(venvBinDir, isWindows ? `${name}.exe` : name);

const pip = exe('pip');
const pyinstaller = exe('pyinstaller');

if (!fs.existsSync(pyinstaller)) {
  console.log('freeze-python: installing pyinstaller into .venv');
  execFileSync(pip, ['install', '--quiet', 'pyinstaller'], { stdio: 'inherit' });
}

const distPath = path.join(repoRoot, 'build', 'pyinstaller');
const workPath = path.join(repoRoot, 'build', 'pyinstaller-work');
fs.rmSync(distPath, { recursive: true, force: true });
fs.rmSync(workPath, { recursive: true, force: true });

// Size: --optimize 2 strips docstrings from bytecode; the excludes drop
// stdlib modules proven unused by all three modes (master run, --analyze,
// --peaks) — see the size-optimization section in docs/context.md before
// adding imports that might need these.
execFileSync(
  pyinstaller,
  [
    '--onedir',
    '--name',
    'master',
    '--distpath',
    distPath,
    '--workpath',
    workPath,
    '--specpath',
    workPath,
    '--noconfirm',
    '--optimize',
    '2',
    '--exclude-module',
    'ssl',
    '--exclude-module',
    '_ssl',
    '--exclude-module',
    '_hashlib',
    '--exclude-module',
    'scipy',
    path.join(repoRoot, 'master.py'),
  ],
  { stdio: 'inherit', cwd: repoRoot }
);

const binName = isWindows ? 'master.exe' : 'master';
console.log(`freeze-python: built build/pyinstaller/master/${binName}`);
