const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('slopinator', {
  version: process.env.npm_package_version,
});
