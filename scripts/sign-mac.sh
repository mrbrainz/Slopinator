#!/bin/bash
# Ad-hoc re-sign the packaged .app after electron-builder adds extraResources.
# Without this, macOS Gatekeeper trashes the app as "malware" on first launch
# (same root cause as the dev Electron.app binary — see docs/context.md).
# We have no Apple Developer ID cert, so ad-hoc (--sign -) is what's available;
# it satisfies Gatekeeper locally but isn't notarized for distribution outside
# this machine.
set -euo pipefail

APP_PATH=$(find dist -maxdepth 2 -name '*.app' -print -quit)

if [ -z "$APP_PATH" ]; then
  echo "sign-mac.sh: no .app found under dist/, skipping"
  exit 0
fi

echo "sign-mac.sh: ad-hoc signing $APP_PATH"
xattr -cr "$APP_PATH"
codesign --deep --force --sign - "$APP_PATH"
codesign -dv "$APP_PATH"
