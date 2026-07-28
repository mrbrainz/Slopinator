const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// electron-builder's afterSign hook: runs after the .app is assembled but
// before it's packed into a .dmg/.zip. Signing here (rather than a
// postpack/postdist npm script) is required — npm post-scripts only run
// after the whole build finishes, by which point the .dmg already has the
// unsigned .app baked in.

// Historically (electron-builder 24.x / Electron 31.x), the build
// config's electronLanguages only pruned the (empty) .lproj stubs in the
// app's own Contents/Resources — the real locale packs (~54MB, ~1.3MB x
// 55 languages of Chromium UI strings) lived inside
// Electron Framework.framework and electron-builder never touched them,
// so this function did the pruning manually before signing sealed the
// bundle. As of electron-builder 26.x (with the Electron 43 upgrade),
// electronLanguages now prunes the framework's real packs itself — this
// runs 0 times in practice now, kept as a defensive no-op safety net in
// case a future electron-builder version regresses that.
const KEEP_LOCALES = new Set(['en.lproj']);

function pruneFrameworkLocales(appPath) {
  const resourcesDir = path.join(
    appPath,
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources'
  );
  let removed = 0;
  for (const entry of fs.readdirSync(resourcesDir)) {
    if (entry.endsWith('.lproj') && !KEEP_LOCALES.has(entry)) {
      fs.rmSync(path.join(resourcesDir, entry), { recursive: true, force: true });
      removed++;
    }
  }
  console.log(`afterSign: pruned ${removed} framework locale packs`);
}

module.exports = async function afterSign(context) {
  // Only macOS has a .app bundle to prune/sign here — electron-builder's
  // afterSign hook can fire for Windows too (its own authenticode signing
  // step), where none of this applies and appPath below wouldn't exist.
  if (context.electronPlatformName !== 'darwin') return;

  const { appOutDir, packager } = context;
  const appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);

  pruneFrameworkLocales(appPath);
  execFileSync('xattr', ['-cr', appPath]);
  execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath]);
  console.log(`afterSign: ad-hoc signed ${appPath}`);
};
