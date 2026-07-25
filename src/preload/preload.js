const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slopinator', {
  version: process.env.npm_package_version,
  pickInputFile: () => ipcRenderer.invoke('pick-input-file'),
  pickOutputPath: (defaultName) => ipcRenderer.invoke('pick-output-path', defaultName),
  runMaster: (args) => ipcRenderer.invoke('run-master', args),
  runMasterBatch: (args) => ipcRenderer.invoke('run-master-batch', args),
  classifyPath: (path) => ipcRenderer.invoke('classify-path', path),
  onMasterLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('master-log', listener);
    return () => ipcRenderer.removeListener('master-log', listener);
  },
});
