const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('collector', {
  state: () => ipcRenderer.invoke('state'),
  reconnect: () => ipcRenderer.invoke('reconnect'),
  toggle: () => ipcRenderer.invoke('toggle'),
  remove: id => ipcRenderer.invoke('remove', id),
  clear: () => ipcRenderer.invoke('clear'),
  open: id => ipcRenderer.invoke('open-report', id),
  onState: listener => ipcRenderer.on('state-update', (_, state) => listener(state))
});
