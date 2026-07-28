const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Track lifecycle: 'raw' (imported, not yet analyzed) -> 'needs_mastering'
// (analyzed, has lufs/truePeakDb) -> 'mastered' (has a dialed-in
// preview and/or has been exported — see below). Callers (library
// screen, analyze step, master-run step) set status via updateTrack —
// this module just persists whatever it's given.
//
// Two independent, deliberately separate things a track can have:
//   - preview{Path,Lufs,TruePeakDb,Params,Preset,edAt} — Chain view's
//     own slot (one file per track, app-managed, in previewsDir() — see
//     sweepPreviews below), written only by Chain view's Master button.
//     This is for auditioning/comparing, never a final deliverable.
//   - exported{Path,At} — the last real, user-chosen destination Export
//     wrote a file to. Export reads previewParams (falling back to
//     defaults) but never writes the preview fields — exporting doesn't
//     change what's "dialed in", it just records that *that* dialed-in
//     version has now been committed to a real file. Export's queue
//     uses this to skip tracks that are already exported and haven't
//     been re-mastered since (previewedAt > exportedAt), so running it
//     twice doesn't silently duplicate every file under two different
//     names.

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
    previewPreset: null,
    previewedAt: null,
    previewPath: null,
    previewLufs: null,
    previewTruePeakDb: null,
    previewParams: null,
    exportedPath: null,
    exportedAt: null,
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
  const track = loadLibrary(userDataDir).find((t) => t.id === id);
  if (track && track.previewPath) {
    try {
      fs.rmSync(track.previewPath, { force: true });
    } catch {
      // best-effort — a missing/locked file here shouldn't block removal
    }
  }
  const tracks = loadLibrary(userDataDir).filter((t) => t.id !== id);
  saveLibrary(userDataDir, tracks);
  return tracks;
}

// Previews are never authoritative — always regenerable from a track's
// path + previewParams (mastering one track takes about a second), so
// deleting one is never destructive, only "recompute it next time it's
// needed". That's what makes the sweep below safe to run unconditionally
// on every launch rather than needing careful, risky bookkeeping.

function previewsDir(userDataDir) {
  const dir = path.join(userDataDir, 'previews');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function previewPathForTrack(userDataDir, trackId) {
  return path.join(previewsDir(userDataDir), `${trackId}.flac`);
}

const PREVIEW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sweepPreviews(userDataDir) {
  const dir = previewsDir(userDataDir);
  const liveIds = new Set(loadLibrary(userDataDir).map((t) => t.id));
  const now = Date.now();
  let removed = 0;

  for (const entry of fs.readdirSync(dir)) {
    const id = entry.replace(/\.flac$/, '');
    const filePath = path.join(dir, entry);
    const isOrphan = !liveIds.has(id);
    const isStale = !isOrphan && now - fs.statSync(filePath).mtimeMs > PREVIEW_MAX_AGE_MS;
    if (isOrphan || isStale) {
      fs.rmSync(filePath, { force: true });
      removed++;
    }
  }
  return removed;
}

// Named chain presets: a snapshot of Chain view's params object under a
// user-chosen name, stored in presets.json beside library.json. Saving
// under an existing name overwrites it.
//
// Shipped out of the box with one preset per common playback target, so a
// fresh install has real starting points rather than an empty dropdown.
// Chain view defaults to "Club" on every launch (not the last selection).
const DEFAULT_PRESETS = [
  {
    name: 'Streaming',
    // Platform loudness-normalizes (Spotify/Apple Music/YouTube ~-14 LUFS),
    // so headroom matters more than raw loudness — gentle drive, -1dBTP
    // ceiling to survive lossy transcodes without inter-sample clipping.
    // Width left unchanged (100%) — has to translate safely across every
    // playback system a stream might land on, including mono/phone
    // speakers, so no reason to push the stereo image further.
    params: {
      eq: true,
      monoBass: true,
      crossover: 120,
      saturation: true,
      saturationAmount: 0.03,
      width: true,
      widthAmount: 1.0,
      target: -14,
      ceiling: -1.0,
    },
    savedAt: null,
  },
  {
    name: 'Soundcloud',
    // SoundCloud applies little to no normalization, so tracks need to be
    // louder to compete, with a bit more drive for presence over laptop
    // speakers/earbuds while keeping a safe -1dBTP ceiling for its transcode.
    // Slightly wider (110%) — mostly a headphone/earbud listening context,
    // where extra width reads as size rather than translation risk.
    params: {
      eq: true,
      monoBass: true,
      crossover: 100,
      saturation: true,
      saturationAmount: 0.05,
      width: true,
      widthAmount: 1.1,
      target: -11,
      ceiling: -1.0,
    },
    savedAt: null,
  },
  {
    name: 'Club',
    // Played on a system, not normalized or lossy-transcoded — pushed
    // loudest and hottest, tighter mono-bass crossover and more drive for
    // punch through a PA, narrower ceiling since there's no codec headroom
    // to protect. A bit more width (115%) for size on a big system —
    // mono_bass already protects everything below the crossover, so this
    // only ever widens content that's already safe to spread out.
    params: {
      eq: true,
      monoBass: true,
      crossover: 80,
      saturation: true,
      saturationAmount: 0.08,
      width: true,
      widthAmount: 1.15,
      target: -8,
      ceiling: -0.3,
    },
    savedAt: null,
  },
];

function presetsFilePath(userDataDir) {
  return path.join(userDataDir, 'presets.json');
}

function loadPresets(userDataDir) {
  const file = presetsFilePath(userDataDir);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEFAULT_PRESETS, null, 2));
    return DEFAULT_PRESETS;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function savePreset(userDataDir, name, params) {
  const presets = loadPresets(userDataDir).filter((p) => p.name !== name);
  presets.push({ name, params, savedAt: new Date().toISOString() });
  fs.writeFileSync(presetsFilePath(userDataDir), JSON.stringify(presets, null, 2));
  return presets;
}

function deletePreset(userDataDir, name) {
  const presets = loadPresets(userDataDir).filter((p) => p.name !== name);
  fs.writeFileSync(presetsFilePath(userDataDir), JSON.stringify(presets, null, 2));
  return presets;
}

module.exports = {
  loadLibrary,
  saveLibrary,
  addTrack,
  updateTrack,
  removeTrack,
  loadPresets,
  savePreset,
  deletePreset,
  previewsDir,
  previewPathForTrack,
  sweepPreviews,
};
