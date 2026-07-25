const inputPathEl = document.getElementById('input-path');
const outputPathEl = document.getElementById('output-path');
const formatEl = document.getElementById('format');
const masterBtn = document.getElementById('master-btn');
const statusEl = document.getElementById('status');

let inputPath = null;
let outputPath = null;

function updateMasterButton() {
  masterBtn.disabled = !(inputPath && outputPath);
}

function defaultOutputName(path) {
  const base = path.split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot === -1 ? `${base}-mastered` : `${base.slice(0, dot)}-mastered${base.slice(dot)}`;
}

document.getElementById('pick-input').addEventListener('click', async () => {
  const picked = await window.slopinator.pickInputFile();
  if (!picked) return;
  inputPath = picked;
  inputPathEl.value = inputPath;
  updateMasterButton();
});

document.getElementById('pick-output').addEventListener('click', async () => {
  const defaultName = inputPath ? defaultOutputName(inputPath) : 'mastered.wav';
  const picked = await window.slopinator.pickOutputPath(defaultName);
  if (!picked) return;
  outputPath = picked;
  outputPathEl.value = outputPath;
  updateMasterButton();
});

masterBtn.addEventListener('click', () => {
  statusEl.textContent = `Would master "${inputPath}" -> "${outputPath}" (preset: ${formatEl.value}). Wiring to master.py is next.`;
});
