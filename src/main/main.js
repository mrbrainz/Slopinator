const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const library = require('./library');

// Packaged builds bundle a PyInstaller-frozen master-bin binary (no system
// Python required). In dev we run master.py directly via a project-local
// .venv if present, falling back to plain python3.
let MASTER_CMD, MASTER_PREFIX_ARGS;
// Packaged macOS builds get their icon from the .icns electron-builder
// bundles into the app automatically — this is only for the dev window,
// which has no packaged bundle to draw one from.
let DEV_ICON_PATH = null;
if (app.isPackaged) {
  MASTER_CMD = path.join(process.resourcesPath, 'master-bin/master');
  MASTER_PREFIX_ARGS = [];
} else {
  const PROJECT_ROOT = path.join(__dirname, '../..');
  const MASTER_PY = path.join(PROJECT_ROOT, 'master.py');
  const VENV_PYTHON = path.join(PROJECT_ROOT, '.venv/bin/python3');
  MASTER_CMD = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';
  MASTER_PREFIX_ARGS = ['-u', MASTER_PY];
  DEV_ICON_PATH = path.join(PROJECT_ROOT, 'assets/icon.png');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 980,
    height: 720,
    icon: DEV_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

ipcMain.handle('pick-input-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['wav', 'aiff', 'aif', 'flac'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('pick-output-path', async (_event, defaultName) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'Audio', extensions: ['wav', 'aiff', 'flac'] }],
  });
  return result.canceled ? null : result.filePath;
});

function runMasterPy(scriptArgs, sender) {
  const sendLog = (stream, text) => {
    if (!sender.isDestroyed()) {
      sender.send('master-log', { stream, text });
    }
  };

  return new Promise((resolve) => {
    const proc = spawn(MASTER_CMD, [...MASTER_PREFIX_ARGS, ...scriptArgs]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      sendLog('stdout', text);
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
      sendLog('stderr', chunk.toString());
    });
    proc.on('error', (err) => {
      const message = `${err.message}\n`;
      stderr += message;
      sendLog('stderr', message);
      resolve({ success: false, stderr });
    });
    proc.on('close', (code) => {
      // Only meaningful for a single-file run — batch mode prints one such
      // line per file, so this just reflects the last one processed.
      const match = stdout.match(/Done\. Final: (-?[\d.]+) LUFS, (-?[\d.]+) dBTP/);
      resolve({
        success: code === 0,
        code,
        stderr,
        finalLufs: match ? parseFloat(match[1]) : null,
        finalTruePeakDb: match ? parseFloat(match[2]) : null,
      });
    });
  });
}

const BATCH_EXTENSIONS = ['wav', 'aiff', 'aif', 'flac'];

// Maps Chain view's rack state to master.py CLI flags. Numeric fields are
// always passed explicitly (master.py has its own defaults, but the UI's
// defaults should be the source of truth once the rack is in play);
// eq/monoBass/saturation are opt-out flags, only added when disabled.
function buildMasterArgs(params = {}) {
  const args = [];
  if (params.target != null) args.push('--target', String(params.target));
  if (params.ceiling != null) args.push('--ceiling', String(params.ceiling));
  if (params.crossover != null) args.push('--crossover', String(params.crossover));
  if (params.saturationAmount != null) args.push('--saturation', String(params.saturationAmount));
  if (params.eq === false) args.push('--no-eq');
  if (params.monoBass === false) args.push('--no-mono-bass');
  if (params.saturation === false) args.push('--no-saturation');
  return args;
}

ipcMain.handle('run-master', async (event, { inputPath, outputPath, params }) => {
  const args = [inputPath, outputPath, ...buildMasterArgs(params)];
  return runMasterPy(args, event.sender);
});

ipcMain.handle('classify-path', async (_event, targetPath) => {
  try {
    return fs.statSync(targetPath).isDirectory() ? 'directory' : 'file';
  } catch {
    return null;
  }
});

