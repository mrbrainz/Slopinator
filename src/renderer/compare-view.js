// Compare screen: real before/after stats and A/B listen buttons for
// whatever track is currently loaded in Chain view, once it's been
// mastered. Refreshes whenever this tab becomes active (see renderer.js's
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
let masteredPath = null;

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
      await window.player.load(path);
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
listenAfterBtn.addEventListener('click', () => toggleListen(masteredPath, listenAfterBtn, 'mastered'));

window.player.onEnded(() => {
  const current = window.player.getCurrentPath();
  if (current === originalPath || current === masteredPath) resetListenButtons();
});

adjustBtn.addEventListener('click', () => activateTab('chain'));
exportBtn.addEventListener('click', () => activateTab('export'));

function showEmpty(message) {
  compareEmptyEl.textContent = message;
  compareEmptyEl.style.display = '';
  compareContentEl.style.display = 'none';
  compareTrackNameEl.textContent = 'Compare';
}

async function refreshCompare() {
  const current = window.getCurrentChainTrack ? window.getCurrentChainTrack() : {};
  if (!current.trackId || !current.path) {
    showEmpty('Select a track from your Library and master it in Chain view first, then come back here to compare.');
    return;
  }

  const tracks = await window.slopinator.libraryList();
  const track = tracks.find((t) => t.id === current.trackId);
  if (!track || track.status !== 'mastered' || !track.masteredPath) {
    const name = track ? track.name : current.path.split('/').pop();
    showEmpty(`"${name}" hasn't been mastered yet — do that in Chain view first.`);
    return;
  }

  compareEmptyEl.style.display = 'none';
  compareContentEl.style.display = '';
  compareTrackNameEl.textContent = `${track.name} — before / after`;

  originalPath = track.path;
  masteredPath = track.masteredPath;
  resetListenButtons();

  beforeLufsEl.textContent = track.lufs != null ? `${track.lufs.toFixed(1)} LUFS` : '—';
  beforePeakEl.textContent = track.truePeakDb != null ? `${track.truePeakDb.toFixed(2)} dBTP` : '—';
  afterLufsEl.textContent = track.masteredLufs != null ? `${track.masteredLufs.toFixed(1)} LUFS` : '—';
  afterPeakEl.textContent = track.masteredTruePeakDb != null ? `${track.masteredTruePeakDb.toFixed(2)} dBTP` : '—';

  const monoBassUsed = track.masteredParams && track.masteredParams.monoBass;
  afterBassEl.textContent = monoBassUsed ? `mono below ${track.masteredParams.crossover}Hz` : 'unlinked';

  await Promise.all([renderCompareWave(waveBeforeEl, track.path), renderCompareWave(waveAfterEl, track.masteredPath)]);
}

document.addEventListener('screen-activated', (e) => {
  if (e.detail.screen === 'compare') refreshCompare();
});
