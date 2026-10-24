const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dart', {
  state: () => ipcRenderer.invoke('state'),
  command: (action, args) => ipcRenderer.invoke('command', action, args),
  bindGuest: (id, guestId) => ipcRenderer.invoke('bind-guest', id, guestId),
  onUpdate: fn => ipcRenderer.on('update', (_, state) => fn(state)),
  onLayout: fn => ipcRenderer.on('layout', (_, layout) => fn(layout))
});
