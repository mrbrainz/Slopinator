// Export screen: batch-export every analyzed library track to a chosen
// folder. Each track re-runs master.py with the exact params it was
// mastered with in Chain view (masteredParams), falling back to the
// rack's current settings for tracks never mastered there. Progress is
// stepped (queued / rendering / done) — master.py reports nothing
// mid-file, so there's no honest percentage to show (docs/todos.md).

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

let exportQueue = [];
let isExporting = false;

function trackExportParams(track) {
  return track.masteredParams || (window.getChainParams ? window.getChainParams() : {});
}

function targetLabel(track) {
  const target = trackExportParams(track).target ?? -14;
  const preset = EXPORT_PRESETS[String(target)];
  return `${target} LUFS${preset ? ` ${preset}` : ''}`;
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
  exportQueue = tracks.filter((t) => t.status === 'needs_mastering' || t.status === 'mastered');

  exportCountEl.textContent = `${exportQueue.length} track${exportQueue.length === 1 ? '' : 's'} queued`;
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

    const result = await window.slopinator.runMaster({
      inputPath: track.path,
      outputPath: exportOutputPath(folder, track, ext),
      params: { ...trackExportParams(track), bitDepth },
    });

    setRowState(rows[i], result.success ? 'done' : 'failed');
    if (!result.success) failures++;
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