ipcMain.handle('run-master-batch', async (event, { dirPath, params }) => {
  const entries = fs.readdirSync(dirPath);
  const outdir = path.join(dirPath, 'mastered');

  let ranAny = false;
  let allSucceeded = true;
  let stderr = '';

  for (const ext of BATCH_EXTENSIONS) {
    const hasMatch = entries.some((f) => f.toLowerCase().endsWith(`.${ext}`));
    if (!hasMatch) continue;

    ranAny = true;
    const args = ['--batch', path.join(dirPath, `*.${ext}`), '--outdir', outdir, ...buildMasterArgs(params)];

    const result = await runMasterPy(args, event.sender);
    if (!result.success) {
      allSucceeded = false;
      stderr += result.stderr;
    }
  }

  if (!ranAny) {
    return { success: false, stderr: 'No audio files (wav/aiff/flac) found in that folder.' };
  }
  return { success: allSucceeded, stderr, outdir };
});

function runMasterJson(scriptArgs) {
  return new Promise((resolve) => {
    const proc = spawn(MASTER_CMD, [...MASTER_PREFIX_ARGS, ...scriptArgs]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.on('error', (err) => resolve({ success: false, error: err.message }));
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: stderr.trim() || `exit ${code}` });
        return;
      }
      try {
        resolve({ success: true, data: JSON.parse(stdout.trim()) });
      } catch (err) {
        resolve({ success: false, error: `failed to parse output: ${err.message}` });
      }
    });
  });
}

const userDataDir = () => app.getPath('userData');

ipcMain.handle('library-list', () => library.loadLibrary(userDataDir()));
ipcMain.handle('library-add', (_event, filePath) => library.addTrack(userDataDir(), filePath));
ipcMain.handle('library-update', (_event, { id, patch }) => library.updateTrack(userDataDir(), id, patch));
ipcMain.handle('library-remove', (_event, id) => library.removeTrack(userDataDir(), id));

ipcMain.handle('library-analyze', async (_event, id) => {
  const track = library.loadLibrary(userDataDir()).find((t) => t.id === id);
  if (!track) return { success: false, error: 'track not found' };

  const result = await runMasterJson(['--analyze', track.path]);
  if (!result.success) return result;

  const { duration_sec, sample_rate, channels, bit_depth, lufs, true_peak_db } = result.data;
  const tracks = library.updateTrack(userDataDir(), id, {
    durationSec: duration_sec,
    sampleRate: sample_rate,
    channels,
    bitDepth: bit_depth,
    lufs,
    truePeakDb: true_peak_db,
    status: 'needs_mastering',
  });
  return { success: true, tracks };
});

ipcMain.handle('get-peaks', async (_event, { filePath, buckets }) => {
  const args = ['--peaks', filePath];
  if (buckets) args.push('--buckets', String(buckets));
  return runMasterJson(args);
});

function expandAudioPaths(paths) {
  const files = [];
  for (const p of paths) {
    let isDir = false;
    try {
      isDir = fs.statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      for (const entry of fs.readdirSync(p)) {
        const ext = path.extname(entry).slice(1).toLowerCase();
        if (BATCH_EXTENSIONS.includes(ext)) files.push(path.join(p, entry));
      }
    } else {
      files.push(p);
    }
  }
  return files;
}

ipcMain.handle('pick-import-files', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: BATCH_EXTENSIONS }],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('library-import', async (_event, paths) => {
  const dir = userDataDir();
  let tracks = library.loadLibrary(dir);

  for (const filePath of expandAudioPaths(paths)) {
    tracks = library.addTrack(dir, filePath);
  }

  for (const track of tracks.filter((t) => t.status === 'raw')) {
    const result = await runMasterJson(['--analyze', track.path]);
    if (!result.success) continue;
    const { duration_sec, sample_rate, channels, bit_depth, lufs, true_peak_db } = result.data;
    tracks = library.updateTrack(dir, track.id, {
      durationSec: duration_sec,
      sampleRate: sample_rate,
      channels,
      bitDepth: bit_depth,
      lufs,
      truePeakDb: true_peak_db,
      status: 'needs_mastering',
    });
  }

  return tracks;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
