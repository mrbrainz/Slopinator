// Export screen: batch-export tracks that haven't already been exported
// to a chosen folder. Each queued row can be exported individually too,
// via its own "Export…" button — not just as part of the whole-queue run.
// See docs/context.md's "Preview vs export" section for the preview/export
// split this all builds on.
//
// Target loudness per track: if a track was dialed in Chain view, its
// previewParams are used by default; otherwise it falls back to the
// "Club" named preset (matching Chain view's own default — see
// src/main/library.js's DEFAULT_PRESETS). Either way, the row's preset
// dropdown can override the target for this export only, without
// touching what's saved in Chain view.
//
// Reusing the preview instead of re-rendering: a track's preview
// (previewPath) is already a full render of previewParams at PCM_16 (see
// chain-view.js's Master button — it never passes a bitDepth). So a
// WAV-16/FLAC-16 export of a track using its dialed-in params (no preset
// override) can skip the whole EQ/mono-bass/saturation/loudness/limiter
// chain and just re-encode the existing preview file
// (master.py --transcode). A WAV-24 export, or any export using an
// overridden preset, always does a full fresh render — the preview never
// held 24-bit precision, and an override means the preview's audio
// doesn't match what should be exported.
//
// Progress is stepped (queued / rendering / done) — master.py reports
// nothing mid-file, so there's no honest percentage (docs/todos.md).

const exportCountEl = document.getElementById('export-count');
const exportEmptyEl = document.getElementById('export-empty');
const exportContentEl = document.getElementById('export-content');
const exportFormatEl = document.getElementById('export-format');
const exportRowsEl = document.getElementById('export-rows');
const exportRunBtn = document.getElementById('export-run-btn');

const EXPORT_FORMATS = {
  wav16: { bitDepth: 'PCM_16', ext: 'wav' },
  wav24: { bitDepth: 'PCM_24', ext: 'wav' },
  flac16: { bitDepth: 'PCM_16', ext: 'flac' },
};

// Last-resort fallback if the "Club" preset was deleted — mirrors
// library.js's DEFAULT_PRESETS Club entry so behavior stays consistent
// even without it.
const DEFAULT_EXPORT_PARAMS = {
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
};

let exportQueue = [];
// Parallel to exportQueue: true if that track's source file is missing
// on disk (moved/deleted since import). Library already flags this on
// its own row, but Export used to show the track with no warning at
// all and let you queue an export that could only ever fail.
let exportMissing = [];
let cachedPresets = [];
let isExporting = false;

// trackId -> preset object ({name, params}) chosen from a row's dropdown,
// overriding that track's export target for this session only.
const exportOverrides = new Map();

function fallbackPreset(presets) {
  return presets.find((p) => p.name === 'Club') || { name: null, params: DEFAULT_EXPORT_PARAMS };
}

function effectiveParams(track, presets) {
  const override = exportOverrides.get(track.id);
  if (override) return override.params;
  return track.previewParams || fallbackPreset(presets).params;
}

// Needs exporting if it's analyzed/mastered AND (never exported, or
// dialed in again in Chain view since the last export).
function needsExport(track) {
  if (track.status !== 'needs_mastering' && track.status !== 'mastered') return false;
  if (!track.exportedAt) return true;
  return Boolean(track.previewedAt && track.previewedAt > track.exportedAt);
}

function setRowState(row, state, label) {
  const fill = row.querySelector('.progress-fill');
  const statusEl = row.querySelector('.export-status');
  if (state === 'missing') {
    fill.style.width = '100%';
    fill.style.background = 'var(--danger)';
    statusEl.className = 'mini-meter warn export-status';
    statusEl.textContent = 'File missing';
  } else if (state === 'queued') {
    fill.style.width = '0%';
    statusEl.className = 'mini-meter empty export-status';
    statusEl.textContent = 'Queued';
  } else if (state === 'rendering') {
    fill.style.width = '50%';
    fill.style.background = 'var(--amber)';
    statusEl.className = 'mini-meter warn export-status';
    statusEl.textContent = label || 'Rendering…';
  } else if (state === 'done') {
    fill.style.width = '100%';
    fill.style.background = 'var(--teal)';
    statusEl.className = 'mini-meter export-status';
    statusEl.textContent = 'Done';
  } else {
    fill.style.width = '100%';
    fill.style.background = 'var(--danger)';
    statusEl.className = 'mini-meter warn export-status';
    statusEl.textContent = 'Failed';
  }
}

