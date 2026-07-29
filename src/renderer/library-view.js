// Library screen: import/drag-drop tracks, render status rows, click a
// row to open that track in Chain view. Talks to the library-* IPC
// handlers in src/main/library.js via window.slopinator.

const libraryListEl = document.getElementById('library-list');
const libraryCountEl = document.getElementById('library-count');
const libraryDropZone = document.getElementById('library-drop-zone');
const libraryImportBtn = document.getElementById('library-import-btn');

function fileBaseName(filePath) {
  return filePath.split(/[\\/]/).pop();
}

function throbber() {
  const el = document.createElement('div');
  el.className = 'throbber';
  return el;
}

// A file being imported/analyzed shows the same row shape as a real
// track (so it doesn't jump around in the grid once it resolves), just
// with a spinner in every field we don't know yet — only the name is
// real from the start, since that's all a dropped path gives us before
// library-import's main-process round trip even begins.
function renderSkeletonRow(filePath) {
  const row = document.createElement('div');
  row.className = 'track-row skeleton';

  const dotEl = document.createElement('div');
  dotEl.className = 'status-dot importing';

  const nameWrap = document.createElement('div');
  const nameEl = document.createElement('div');
  nameEl.className = 'track-name';
  nameEl.textContent = fileBaseName(filePath);
  const subEl = document.createElement('div');
  subEl.className = 'track-sub';
  subEl.textContent = 'Importing…';
  nameWrap.append(nameEl, subEl);

  const tagWrap = document.createElement('div');
  const tagEl = document.createElement('span');
  tagEl.className = 'tag';
  tagEl.textContent = 'Please wait…';
  tagWrap.appendChild(tagEl);

  row.append(dotEl, nameWrap, throbber(), tagWrap, throbber(), document.createElement('div'));
  return row;
}

function formatDuration(sec) {
  if (sec == null) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function statusMeta(track, missing) {
  if (missing) {
    return { dot: 'missing', tag: 'file missing' };
  }
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

function renderRow(track, missing, selected) {
  const { dot, tag } = statusMeta(track, missing);
  const warn = track.status === 'needs_mastering';

  const row = document.createElement('div');
  row.className = 'track-row' + (missing ? ' missing' : '') + (selected ? ' selected' : '');

  const dotEl = document.createElement('div');
  dotEl.className = `status-dot ${dot}`;

  const nameWrap = document.createElement('div');
  const nameEl = document.createElement('div');
  nameEl.className = 'track-name';
  nameEl.textContent = track.name;
  const subEl = document.createElement('div');
  subEl.className = 'track-sub';
  subEl.textContent = missing
    ? `Not found at ${track.path}`
    : [formatDuration(track.durationSec), new Date(track.addedAt).toLocaleDateString()].filter(Boolean).join(' · ');
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
    // Removing a track deletes its library entry (and preview file), but
    // the source audio on disk is untouched — so Chain view's own
    // missing-file check (classifyPath) would find it fine and keep
    // showing its now-stale mastered details with no idea the library
    // entry is gone. Tell it directly.
    document.dispatchEvent(new CustomEvent('track-removed', { detail: { id: track.id } }));
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
  const missingFlags = await Promise.all(tracks.map((t) => window.slopinator.classifyPath(t.path).then((kind) => kind === null)));

  // library.js's addTrack() pushes to the end, so `tracks` comes back
  // oldest-first — sort newest-first for display, so a new import lands
  // at the top instead of the bottom. Stable sort (spec'd since ES2019,
  // which every V8 this app ships on satisfies) means two tracks added
  // in the exact same millisecond keep their original relative (drop)
  // order rather than an arbitrary one.
  const rows = tracks.map((track, i) => ({ track, missing: missingFlags[i] }));
  rows.sort((a, b) => new Date(b.track.addedAt) - new Date(a.track.addedAt));

  const chainTrackId = window.getCurrentChainTrack ? window.getCurrentChainTrack().trackId : null;

  libraryListEl.innerHTML = '';
  rows.forEach(({ track, missing }) => libraryListEl.appendChild(renderRow(track, missing, track.id === chainTrackId)));

  const needsCount = tracks.filter((t) => t.status === 'needs_mastering').length;
  const missingCount = missingFlags.filter(Boolean).length;
  libraryCountEl.textContent =
    `${tracks.length} track${tracks.length === 1 ? '' : 's'}` +
    (needsCount ? ` · ${needsCount} need${needsCount === 1 ? 's' : ''} mastering` : '') +
    (missingCount ? ` · ${missingCount} missing` : '');

  // Chain view starts empty until a track is picked — if nothing's loaded
  // there yet (including right after the currently-loaded track was just
  // removed, see the 'track-removed' listener in chain-view.js), silently
  // load the top-of-list track into it so it's not sitting blank the
  // first time the user switches over. Doesn't switch tabs — only an
  // explicit Library row click (selectChainInputAndNavigate) does that.
  if (rows.length && window.selectChainInput && !chainTrackId) {
    window.selectChainInput(rows[0].track.path, rows[0].track.id);
  }
}

// path -> its skeleton row element, for the current in-flight import only.
const skeletonRows = new Map();

async function importPaths(paths) {
  if (!paths.length) return;
  paths.forEach((filePath) => {
    const row = renderSkeletonRow(filePath);
    skeletonRows.set(filePath, row);
    libraryListEl.prepend(row);
  });

  await window.slopinator.libraryImport(paths);
  // Any of this call's own skeletons still in the map belong to a path
  // library-import-progress never matched 1:1 (a dropped folder gets
  // expanded into per-file paths on the main-process side, so the
  // folder's own skeleton never resolves) — refreshLibrary's full
  // re-render clears the leftover DOM node; only delete this call's own
  // keys here so an overlapping second import in flight isn't affected.
  paths.forEach((filePath) => skeletonRows.delete(filePath));
  await refreshLibrary();
}

window.slopinator.onLibraryImportProgress(({ path: filePath, track }) => {
  const skeleton = skeletonRows.get(filePath);
  if (!skeleton || !skeleton.isConnected) return;

  if (track.status === 'raw') {
    // Added to the library, not analyzed yet — keep the skeleton up but
    // reflect the actual stage instead of a generic "please wait".
    const sub = skeleton.querySelector('.track-sub');
    if (sub) sub.textContent = 'Analyzing…';
    return;
  }

  skeleton.replaceWith(renderRow(track, false));
  skeletonRows.delete(filePath);
});

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
    .map((f) => window.slopinator.getPathForFile(f))
    .filter(Boolean);
  importPaths(paths);
});

document.addEventListener('screen-activated', (e) => {
  if (e.detail.screen === 'library') refreshLibrary();
});

refreshLibrary();
