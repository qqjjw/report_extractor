const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('reportsAPI', {
  read: () => ipcRenderer.invoke('reports:read'),
  onZoom: callback => ipcRenderer.on('canvas:zoom', (_event, payload) => callback(payload)),
  tableMode: payload => ipcRenderer.invoke('table:mode',payload),
  searchTables: payload => ipcRenderer.invoke('table:search',payload),
  cancelTables: id => ipcRenderer.invoke('table:cancel',id),
  showTable: payload => ipcRenderer.invoke('table:show',payload),
  onTableSelected: callback => ipcRenderer.on('table:selected',(_event,payload)=>callback(payload)),
  onTableStatus: callback => ipcRenderer.on('table:status',(_event,payload)=>callback(payload))
});