function presetOptionLabel(preset) {
  return `${preset.name} (${preset.params.target} LUFS)`;
}

const PRESET_PARAM_KEYS = [
  'eq',
  'monoBass',
  'crossover',
  'saturation',
  'saturationAmount',
  'saturationCrossover',
  'width',
  'widthAmount',
  'target',
  'ceiling',
];

function paramsMatch(a, b) {
  return PRESET_PARAM_KEYS.every((key) => a[key] === b[key]);
}

// A track's previewParams matches a saved preset exactly when it was
// mastered from that preset in Chain view without touching any slider
// afterward — worth calling out by name instead of the generic "dialed
// in" label, which reads like a deliberate custom tweak either way.
function matchingPresetName(params, presets) {
  const match = presets.find((preset) => paramsMatch(preset.params, params));
  return match ? match.name : null;
}

function renderPresetSelect(track, presets) {
  const select = document.createElement('select');
  select.className = 'export-preset-select';

  const dialedIn = document.createElement('option');
  dialedIn.value = '';
  if (track.previewParams) {
    const matchedName = matchingPresetName(track.previewParams, presets);
    dialedIn.textContent = matchedName
      ? `${matchedName} (${track.previewParams.target} LUFS)`
      : `Custom (${track.previewParams.target} LUFS)`;
  } else {
    dialedIn.textContent = `Default — ${presetOptionLabel(fallbackPreset(presets))}`;
  }
  select.appendChild(dialedIn);

  presets.forEach((preset) => {
    const option = document.createElement('option');
    option.value = preset.name;
    option.textContent = presetOptionLabel(preset);
    select.appendChild(option);
  });

  const override = exportOverrides.get(track.id);
  select.value = override ? override.name : '';

  select.addEventListener('change', () => {
    if (!select.value) {
      exportOverrides.delete(track.id);
    } else {
      const preset = presets.find((p) => p.name === select.value);
      if (preset) exportOverrides.set(track.id, preset);
    }
  });

  return select;
}

function renderExportRow(track, presets, missing) {
  const row = document.createElement('div');
  row.className = 'export-row' + (missing ? ' missing' : '');

  const nameWrap = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'track-name';
  name.textContent = track.name;
  nameWrap.appendChild(name);
  if (missing) {
    const warn = document.createElement('div');
    warn.className = 'track-sub';
    warn.textContent = `Original file missing — can't export: ${track.path}`;
    nameWrap.appendChild(warn);
  }

  const presetSelect = renderPresetSelect(track, presets);
  presetSelect.disabled = missing;

  const progressTrack = document.createElement('div');
  progressTrack.className = 'progress-track';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  progressTrack.appendChild(fill);

  const statusEl = document.createElement('div');
  statusEl.className = 'mini-meter empty export-status';

  const actionBtn = document.createElement('button');
  actionBtn.className = 'btn ghost export-row-btn';
  actionBtn.textContent = 'Export…';
  actionBtn.disabled = missing;
  actionBtn.addEventListener('click', async () => {
    const folder = await window.slopinator.pickExportFolder();
    if (!folder) return;
    await runQueue([track], row, folder);
  });

  row.append(nameWrap, presetSelect, progressTrack, statusEl, actionBtn);
  setRowState(row, missing ? 'missing' : 'queued');
  return row;
}

async function refreshExport() {
  if (isExporting) return; // don't rebuild rows out from under a running export

  const [tracks, presets] = await Promise.all([window.slopinator.libraryList(), window.slopinator.presetsList()]);
  cachedPresets = presets;
  exportQueue = tracks.filter(needsExport);
  exportMissing = await Promise.all(
    exportQueue.map((t) => window.slopinator.classifyPath(t.path).then((kind) => kind === null))
  );

  const liveIds = new Set(exportQueue.map((t) => t.id));
  Array.from(exportOverrides.keys()).forEach((id) => {
    if (!liveIds.has(id)) exportOverrides.delete(id);
  });

  const alreadyExportedCount = tracks.filter(
    (t) => (t.status === 'needs_mastering' || t.status === 'mastered') && !needsExport(t)
  ).length;
  const missingCount = exportMissing.filter(Boolean).length;

  const countText = `${exportQueue.length} track${exportQueue.length === 1 ? '' : 's'} queued`;
  exportCountEl.textContent =
    countText +
    (missingCount ? ` · ${missingCount} missing (can't export until reconnected)` : '') +
    (alreadyExportedCount ? ` · ${alreadyExportedCount} already exported (re-master in Chain view to include again)` : '');

  const hasTracks = exportQueue.length > 0;
  exportEmptyEl.style.display = hasTracks ? 'none' : '';
  exportContentEl.style.display = hasTracks ? '' : 'none';

  exportRowsEl.innerHTML = '';
  exportQueue.forEach((track, i) => exportRowsEl.appendChild(renderExportRow(track, cachedPresets, exportMissing[i])));
}

