// Thin wrapper around a single shared <audio> element for playing local
// files by path. No UI here — Chain view / Compare wire buttons to this
// later (docs/todos.md).

const audioEl = new Audio();
let currentPath = null;
// Which screen last initiated playback/seek on the shared element (e.g.
// 'chain', 'compare-before', 'compare-after') — Chain view's inputPath and
// Compare's originalPath are frequently the exact same file, so path
// equality alone can't tell two screens' now-playing state apart; callers
// use this to scope their own progress UI to actions *they* initiated.
let currentOwner = null;

function toFileUrl(filePath) {
  // Windows paths use backslashes and a drive letter (C:\Users\...) — neither
  // survives a POSIX-style file URL as-is. Normalize to forward slashes and
  // add the leading slash a drive-letter path needs (file:///C:/Users/...);
  // POSIX paths already start with one.
  let p = filePath.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(p)) p = '/' + p;
  // Encode each path segment (spaces, #, ? etc. would otherwise break the
  // URL or get misparsed) while keeping the slashes that separate them and
  // leaving a drive-letter segment un-encoded — encodeURIComponent would
  // turn ':' into '%3A', which Chromium won't resolve back to a drive path.
  return 'file://' + p.split('/').map((seg, i) => (
    i === 1 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)
  )).join('/');
}

function load(filePath, force = false) {
  return new Promise((resolve, reject) => {
    // Preview/export files live at a fixed, reused path per track — the
    // same URL can point at genuinely different bytes after a re-master,
    // so callers that know the content may have changed since the last
    // load (Chain view after mastering, Compare before A/B) pass
    // force=true to skip this dedup and always reload from disk.
    if (!force && currentPath === filePath && audioEl.readyState >= 1) {
      resolve(audioEl.duration);
      return;
    }
    currentPath = filePath;
    audioEl.src = toFileUrl(filePath);

    const cleanup = () => {
      audioEl.removeEventListener('loadedmetadata', onLoaded);
      audioEl.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve(audioEl.duration);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`failed to load audio: ${filePath}`));
    };
    audioEl.addEventListener('loadedmetadata', onLoaded);
    audioEl.addEventListener('error', onError);
  });
}

function play() {
  return audioEl.play();
}

function pause() {
  audioEl.pause();
}

function toggle() {
  if (audioEl.paused) return play();
  pause();
  return Promise.resolve();
}

function seekToFraction(fraction) {
  if (!isFinite(audioEl.duration) || audioEl.duration <= 0) return;
  audioEl.currentTime = Math.max(0, Math.min(1, fraction)) * audioEl.duration;
}

function isPlaying() {
  return !audioEl.paused && !audioEl.ended;
}

function getCurrentTime() {
  return audioEl.currentTime;
}

function setOwner(owner) {
  currentOwner = owner;
}

function getCurrentOwner() {
  return currentOwner;
}

// The audio element is a single shared singleton across views (Chain view,
// Compare, ...) — callers should check this against the path they expect
// to be playing before reacting to onTimeUpdate/onEnded, since another
// view may have loaded something else in the meantime.
function getCurrentPath() {
  return currentPath;
}

function onTimeUpdate(callback) {
  const handler = () => {
    if (!isFinite(audioEl.duration) || audioEl.duration <= 0) return;
    callback(audioEl.currentTime / audioEl.duration);
  };
  audioEl.addEventListener('timeupdate', handler);
  return () => audioEl.removeEventListener('timeupdate', handler);
}

function onEnded(callback) {
  audioEl.addEventListener('ended', callback);
  return () => audioEl.removeEventListener('ended', callback);
}

window.player = {
  load,
  play,
  pause,
  toggle,
  seekToFraction,
  isPlaying,
  onTimeUpdate,
  onEnded,
  getCurrentPath,
  getCurrentTime,
  setOwner,
  getCurrentOwner,
};
