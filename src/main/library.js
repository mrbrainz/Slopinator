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
    // speakers, so no reason to push the stereo image further. Saturation
    // crossover at 630Hz — same as the other two presets; per-preset
    // tuning (800/630/400Hz) was tried first but 630Hz alone tested
    // better across the board, so all three now share it.
    params: {
      eq: true,
      monoBass: true,
      crossover: 120,
      saturation: true,
      saturationAmount: 0.03,
      saturationCrossover: 630,
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
    // Saturation crossover at 630Hz — upper-mid glue without touching bass.
    params: {
      eq: true,
      monoBass: true,
      crossover: 100,
      saturation: true,
      saturationAmount: 0.05,
      saturationCrossover: 630,
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
    // Saturation crossover at 630Hz, same as the other two presets — see
    // Streaming's comment above for why all three converged on this value.
    params: {
      eq: true,
      monoBass: true,
      crossover: 80,
      saturation: true,
      saturationAmount: 0.08,
      saturationCrossover: 630,
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

// Presets saved before the Width module existed have no width/widthAmount
// at all — rather than leaving that silently unset (functionally width=1.0,
// but inconsistent to look at and to compare against in Export's preset
// matching), backfill it once: the tuned value from the matching built-in
// preset by name, or a neutral 100% for a custom user-named preset. Never
// touches previewParams on already-mastered tracks — those are a record
// of what was actually rendered to a real file, not a template to update.
function withWidthDefault(preset) {
  if (preset.params.width !== undefined && preset.params.widthAmount !== undefined) return preset;
  const builtin = DEFAULT_PRESETS.find((p) => p.name === preset.name);
  return {
    ...preset,
    params: {
      ...preset.params,
      width: builtin ? builtin.params.width : true,
      widthAmount: builtin ? builtin.params.widthAmount : 1.0,
    },
  };
}

// Same backfill as withWidthDefault, for presets saved before the
// saturation-crossover option existed (band-split saturation): the tuned
// value from the matching built-in preset by name, or a neutral 630Hz
// (the default landed on for the Saturation module's crossover slider) for
// a custom preset.
function withSaturationCrossoverDefault(preset) {
  if (preset.params.saturationCrossover !== undefined) return preset;
  const builtin = DEFAULT_PRESETS.find((p) => p.name === preset.name);
  return {
    ...preset,
    params: {
      ...preset.params,
      saturationCrossover: builtin ? builtin.params.saturationCrossover : 630,
    },
  };
}

// PR #52 shipped Streaming/Club with per-preset saturationCrossover
// tuning (800/400Hz); PR #53 changed the built-in defaults to a uniform
// 630Hz across all three, but withSaturationCrossoverDefault() above only
// backfills a *missing* field — any presets.json written between those
// two PRs already had the field set (to the old 800/400 values), so the
// migration silently left it stale on every install that had already run
// the app at least once before #53 shipped. This is a one-time, narrower
// fix specifically for that gap: only touches a built-in-named preset
// whose value still matches the exact old default for that name, so an
// actual user customization (any other value) is left alone.
const STALE_SATURATION_CROSSOVER_BY_NAME = { Streaming: 800, Club: 400 };
function withUniformSaturationCrossover(preset) {
  const staleValue = STALE_SATURATION_CROSSOVER_BY_NAME[preset.name];
  if (staleValue === undefined || preset.params.saturationCrossover !== staleValue) return preset;
  return { ...preset, params: { ...preset.params, saturationCrossover: 630 } };
}

function loadPresets(userDataDir) {
  const file = presetsFilePath(userDataDir);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEFAULT_PRESETS, null, 2));
    return DEFAULT_PRESETS;
  }
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const migrated = saved.map(withWidthDefault).map(withSaturationCrossoverDefault).map(withUniformSaturationCrossover);
    if (JSON.stringify(migrated) !== JSON.stringify(saved)) {
      fs.writeFileSync(file, JSON.stringify(migrated, null, 2));
    }
    return migrated;
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
