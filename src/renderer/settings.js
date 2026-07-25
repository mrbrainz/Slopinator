// Settings menu (gear in the titlebar). One setting so far: UI mode,
// "normal" (docs/design/mockup.html) or "cringe"
// (docs/design/mockup-cringe.html). Cringe mode is purely cosmetic: a
// `cringe` class on <body> that cringe.css restyles, plus meme copy
// swaps, a marquee, and confetti — the DOM structure and all logic are
// untouched, so every screen keeps working identically. Persisted in
// localStorage.

const MODE_KEY = 'slopinator-ui-mode';

const settingsBtn = document.getElementById('settings-btn');
const settingsMenu = document.getElementById('settings-menu');
const modeNormalBtn = document.getElementById('mode-normal');
const modeCringeBtn = document.getElementById('mode-cringe');

// Static labels swapped in cringe mode. Anything with dynamic text
// (status lines, counts, track names, listen buttons) is left alone.
const CRINGE_COPY = [
  ['.tab[data-screen="library"]', 'LIBRARY'],
  ['.tab[data-screen="chain"]', 'CHAIN GO BRRR'],
  ['.tab[data-screen="compare"]', 'BEFORE VS AFTER'],
  ['.tab[data-screen="export"]', 'YEET TO EXPORT'],
  ['.lib-header h1', 'yOuR tRaCkS'],
  ['#library-import-btn', "+ IMPORT (let's gooo)"],
  ['#library-drop-zone', 'drag ur WAV here or it stays mid forever'],
  ['#drop-zone', 'drop a folder here and watch every track get cooked'],
  ['#master-btn', 'MAKE IT SLAP'],
  ['.meter-panel h4', 'VIBE METER'],
  ['#preset-save-btn', "save (it's fire)"],
  ['#export-run-btn', 'yeet to folder…'],
  ['.caption', 'signal chain go brrr — what you see is what runs (no cap)'],
];

function applyCringeCopy(on) {
  CRINGE_COPY.forEach(([selector, cringeText]) => {
    const el = document.querySelector(selector);
    if (!el) return;
    if (on) {
      if (el.dataset.normalHtml == null) el.dataset.normalHtml = el.innerHTML;
      el.textContent = cringeText;
    } else if (el.dataset.normalHtml != null) {
      el.innerHTML = el.dataset.normalHtml;
    }
  });
}

const CONFETTI_CHARS = ['*', '!', '~', '^', '#', '+'];
const CONFETTI_COLORS = ['#ff2fb5', '#25e9ff', '#ffe600', '#c6ff1f', '#9b30ff'];

function setConfetti(on) {
  let holder = document.getElementById('confetti-holder');
  if (!on) {
    if (holder) holder.remove();
    return;
  }
  if (holder) return;
  holder = document.createElement('div');
  holder.id = 'confetti-holder';
  for (let i = 0; i < 22; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.textContent = CONFETTI_CHARS[Math.floor(Math.random() * CONFETTI_CHARS.length)];
    c.style.left = `${Math.random() * 100}vw`;
    c.style.color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    c.style.animationDuration = `${4 + Math.random() * 5}s`;
    c.style.animationDelay = `${Math.random() * 5}s`;
    holder.appendChild(c);
  }
  document.body.appendChild(holder);
}

function applyMode(mode) {
  const cringe = mode === 'cringe';
  document.body.classList.toggle('cringe', cringe);
  applyCringeCopy(cringe);
  setConfetti(cringe);
  modeNormalBtn.classList.toggle('on', !cringe);
  modeCringeBtn.classList.toggle('on', cringe);
  localStorage.setItem(MODE_KEY, cringe ? 'cringe' : 'normal');
}

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsMenu.hidden = !settingsMenu.hidden;
});
settingsMenu.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => {
  settingsMenu.hidden = true;
});

modeNormalBtn.addEventListener('click', () => applyMode('normal'));
modeCringeBtn.addEventListener('click', () => applyMode('cringe'));

applyMode(localStorage.getItem(MODE_KEY) === 'cringe' ? 'cringe' : 'normal');
