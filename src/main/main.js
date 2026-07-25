const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const MASTER_PY = path.join(__dirname, '../../master.py');
const VENV_PYTHON = path.join(__dirname, '../../.venv/bin/python3');
const PYTHON_BIN = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
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
    const proc = spawn(PYTHON_BIN, ['-u', MASTER_PY, ...scriptArgs]);
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      sendLog('stdout', chunk.toString());
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
      resolve({ success: code === 0, code, stderr });
    });
  });
}

const BATCH_EXTENSIONS = ['wav', 'aiff', 'aif', 'flac'];

ipcMain.handle('run-master', async (event, { inputPath, outputPath, format }) => {
  const args = [inputPath, outputPath];
  if (format) args.push('--format', format);
  return runMasterPy(args, event.sender);
});

ipcMain.handle('classify-path', async (_event, targetPath) => {
  try {
    return fs.statSync(targetPath).isDirectory() ? 'directory' : 'file';
  } catch {
    return null;
  }
});

ipcMain.handle('run-master-batch', async (event, { dirPath, format }) => {
  const entries = fs.readdirSync(dirPath);
  const outdir = path.join(dirPath, 'mastered');

  let ranAny = false;
  let allSucceeded = true;
  let stderr = '';

  for (const ext of BATCH_EXTENSIONS) {
    const hasMatch = entries.some((f) => f.toLowerCase().endsWith(`.${ext}`));
    if (!hasMatch) continue;

    ranAny = true;
    const args = ['--batch', path.join(dirPath, `*.${ext}`), '--outdir', outdir];
    if (format) args.push('--format', format);

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
