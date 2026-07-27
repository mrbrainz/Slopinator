// Library screen: import/drag-drop tracks, render status rows, click a
// row to open that track in Chain view. Talks to the library-* IPC
// handlers in src/main/library.js via window.slopinator.

const libraryListEl = document.getElementById('library-list');
const libraryCountEl = document.getElementById('library-count');
const libraryDropZone = document.getElementById('library-drop-zone');
const libraryImportBtn = document.getElementById('library-import-btn');

function formatDuration(sec) {
  if (sec == null) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function statusMeta(track) {
  if (track.status === 'mastered') {
    return { dot: 'done', tag: `mastered · ${track.previewPreset || 'custom'}` };
  }
  if (track.status === 'needs_mastering') {
    return { dot: 'needs', tag: 'needs mastering' };
  }
  return { dot: 'raw', tag: 'raw import' };
}

function meterEl(value, unit, warn) {
  const el = document.createElement('div');
  if (value == null) {
    el.className = 'mini-meter empty';
    el.textContent = '—';
  } else {
    el.className = 'mini-meter' + (warn ? ' warn' : '');
    el.textContent = `${value.toFixed(1)} ${unit}`;
  }
  return el;
}

function renderRow(track) {
  const { dot, tag } = statusMeta(track);
  const warn = track.status === 'needs_mastering';

  const row = document.createElement('div');
  row.className = 'track-row';

  const dotEl = document.createElement('div');
  dotEl.className = `status-dot ${dot}`;

  const nameWrap = document.createElement('div');
  const nameEl = document.createElement('div');
  nameEl.className = 'track-name';
  nameEl.textContent = track.name;
  const subEl = document.createElement('div');
  subEl.className = 'track-sub';
  subEl.textContent = [formatDuration(track.durationSec), new Date(track.addedAt).toLocaleDateString()]
    .filter(Boolean)
    .join(' · ');
  nameWrap.append(nameEl, subEl);

  const tagWrap = document.createElement('div');
  const tagEl = document.createElement('span');
  tagEl.className = 'tag';
  tagEl.textContent = tag;
  tagWrap.appendChild(tagEl);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'row-remove-btn';
  removeBtn.title = 'Remove from library';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Remove "${track.name}" from your library? This won't delete the original file.`)) return;
    await window.slopinator.libraryRemove(track.id);
    await refreshLibrary();
  });

  row.append(
    dotEl,
    nameWrap,
    meterEl(track.lufs, 'LUFS', warn),
    tagWrap,
    meterEl(track.truePeakDb, 'dBTP', warn),
    removeBtn
  );

  row.addEventListener('click', () => {
    if (window.selectChainInputAndNavigate) window.selectChainInputAndNavigate(track.path, track.id);
  });

  return row;
}

async function refreshLibrary() {
  const tracks = await window.slopinator.libraryList();
  libraryListEl.innerHTML = '';
  tracks.forEach((track) => libraryListEl.appendChild(renderRow(track)));

  const needsCount = tracks.filter((t) => t.status === 'needs_mastering').length;
  libraryCountEl.textContent =
    `${tracks.length} track${tracks.length === 1 ? '' : 's'}` +
    (needsCount ? ` · ${needsCount} need${needsCount === 1 ? 's' : ''} mastering` : '');
}

async function importPaths(paths) {
  if (!paths.length) return;
  libraryCountEl.textContent = 'Importing…';
  await window.slopinator.libraryImport(paths);
  await refreshLibrary();
}

libraryImportBtn.addEventListener('click', async () => {
  const picked = await window.slopinator.pickImportFiles();
  if (picked && picked.length) await importPaths(picked);
});

['dragenter', 'dragover'].forEach((evt) =>
  libraryDropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    libraryDropZone.classList.add('drag-over');
  })
);

['dragleave', 'drop'].forEach((evt) =>
  libraryDropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    libraryDropZone.classList.remove('drag-over');
  })
);

libraryDropZone.addEventListener('drop', (e) => {
  const paths = Array.from(e.dataTransfer.files)
    .map((f) => f.path)
    .filter(Boolean);
  importPaths(paths);
});

document.addEventListener('screen-activated', (e) => {
  if (e.detail.screen === 'library') refreshLibrary();
});

refreshLibrary();
