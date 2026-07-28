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
  target: -8,
  ceiling: -0.3,
};

let exportQueue = [];
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
  if (state === 'queued') {
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

function renderPresetSelect(track, presets) {
  const select = document.createElement('select');
  select.className = 'export-preset-select';

  const dialedIn = document.createElement('option');
  dialedIn.value = '';
  dialedIn.textContent = track.previewParams
    ? `Dialed in Chain view (${track.previewParams.target} LUFS)`
    : `Default — ${presetOptionLabel(fallbackPreset(presets))}`;
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

function renderExportRow(track, presets) {
  const row = document.createElement('div');
  row.className = 'export-row';

  const name = document.createElement('div');
  name.className = 'track-name';
  name.textContent = track.name;

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
  actionBtn.addEventListener('click', async () => {
    const folder = await window.slopinator.pickExportFolder();
    if (!folder) return;
    await runQueue([track], row, folder);
  });

  row.append(name, renderPresetSelect(track, presets), progressTrack, statusEl, actionBtn);
  setRowState(row, 'queued');
  return row;
}

async function refreshExport() {
  if (isExporting) return; // don't rebuild rows out from under a running export

  const [tracks, presets] = await Promise.all([window.slopinator.libraryList(), window.slopinator.presetsList()]);
  cachedPresets = presets;
  exportQueue = tracks.filter(needsExport);

  const liveIds = new Set(exportQueue.map((t) => t.id));
  Array.from(exportOverrides.keys()).forEach((id) => {
    if (!liveIds.has(id)) exportOverrides.delete(id);
  });

  const alreadyExportedCount = tracks.filter(
    (t) => (t.status === 'needs_mastering' || t.status === 'mastered') && !needsExport(t)
  ).length;

  const countText = `${exportQueue.length} track${exportQueue.length === 1 ? '' : 's'} queued`;
  exportCountEl.textContent = alreadyExportedCount
    ? `${countText} · ${alreadyExportedCount} already exported (re-master in Chain view to include again)`
    : countText;

  const hasTracks = exportQueue.length > 0;
  exportEmptyEl.style.display = hasTracks ? 'none' : '';
  exportContentEl.style.display = hasTracks ? '' : 'none';

  exportRowsEl.innerHTML = '';
  exportQueue.forEach((track) => exportRowsEl.appendChild(renderExportRow(track, cachedPresets)));
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

  const tracks = exportQueue.slice();
  const rows = Array.from(exportRowsEl.children);
  const failures = await runQueue(tracks, rows, folder);

  exportCountEl.textContent = failures
    ? `Done — ${failures} of ${tracks.length} failed`
    : `Exported ${tracks.length} track${tracks.length === 1 ? '' : 's'} to ${folder}`;
});

document.addEventListener('screen-activated', (e) => {
  if (e.detail.screen === 'export') refreshExport();
});
