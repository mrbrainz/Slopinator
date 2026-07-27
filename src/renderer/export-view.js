// Export screen: batch-export tracks that haven't already been exported
// to a chosen folder. Each track re-runs master.py with the exact params
// it was dialed in with in Chain view (previewParams — see
// docs/context.md's "Preview vs export" section); tracks never opened
// there fall back to fixed defaults, and the queue row says "(default)"
// so that's not mistaken for a real per-track choice. Progress is
// stepped (queued / rendering / done) — master.py reports nothing
// mid-file, so there's no honest percentage to show (docs/todos.md).
//
// This is the only place a real, user-chosen destination file ever gets
// written — Chain view's Master button renders to an app-managed preview
// slot instead. Export never touches the preview fields; it only records
// exportedPath/exportedAt, which is also what keeps the queue from
// re-exporting (and re-naming, and duplicating) something already
// written out: a track is only queued if it's never been exported, or
// has been re-mastered in Chain view since its last export
// (previewedAt > exportedAt).

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

const EXPORT_PRESETS = { '-14': 'streaming', '-11': 'soundcloud', '-8': 'club' };

// master.py's own defaults (matches src/renderer/chain-view.js's initial
// params) — used only for tracks that were never mastered in Chain view.
const DEFAULT_EXPORT_PARAMS = {
  eq: true,
  monoBass: true,
  crossover: 120,
  saturation: true,
  saturationAmount: 0.05,
  target: -14,
  ceiling: -1.0,
};

let exportQueue = [];
let isExporting = false;

function trackExportParams(track) {
  return track.previewParams || DEFAULT_EXPORT_PARAMS;
}

function presetNameForTarget(target) {
  return EXPORT_PRESETS[String(target)] || null;
}

function targetLabel(track) {
  const params = trackExportParams(track);
  const preset = presetNameForTarget(params.target);
  const label = `${params.target} LUFS${preset ? ` ${preset}` : ''}`;
  return track.previewParams ? label : `${label} (default)`;
}

// Needs exporting if it's analyzed/mastered AND (never exported, or
// dialed in again in Chain view since the last export).
function needsExport(track) {
  if (track.status !== 'needs_mastering' && track.status !== 'mastered') return false;
  if (!track.exportedAt) return true;
  return Boolean(track.previewedAt && track.previewedAt > track.exportedAt);
}

function setRowState(row, state) {
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
    statusEl.textContent = 'Rendering…';
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

function renderExportRow(track) {
  const row = document.createElement('div');
  row.className = 'export-row';

  const name = document.createElement('div');
  name.className = 'track-name';
  name.textContent = track.name;

  const target = document.createElement('div');
  target.className = 'mini-meter';
  target.textContent = targetLabel(track);

  const progressTrack = document.createElement('div');
  progressTrack.className = 'progress-track';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  progressTrack.appendChild(fill);

  const statusEl = document.createElement('div');
  statusEl.className = 'mini-meter empty export-status';

  row.append(name, target, progressTrack, statusEl);
  setRowState(row, 'queued');
  return row;
}

async function refreshExport() {
  if (isExporting) return; // don't rebuild rows out from under a running export

  const tracks = await window.slopinator.libraryList();
  exportQueue = tracks.filter(needsExport);
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
  exportQueue.forEach((track) => exportRowsEl.appendChild(renderExportRow(track)));
}

function exportOutputPath(folder, track, ext) {
  const base = track.name.replace(/\.[^.]+$/, '');
  return `${folder}/${base}_mastered.${ext}`;
}

async function runExport(folder) {
  const { bitDepth, ext } = EXPORT_FORMATS[exportFormatEl.value];
  isExporting = true;
  exportRunBtn.disabled = true;

  const rows = Array.from(exportRowsEl.children);
  let failures = 0;

  for (let i = 0; i < exportQueue.length; i++) {
    const track = exportQueue[i];
    setRowState(rows[i], 'rendering');

    const outputPath = exportOutputPath(folder, track, ext);
    const params = { ...trackExportParams(track), bitDepth };
    const result = await window.slopinator.runMaster({ inputPath: track.path, outputPath, params });

    setRowState(rows[i], result.success ? 'done' : 'failed');
    if (result.success) {
      // Deliberately not touching previewPath/previewParams/previewedAt
      // here — those are Chain view's own slot, and this track may never
      // have been opened there (using DEFAULT_EXPORT_PARAMS instead).
      // exportedAt is what the needsExport() filter checks, so without
      // this a track exported here would just get exported again, under
      // the same name, every single time this button is clicked.
      await window.slopinator.libraryUpdate(track.id, {
        status: 'mastered',
        previewPreset: presetNameForTarget(params.target),
        exportedPath: outputPath,
        exportedAt: new Date().toISOString(),
      });
    } else {
      failures++;
    }
  }

  exportCountEl.textContent = failures
    ? `Done — ${failures} of ${exportQueue.length} failed`
    : `Exported ${exportQueue.length} track${exportQueue.length === 1 ? '' : 's'} to ${folder}`;

  isExporting = false;
  exportRunBtn.disabled = false;
}

exportRunBtn.addEventListener('click', async () => {
  const folder = await window.slopinator.pickExportFolder();
  if (folder) await runExport(folder);
});

document.addEventListener('screen-activated', (e) => {
  if (e.detail.screen === 'export') refreshExport();
});
