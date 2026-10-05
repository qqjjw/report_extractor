const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('canvasApp', {
  scroll: (x,y) => ipcRenderer.send('canvas:scroll',{x,y}),
  state: () => ipcRenderer.invoke('canvas:state'),
  command: (action, id, payload) => ipcRenderer.invoke('canvas:command', action, id, payload),
  begin: (kind, id, x, y) => ipcRenderer.send('canvas:begin', { kind, id, x, y }),
  move: (x, y, end = false) => ipcRenderer.send('canvas:move', { x, y, end }),
  onState: callback => ipcRenderer.on('canvas:state', (_, value) => callback(value)),
  onCard: callback => ipcRenderer.on('canvas:card', (_, value) => callback(value)),
  onGesture: callback => ipcRenderer.on('canvas:gesture', (_, value) => callback(value))
});
