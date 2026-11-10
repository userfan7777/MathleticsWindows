'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('credentialStore', {
  save: (username, password) => ipcRenderer.invoke('credentials:save', { username, password }),
  close: () => ipcRenderer.send('credentials:close')
});
