const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Track lifecycle: 'raw' (imported, not yet analyzed) -> 'needs_mastering'
// (analyzed, has lufs/truePeakDb) -> 'mastered' (run through master.py, has
// masteredPreset/masteredAt/masteredPath/masteredLufs/masteredTruePeakDb/
// masteredParams — the output path, its own measured stats, and the exact
// rack params used, for the Compare screen). Callers (library screen,
// analyze step, master-run step) are responsible for setting status via
// updateTrack — this module just persists whatever it's given.

function libraryFilePath(userDataDir) {
  return path.join(userDataDir, 'library.json');
}

function loadLibrary(userDataDir) {
  const file = libraryFilePath(userDataDir);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function saveLibrary(userDataDir, tracks) {
  fs.writeFileSync(libraryFilePath(userDataDir), JSON.stringify(tracks, null, 2));
}

function addTrack(userDataDir, filePath) {
  const tracks = loadLibrary(userDataDir);
  if (tracks.some((t) => t.path === filePath)) {
    return tracks;
  }
  const track = {
    id: crypto.randomUUID(),
    path: filePath,
    name: path.basename(filePath),
    addedAt: new Date().toISOString(),
    status: 'raw',
    durationSec: null,
    sampleRate: null,
    channels: null,
    bitDepth: null,
    lufs: null,
    truePeakDb: null,
    masteredPreset: null,
    masteredAt: null,
    masteredPath: null,
    masteredLufs: null,
    masteredTruePeakDb: null,
    masteredParams: null,
  };
  tracks.push(track);
  saveLibrary(userDataDir, tracks);
  return tracks;
}

function updateTrack(userDataDir, id, patch) {
  const tracks = loadLibrary(userDataDir);
  const idx = tracks.findIndex((t) => t.id === id);
  if (idx === -1) return tracks;
  tracks[idx] = { ...tracks[idx], ...patch };
  saveLibrary(userDataDir, tracks);
  return tracks;
}

function removeTrack(userDataDir, id) {
  const tracks = loadLibrary(userDataDir).filter((t) => t.id !== id);
  saveLibrary(userDataDir, tracks);
  return tracks;
}

module.exports = { loadLibrary, saveLibrary, addTrack, updateTrack, removeTrack };
