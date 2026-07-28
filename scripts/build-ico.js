#!/usr/bin/env node
// Packs pre-resized PNGs into a proper multi-resolution assets/icon.ico
// for Windows.
//
// Why this exists: electron-builder can auto-generate a Windows .ico
// from a single source PNG at build time, but that auto-conversion
// produced a corrupted taskbar icon (garbled/rainbow-noise render) for
// this project's icon.png — a known rough edge in that pipeline,
// especially for a busy/detailed source image at odd dimensions (this
// one is 782x782). Shipping a proper hand-built .ico (via
// build.win.icon in package.json) sidesteps that auto-conversion
// entirely, and gives control over how the smallest sizes (16/24px,
// what actually shows in the taskbar) get downsampled.
//
// Re-run this whenever assets/icon.png changes:
//   for size in 16 24 32 48 64 128 256; do
//     sips -z $size $size assets/icon.png --out /tmp/icon-$size.png
//   done
//   node scripts/build-ico.js
//
// (sips is macOS-only; any tool that can resize a PNG to an exact
// square size works the same way — the ICO format itself just needs
// correctly-sized PNG files as input.)

const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const repoRoot = path.join(__dirname, '..');

const images = SIZES.map((size) => {
  const file = path.join('/tmp', `icon-${size}.png`);
  return { size, data: fs.readFileSync(file) };
});

// ICONDIR header: reserved(2)=0, type(2)=1 (icon), count(2)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

// One 16-byte ICONDIRENTRY per image, followed by the image data itself
// (PNG-compressed — supported natively since Windows Vista, no need to
// re-encode as raw BMP).
let offset = 6 + images.length * 16;
const entries = [];
const dataChunks = [];

for (const { size, data } of images) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256px)
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 = 256px)
  entry.writeUInt8(0, 2); // color count (0 = >=256 colors)
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(data.length, 8); // image data size
  entry.writeUInt32LE(offset, 12); // image data offset
  entries.push(entry);
  dataChunks.push(data);
  offset += data.length;
}

const ico = Buffer.concat([header, ...entries, ...dataChunks]);
const outPath = path.join(repoRoot, 'assets', 'icon.ico');
fs.writeFileSync(outPath, ico);
console.log(`build-ico: wrote ${outPath} (${images.length} sizes: ${SIZES.join(', ')})`);
