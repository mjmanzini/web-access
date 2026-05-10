'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hostBridge', {
  onConfig: (cb) => ipcRenderer.on('config', (_e, cfg) => cb(cfg)),
  listSources: () => ipcRenderer.invoke('list-sources'),
  makeQr: (text) => ipcRenderer.invoke('make-qr', text),
  inputEvent: (msg) => ipcRenderer.invoke('input-event', msg),
  inputReleaseAll: () => ipcRenderer.invoke('input-release-all'),
  inputStatus: () => ipcRenderer.invoke('input-status'),
  openCallWindow: (code) => ipcRenderer.invoke('open-call-window', { code }),
  remoteAnnounce: (token) => ipcRenderer.invoke('remote-announce', { token }),
  remoteCancel: (token) => ipcRenderer.invoke('remote-cancel', { token }),
  remoteStatus: (token) => ipcRenderer.invoke('remote-status', { token }),
});
