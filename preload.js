const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Auth
  login:      (creds)  => ipcRenderer.invoke('login', creds),
  getSession: ()       => ipcRenderer.invoke('get-session'),
  logout:     ()       => ipcRenderer.invoke('logout'),
  onLogout:   (cb)     => ipcRenderer.on('logout', cb),

  // Config & navigation
  getConfig:    ()      => ipcRenderer.invoke('get-config'),
  saveConfig:   (cfg)   => ipcRenderer.invoke('save-config', cfg),
  openExternal: (url)   => ipcRenderer.invoke('open-external', url),

  // EPC API
  fetchEPC: (params) => ipcRenderer.invoke('fetch-epc', params)
});