function exportOutputPath(folder, track, ext) {
  const base = track.name.replace(/\.[^.]+$/, '');
  return `${folder}/${base}_mastered.${ext}`;
}

// Runs export for one or more tracks against their matching rows,
// reusing each track's rendered preview (a fast re-encode, no DSP) when
// the target format matches what the preview already is (PCM_16) and
// nothing about the target params has been overridden for this export.
async function runQueue(tracks, rows, folder) {
  const { bitDepth, ext } = EXPORT_FORMATS[exportFormatEl.value];
  isExporting = true;
  exportRunBtn.disabled = true;
  const allControls = exportRowsEl.querySelectorAll('.export-row-btn, .export-preset-select');
  allControls.forEach((el) => (el.disabled = true));

  const rowList = Array.isArray(rows) ? rows : [rows];
  let failures = 0;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const row = rowList[i];
    const outputPath = exportOutputPath(folder, track, ext);
    const params = { ...effectiveParams(track, cachedPresets), bitDepth };

    const reusable =
      bitDepth === 'PCM_16' &&
      !exportOverrides.has(track.id) &&
      Boolean(track.previewParams) &&
      Boolean(track.previewPath) &&
      (await window.slopinator.classifyPath(track.previewPath)) === 'file';

    setRowState(row, 'rendering', reusable ? 'Reusing preview…' : 'Rendering…');

    const result = reusable
      ? await window.slopinator.runTranscode({ inputPath: track.previewPath, outputPath, bitDepth })
      : await window.slopinator.runMaster({ inputPath: track.path, outputPath, params });

    setRowState(row, result.success ? 'done' : 'failed');
    if (result.success) {
      const override = exportOverrides.get(track.id);
      // Deliberately not touching previewPath/previewParams here — those
      // are Chain view's own slot, and this track may never have been
      // opened there. exportedAt is what needsExport() checks, so
      // without this a track exported here would just get exported
      // again, under the same name, every time.
      const patch = { status: 'mastered', exportedPath: outputPath, exportedAt: new Date().toISOString() };
      if (override) patch.previewPreset = override.name;
      else if (!track.previewParams) patch.previewPreset = fallbackPreset(cachedPresets).name;
      await window.slopinator.libraryUpdate(track.id, patch);
      exportOverrides.delete(track.id);
    } else {
      failures++;
    }
  }

  isExporting = false;
  exportRunBtn.disabled = false;
  allControls.forEach((el) => (el.disabled = false));
  return failures;
}

exportRunBtn.addEventListener('click', async () => {
  const folder = await window.slopinator.pickExportFolder();
  if (!folder) return;

  // A missing-file track can only ever fail, and its row's own controls
  // are already disabled for exactly that reason — skip it here too
  // rather than let it eat one of runQueue's "failures".
  const allRows = Array.from(exportRowsEl.children);
  const availableIndices = exportQueue.map((_, i) => i).filter((i) => !exportMissing[i]);
  const tracks = availableIndices.map((i) => exportQueue[i]);
  const rows = availableIndices.map((i) => allRows[i]);
  const skipped = exportQueue.length - tracks.length;

  const failures = await runQueue(tracks, rows, folder);

  const skippedText = skipped ? ` (${skipped} skipped — file missing)` : '';
  exportCountEl.textContent = failures
    ? `Done — ${failures} of ${tracks.length} failed${skippedText}`
    : `Exported ${tracks.length} track${tracks.length === 1 ? '' : 's'} to ${folder}${skippedText}`;
});

document.addEventListener('screen-activated', (e) => {
  if (e.detail.screen === 'export') refreshExport();
});
