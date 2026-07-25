const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slopinator', {
  version: process.env.npm_package_version,
  pickInputFile: () => ipcRenderer.invoke('pick-input-file'),
  pickOutputPath: (defaultName) => ipcRenderer.invoke('pick-output-path', defaultName),
  runMaster: (args) => ipcRenderer.invoke('run-master', args),
  onMasterLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('master-log', listener);
    return () => ipcRenderer.removeListener('master-log', listener);
  },
});
