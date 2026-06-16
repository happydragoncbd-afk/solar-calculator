const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  fetchEPC: (params) => ipcRenderer.invoke('fetch-epc', params),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
