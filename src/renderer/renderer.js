document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

const inputPathEl = document.getElementById('input-path');
const outputPathEl = document.getElementById('output-path');
const formatEl = document.getElementById('format');
const masterBtn = document.getElementById('master-btn');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');

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

async function runWithLogging(runFn, onDone) {
  masterBtn.disabled = true;
  logEl.textContent = '';

  const unsubscribe = window.slopinator.onMasterLog(({ text }) => {
    logEl.textContent += text;
    logEl.scrollTop = logEl.scrollHeight;
  });

  const result = await runFn();
  unsubscribe();
  onDone(result);
  updateMasterButton();
}

masterBtn.addEventListener('click', () => {
  statusEl.textContent = 'Mastering…';
  runWithLogging(
    () => window.slopinator.runMaster({ inputPath, outputPath, format: formatEl.value }),
    (result) => {
      statusEl.textContent = result.success
        ? `Done: ${outputPath}`
        : `Failed (exit ${result.code}): ${result.stderr.trim() || 'unknown error'}`;
    }
  );
});

const dropZone = document.getElementById('drop-zone');

['dragenter', 'dragover'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  })
);

['dragleave', 'drop'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  })
);

dropZone.addEventListener('drop', async (e) => {
  const dropped = e.dataTransfer.files[0];
  if (!dropped) return;
  const droppedPath = dropped.path;

  const kind = await window.slopinator.classifyPath(droppedPath);
  if (kind === 'directory') {
    statusEl.textContent = `Mastering folder: ${droppedPath}…`;
    runWithLogging(
      () => window.slopinator.runMasterBatch({ dirPath: droppedPath, format: formatEl.value }),
      (result) => {
        statusEl.textContent = result.success
          ? `Done: ${result.outdir}`
          : `Failed: ${result.stderr.trim() || 'unknown error'}`;
      }
    );
  } else if (kind === 'file') {
    inputPath = droppedPath;
    inputPathEl.value = inputPath;
    updateMasterButton();
  }
});
