const { contextBridge, ipcRenderer } = require('electron');

// 렌더러(index.js)에서 사용할 API를 안전하게 노출
contextBridge.exposeInMainWorld('electronAPI', {
  // dart_reports.json 읽기
  readJson: () => ipcRenderer.invoke('read-json'),

  // preload-frame.js 경로 요청
  getFramePreloadPath: () => ipcRenderer.invoke('get-frame-preload-path'),

  // Excel 저장
  saveExcel: (payload) => ipcRenderer.invoke('save-excel', payload),
});
