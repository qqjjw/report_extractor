const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises');
const {analyze,match}=require('./matcher');
// 입력값: 사용자 제공 원본은 읽기만 합니다. 파일 이름을 실제 회계기간으로 추정하지 않습니다.
const INPUTS=['2023.html','2022.html'];
let win;
async function analyzeFiles(){const docs=await Promise.all(INPUTS.map(async name=>analyze(await fs.readFile(path.join(__dirname,'..',name),'utf8'),name)));return {left:docs[0],right:docs[1],...match(...docs)};}
ipcMain.handle('lab:analyze',async event=>{if(event.sender!==win.webContents)return;try{return await analyzeFiles();}catch(e){return {error:e.message};}});
app.whenReady().then(async()=>{win=new BrowserWindow({width:1600,height:1000,webPreferences:{preload:path.join(__dirname,'preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));await win.loadFile(path.join(__dirname,'index.html'));});
app.on('window-all-closed',()=>app.quit());
