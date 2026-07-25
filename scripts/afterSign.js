const { execFileSync } = require('child_process');
const path = require('path');

// electron-builder's afterSign hook: runs after the .app is assembled but
// before it's packed into a .dmg/.zip. Signing here (rather than a
// postpack/postdist npm script) is required — npm post-scripts only run
// after the whole build finishes, by which point the .dmg already has the
// unsigned .app baked in.
module.exports = async function afterSign(context) {
  const { appOutDir, packager } = context;
  const appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);

  execFileSync('xattr', ['-cr', appPath]);
  execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath]);
  console.log(`afterSign: ad-hoc signed ${appPath}`);
};
