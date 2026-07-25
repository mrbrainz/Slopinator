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

ipcMain.handle('run-master', async (event, { inputPath, outputPath, format }) => {
  const args = ['-u', MASTER_PY, inputPath, outputPath];
  if (format) args.push('--format', format);

  const sendLog = (stream, text) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('master-log', { stream, text });
    }
  };

  return new Promise((resolve) => {
    const proc = spawn(PYTHON_BIN, args);
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
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
