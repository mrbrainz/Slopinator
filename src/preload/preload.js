const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slopinator', {
  version: process.env.npm_package_version,
  pickInputFile: () => ipcRenderer.invoke('pick-input-file'),
  pickOutputPath: (defaultName) => ipcRenderer.invoke('pick-output-path', defaultName),
  runMaster: (args) => ipcRenderer.invoke('run-master', args),
  runMasterBatch: (args) => ipcRenderer.invoke('run-master-batch', args),
  classifyPath: (path) => ipcRenderer.invoke('classify-path', path),
  libraryList: () => ipcRenderer.invoke('library-list'),
  libraryAdd: (filePath) => ipcRenderer.invoke('library-add', filePath),
  libraryUpdate: (id, patch) => ipcRenderer.invoke('library-update', { id, patch }),
  libraryRemove: (id) => ipcRenderer.invoke('library-remove', id),
  libraryAnalyze: (id) => ipcRenderer.invoke('library-analyze', id),
  getPeaks: (filePath, buckets) => ipcRenderer.invoke('get-peaks', { filePath, buckets }),
  pickImportFiles: () => ipcRenderer.invoke('pick-import-files'),
  libraryImport: (paths) => ipcRenderer.invoke('library-import', paths),
  onMasterLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('master-log', listener);
    return () => ipcRenderer.removeListener('master-log', listener);
  },
});
