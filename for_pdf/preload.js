const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadPdfs: () => ipcRenderer.invoke('load-pdfs'),
  parseSelection: payload => ipcRenderer.invoke('parse-selection', payload),
  saveExcel: payload => ipcRenderer.invoke('save-excel', payload)
});
