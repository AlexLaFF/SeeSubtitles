'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  chooseFolder: () => ipcRenderer.invoke('config:chooseFolder'),
  chooseAudioFile: () => ipcRenderer.invoke('config:chooseAudioFile'),
  coreStatus: () => ipcRenderer.invoke('core:status'),
  openControl: () => ipcRenderer.invoke('core:openControl'),
  cloud: (body) => ipcRenderer.invoke('cloud:action', body),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  updateStatus: () => ipcRenderer.invoke('updates:status'),
});
