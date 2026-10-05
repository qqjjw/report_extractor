const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lab',{analyze:()=>ipcRenderer.invoke('lab:analyze')});
