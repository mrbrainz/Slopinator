// Compare screen: real before/after stats and A/B listen buttons for
// whatever track is currently loaded in Chain view, once it has a real
// preview (track.previewPath — see docs/context.md's "Preview vs
// export" section). Previews are regenerable, not authoritative, so a
// missing one (cleaned up by the startup GC sweep, or just never
// rendered) gets silently rebuilt from previewParams rather than erroring.
// Refreshes whenever this tab becomes active (see renderer.js's
// 'screen-activated' event) rather than tracking its own selection.

const compareTrackNameEl = document.getElementById('compare-track-name');
const compareEmptyEl = document.getElementById('compare-empty');
const compareContentEl = document.getElementById('compare-content');
const beforeLufsEl = document.getElementById('compare-before-lufs');
const beforePeakEl = document.getElementById('compare-before-peak');
const afterLufsEl = document.getElementById('compare-after-lufs');
const afterPeakEl = document.getElementById('compare-after-peak');
const afterBassEl = document.getElementById('compare-after-bass');
const waveBeforeEl = document.getElementById('compare-wave-before');
const waveAfterEl = document.getElementById('compare-wave-after');
const listenBeforeBtn = document.getElementById('compare-listen-before');
const listenAfterBtn = document.getElementById('compare-listen-after');
const adjustBtn = document.getElementById('compare-adjust-btn');
const exportBtn = document.getElementById('compare-export-btn');

let originalPath = null;
let previewPath = null;

async function renderCompareWave(container, path) {
  container.innerHTML = '';
  const result = await window.slopinator.getPeaks(path, 60);
  if (!result.success) return;
  result.data.peaks.forEach((peak) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = `${6 + peak * 48}px`;
    container.appendChild(bar);
  });
}

function resetListenButtons() {
  listenBeforeBtn.textContent = '▶ Listen to original';
  listenAfterBtn.textContent = '▶ Listen to mastered';
}

async function toggleListen(path, btn, label) {
  try {
    if (window.player.getCurrentPath() !== path) {
      resetListenButtons();
      // Force reload: the preview lives at a reused path, so "already
      // loaded" from a previous visit could actually be stale content
      // from before a re-master.
      await window.player.load(path, true);
      await window.player.play();
    } else if (window.player.isPlaying()) {
      window.player.pause();
    } else {
      await window.player.play();
    }
  } catch {
    btn.textContent = 'Unable to play — file not found';
    return;
  }
  btn.textContent =
    window.player.getCurrentPath() === path && window.player.isPlaying()
      ? `❚❚ Pause ${label}`
      : `▶ Listen to ${label}`;
}

listenBeforeBtn.addEventListener('click', () => toggleListen(originalPath, listenBeforeBtn, 'original'));
listenAfterBtn.addEventListener('click', () => toggleListen(previewPath, listenAfterBtn, 'mastered'));

async function seekTo(path, fraction, btn, label) {
  if (!path) return;
  try {
    if (window.player.getCurrentPath() !== path) {
      resetListenButtons();
      // Force reload for the same reason toggleListen does — the preview's
      // path is reused, so "already loaded" could be stale content.
      await window.player.load(path, true);
      window.player.seekToFraction(fraction);
      await window.player.play();
    } else {
      window.player.seekToFraction(fraction);
      if (!window.player.isPlaying()) await window.player.play();
    }
  } catch {
    btn.textContent = 'Unable to play — file not found';
    return;
  }
  btn.textContent = `❚❚ Pause ${label}`;
}

function waveformClickFraction(container, clientX) {
  const rect = container.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

waveBeforeEl.addEventListener('click', (e) =>
  seekTo(originalPath, waveformClickFraction(waveBeforeEl, e.clientX), listenBeforeBtn, 'original')
);
waveAfterEl.addEventListener('click', (e) =>
  seekTo(previewPath, waveformClickFraction(waveAfterEl, e.clientX), listenAfterBtn, 'mastered')
);

window.player.onEnded(() => {
  const current = window.player.getCurrentPath();
  if (current === originalPath || current === previewPath) resetListenButtons();
});

adjustBtn.addEventListener('click', () => activateTab('chain'));
exportBtn.addEventListener('click', () => activateTab('export'));

function showEmpty(message) {
  compareEmptyEl.textContent = message;
  compareEmptyEl.style.display = '';
  compareContentEl.style.display = 'none';
  compareTrackNameEl.textContent = 'Compare';
}

// Compare needs a real preview file to A/B against — a track can be
// status 'mastered' with no previewPath at all (exported straight from
// the Export screen's defaults, never opened in Chain view). That's a
// legitimate state, just not one Compare can do anything with, so it
// gets its own honest message rather than pretending there's a preview.
async function regeneratePreviewIfMissing(track) {
  const exists = (await window.slopinator.classifyPath(track.previewPath)) === 'file';
  if (exists) return track;

  const result = await window.slopinator.runMaster({
    inputPath: track.path,
    outputPath: track.previewPath,
    params: track.previewParams,
  });
  if (!result.success) return track;

  const tracks = await window.slopinator.libraryUpdate(track.id, {
    previewLufs: result.finalLufs,
    previewTruePeakDb: result.finalTruePeakDb,
    previewedAt: new Date().toISOString(),
  });
  return tracks.find((t) => t.id === track.id) || track;
}

async function refreshCompare() {
  const current = window.getCurrentChainTrack ? window.getCurrentChainTrack() : {};
  if (!current.trackId || !current.path) {
    showEmpty('Select a track from your Library and master it in Chain view first, then come back here to compare.');
    return;
  }

  const tracks = await window.slopinator.libraryList();
  let track = tracks.find((t) => t.id === current.trackId);
  if (!track || !track.previewPath) {
    const name = track ? track.name : current.path.split('/').pop();
    const message =
      track && track.status === 'mastered'
        ? `"${name}" was exported directly without a Chain view preview — open it there to compare before/after.`
        : `"${name}" hasn't been mastered yet — do that in Chain view first.`;
    showEmpty(message);
    return;
  }

  track = await regeneratePreviewIfMissing(track);

  compareEmptyEl.style.display = 'none';
  compareContentEl.style.display = '';
  compareTrackNameEl.textContent = `${track.name} — before / after`;

  originalPath = track.path;
  previewPath = track.previewPath;
  resetListenButtons();

  beforeLufsEl.textContent = track.lufs != null ? `${track.lufs.toFixed(1)} LUFS` : '—';
  beforePeakEl.textContent = track.truePeakDb != null ? `${track.truePeakDb.toFixed(2)} dBTP` : '—';
  afterLufsEl.textContent = track.previewLufs != null ? `${track.previewLufs.toFixed(1)} LUFS` : '—';
  afterPeakEl.textContent = track.previewTruePeakDb != null ? `${track.previewTruePeakDb.toFixed(2)} dBTP` : '—';

  const monoBassUsed = track.previewParams && track.previewParams.monoBass;
  afterBassEl.textContent = monoBassUsed ? `mono below ${track.previewParams.crossover}Hz` : 'unlinked';

  await Promise.all([renderCompareWave(waveBeforeEl, track.path), renderCompareWave(waveAfterEl, track.previewPath)]);
}

document.addEventListener('screen-activated', (e) => {
  if (e.detail.screen === 'compare') refreshCompare();
});
