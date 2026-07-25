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

ipcMain.handle('run-master', async (_event, { inputPath, outputPath, format }) => {
  const args = [MASTER_PY, inputPath, outputPath];
  if (format) args.push('--format', format);

  return new Promise((resolve) => {
    const proc = spawn(PYTHON_BIN, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.on('error', (err) => {
      resolve({ success: false, stdout, stderr: `${stderr}\n${err.message}` });
    });
    proc.on('close', (code) => {
      resolve({ success: code === 0, code, stdout, stderr });
    });
  });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
