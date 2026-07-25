#!/bin/bash
# Freeze master.py + its dependencies into a standalone binary with
# PyInstaller, so the packaged app doesn't depend on system Python. Run
# automatically as a prepack/predist hook (see package.json) — the output
# is bundled as the "master-bin" extraResource and re-signed along with the
# rest of the .app by scripts/sign-mac.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -x .venv/bin/pyinstaller ]; then
  echo "freeze-python.sh: installing pyinstaller into .venv"
  .venv/bin/pip install --quiet pyinstaller
fi

rm -rf build/pyinstaller build/pyinstaller-work
# Size: --optimize 2 strips docstrings from bytecode; the excludes drop
# stdlib modules proven unused by all three modes (master run, --analyze,
# --peaks) — see the size-optimization section in docs/context.md before
# adding imports that might need these. scipy subpackages can NOT be
# excluded: scipy.signal transitively imports them at module level.
.venv/bin/pyinstaller \
  --onedir --name master \
  --distpath build/pyinstaller \
  --workpath build/pyinstaller-work \
  --specpath build/pyinstaller-work \
  --noconfirm \
  --optimize 2 \
  --exclude-module ssl \
  --exclude-module _ssl \
  --exclude-module _hashlib \
  master.py

echo "freeze-python.sh: built build/pyinstaller/master/master"
