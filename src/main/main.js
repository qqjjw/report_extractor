const { app, BrowserWindow, ipcMain, screen, net } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const model = require('../shared/model');
const Rules = require('../tables/table-rules');
const ViewerNavigation=require('./viewer-navigation');
const {TableBackend,dartUrl} = require('../tables/table-backend');
// Keep Electron's browser cache inside the writable project directory.
const appRoot = path.resolve(__dirname, '../..');
const runtimePath = path.join(appRoot, '.runtime');
require('node:fs').mkdirSync(runtimePath, { recursive: true });
app.setPath('userData', runtimePath);
const guestPreload = path.join(runtimePath,'guest-preload.js');
require('node:fs').writeFileSync(guestPreload,require('./guest-bundle').guestBundle(appRoot));
let win;
let reports = new Map(); const guests = new Map(), pendingShows = new Map(), pendingSearches=new Map();
async function liveLoad(url,payload,rules,bodySection,signal,bodySectionPath){
  const guest=guestFor(payload.guestId,payload.toc.report.rcpNo);
  const id=`live-${Date.now()}-${Math.random()}`;
  return new Promise((resolve,reject)=>{
    const finish=(callback,value)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);pendingSearches.delete(id);if(!guest.isDestroyed())guest.send('table:cancel-live',id);callback(value);};
    const abort=()=>finish(reject,new Error('검색 취소됨'));
    const timer=setTimeout(()=>finish(reject,new Error('보고서 본문 로딩·탐색 시간 초과')),40000);
    pendingSearches.set(id,{guestId:guest.id,resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)});
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
    const send=()=>{if(!pendingSearches.has(id)||guest.isDestroyed())return;guest.send('table:search-live',{requestId:id,documentUrl:url,source:payload.source,input:payload.input,rules,bodySection,bodySectionPath});};
    const frame=guest.mainFrame.framesInSubtree.find(frame=>Rules.sameDocument(frame.url,url));
    if(frame)send();
    else guest.mainFrame.executeJavaScript(ViewerNavigation.script(url)).then(moved=>{if(moved)send();else pendingSearches.get(id)?.reject(new Error('본문 프레임을 찾지 못했습니다.'));}).catch(error=>pendingSearches.get(id)?.reject(error));
  });
}
const backend = new TableBackend(appRoot, (...args)=>net.fetch(...args), payload=>{if(win && !win.isDestroyed())win.webContents.send('table:status',payload);},{liveLoad});
ipcMain.on('table:live-result',(event,payload)=>{
  const pending=pendingSearches.get(payload?.requestId);
  if(!pending||pending.guestId!==event.sender.id||event.senderFrame!==event.sender.mainFrame)return;
  if(payload.ok){try{for(const table of payload.result.tables)tableValid(table,dartUrl(event.sender.getURL()).searchParams.get('rcpNo'));pending.resolve(payload.result);}catch(error){pending.reject(error);}}
  else pending.reject(new Error(payload.error||'본문 검색 실패'));
});
function host(event) {
  if(!win || event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame)throw new Error('허용되지 않은 요청입니다.');
}
function guestFor(id,reportId) {
  const guest=guests.get(id);if(!guest || guest.isDestroyed() || !reports.has(reportId))throw new Error('보고서 창을 찾지 못했습니다.');
  const url=dartUrl(guest.getURL());if(url.searchParams.get('rcpNo')!==reportId)throw new Error('현재 사이트의 접수번호가 다릅니다.');return guest;
}
function tableValid(table,reportId) {
  const url=dartUrl(table.documentUrl);
  if(url.searchParams.get('rcpNo')!==reportId || !Number.isInteger(table.tableIndex) || table.tableIndex<0 || typeof table.fingerprint!=='string' || !Array.isArray(table.cells) || !Array.isArray(table.headers) || !Array.isArray(table.rowLabels))throw new Error('표 정보가 올바르지 않습니다.');
}
ipcMain.handle('table:mode', (event,payload)=> {host(event);const guest=guestFor(payload.guestId,payload.reportId);guest.send('table:mode',Boolean(payload.enabled));if(payload.clear)guest.send('table:clear');if(payload.selection){tableValid(payload.selection,payload.reportId);guest.send('table:restore-selection',payload.selection);}return {ok:true};});
ipcMain.on('table:selected', (event,table)=> {
  try {
    const guest=guests.get(event.sender.id);if(guest!==event.sender || event.senderFrame!==guest.mainFrame)return;
    const reportId=dartUrl(guest.getURL()).searchParams.get('rcpNo');tableValid(table,reportId);
    win.webContents.send('table:selected',{guestId:guest.id,reportId,table});
  } catch(error){if(win&&!win.isDestroyed())win.webContents.send('table:status',{type:'error',message:error.message});}
});
ipcMain.handle('table:search',async(event,payload)=> {
  host(event);
  try {
    const sourceReport=reports.get(payload.source.reportId),targetReport=reports.get(payload.toc.report.rcpNo);
    if(!sourceReport || !targetReport || sourceReport.companyName!==targetReport.companyName || model.period(sourceReport.reportName).slice(0,4)===model.period(targetReport.reportName).slice(0,4))throw new Error('같은 회사의 다른 연도 보고서만 검색할 수 있습니다.');
    tableValid(payload.source,sourceReport.rcpNo);
    payload.toc.report={...targetReport,period:model.period(targetReport.reportName)};
    if(!Array.isArray(payload.toc.nodes)||!['ready','empty'].includes(payload.toc.status))throw new Error('대상 보고서 목차가 아직 준비되지 않았습니다.');
    if(!payload.input || ['include','exclude'].some(k=>!Array.isArray(payload.input[k])||payload.input[k].some(v=>typeof v!=='string'||!v.trim())))throw new Error('검색 키워드가 올바르지 않습니다.');
    return {ok:true,result:await backend.search(payload)};
  } catch(error){return {ok:false,error:error.message};}
});
function cancelShows(id) {
  for(const [key,pending] of pendingShows)if(!id || pending.searchId===id){guests.get(pending.guestId)?.send('table:cancel-show',key);pending.resolve({ok:false,error:'표 표시 취소됨'});}
}
ipcMain.handle('table:cancel',(event,id)=>{host(event);backend.cancel(id);cancelShows(id);return {ok:true};});
ipcMain.handle('table:show',async(event,payload)=> {
  host(event);
  try {
    tableValid(payload.table,payload.reportId);const guest=guestFor(payload.guestId,payload.reportId);
    const id=`show-${Date.now()}-${Math.random()}`;
    return await new Promise((resolve)=> {
      const timer=setTimeout(()=>{pendingShows.delete(id);resolve({ok:false,error:'표 표시 시간 초과'});},20000);
      pendingShows.set(id,{guestId:guest.id,tableUrl:payload.table.documentUrl,searchId:payload.searchId,resolve:result=>{clearTimeout(timer);pendingShows.delete(id);resolve(result);}});
      const send=()=>{if(!guest.isDestroyed())guest.send('table:show',{requestId:id,table:payload.table});};
      // Navigate only the DART content frame, keeping the viewer's report tree intact.
      const frames=guest.mainFrame.framesInSubtree.filter(frame=>{try{return dartUrl(frame.url).pathname==='/report/viewer.do';}catch{return false;}});
      const frame=frames.find(f=>Rules.sameDocument(f.url,payload.table.documentUrl)) || frames[0];
      if(frame && !Rules.sameDocument(frame.url,payload.table.documentUrl)) {
        guest.mainFrame.executeJavaScript(ViewerNavigation.script(payload.table.documentUrl)).then(moved=>{if(moved)send();else pendingShows.get(id)?.resolve({ok:false,error:'본문 프레임을 찾지 못했습니다.'});}).catch(()=>pendingShows.get(id)?.resolve({ok:false,error:'본문 프레임 이동 실패'}));
      } else if(frame)send();
      else pendingShows.get(id)?.resolve({ok:false,error:'HTML 본문 프레임이 없습니다. 보고서 본문을 먼저 열어 주세요.'});
    });
  } catch(error){return {ok:false,error:error.message};}
});
ipcMain.on('table:shown',(event,payload)=> {
  const pending=pendingShows.get(payload?.requestId);
  if(pending && pending.guestId===event.sender.id && event.senderFrame===event.sender.mainFrame)pending.resolve({ok:payload.ok===true,error:payload.error});
});
ipcMain.handle('reports:read', async event => {
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return { ok: false, error: '허용되지 않은 요청입니다.' };
  try {
    const data = JSON.parse(await fs.readFile(path.join(appRoot, 'data', 'reports.json'), 'utf8'));
    const loaded=model.validate(data);backend.reset();cancelShows();reports=new Map(loaded.map(r=>[r.rcpNo,r]));
    return { ok: true, reports: loaded };
  } catch (error) { return { ok: false, error: error.message }; }
});
app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1500, height: 1000, minWidth: 800, minHeight: 600,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: true }
  });
  win.removeMenu();
  win.webContents.on('will-attach-webview', (event, preferences, params) => {
    if (!/^https?:\/\//.test(params.src)) { event.preventDefault(); return; }
    preferences.preload = guestPreload;
    preferences.nodeIntegration = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
  });
  win.webContents.on('did-attach-webview', (_event, guest) => {
    guests.set(guest.id,guest);
    guest.on('preload-error',(_event,_file,error)=>{
      console.error('보고서 선택 코드 초기화 실패:',error.message);
      if(win&&!win.isDestroyed())win.webContents.send('table:status',{type:'error',guestId:guest.id,message:`보고서 선택 코드 초기화 실패: ${error.message}`});
    });
    const retries=new Map();
    guest.on('did-frame-finish-load',(_event,isMainFrame,processId,routingId)=>{
      if(isMainFrame)return;
      const frame=guest.mainFrame.framesInSubtree.find(f=>f.processId===processId && f.routingId===routingId);
      if(frame)retries.delete(frame.url);
    });
    guest.on('did-fail-load',(_event,code,description,url,isMainFrame)=>{
      if(code===-3 || isMainFrame)return;
      try{if(dartUrl(url).pathname!=='/report/viewer.do')return;}catch{return;}
      const attempt=retries.get(url)||0;
      if(attempt<2){
        retries.set(url,attempt+1);
        setTimeout(()=>{if(!guest.isDestroyed())guest.mainFrame.executeJavaScript(ViewerNavigation.script(url,url)).catch(()=>{});},750*(attempt+1));
      }else{
        for(const pending of pendingShows.values())if(pending.guestId===guest.id && Rules.sameDocument(pending.tableUrl,url))pending.resolve({ok:false,error:`본문 로딩 실패: ${description}. 해당 목차를 다시 클릭해 주세요.`});
      }
    });
    guest.on('destroyed',()=>{guests.delete(guest.id);for(const pending of pendingSearches.values())if(pending.guestId===guest.id)pending.reject(new Error('보고서 창이 닫혔습니다.'));for(const pending of pendingShows.values())if(pending.guestId===guest.id)pending.resolve({ok:false,error:'보고서 창이 닫혔습니다.'});});
    guest.setWindowOpenHandler(() => ({ action: 'deny' }));
    guest.on('will-navigate', (event, url) => { if (!/^https?:\/\//.test(url)) event.preventDefault(); });
    guest.on('zoom-changed', (_event, direction) => {
      guest.setZoomFactor(1);
      const point = screen.getCursorScreenPoint();
      const bounds = win.getContentBounds();
      win.webContents.send('canvas:zoom', { direction, x: point.x - bounds.x, y: point.y - bounds.y });
    });
  });
  win.loadFile(path.join(appRoot, 'src', 'renderer', 'index.html'));
  if (process.argv.includes('--capture-on-load')) {
    setTimeout(() => { console.error('실행 검증 시간 초과'); app.exit(1); }, 60000);
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      try {
        await fs.mkdir(path.join(appRoot, 'artifacts'), { recursive: true });
        const result = await win.webContents.executeJavaScript('window.runSmokeTests()');
        console.log(JSON.stringify(result));
        await fs.writeFile(path.join(appRoot, 'artifacts', 'smoke.json'), JSON.stringify(result, null, 2));
        await fs.writeFile(path.join(appRoot, 'artifacts', 'canvas.png'), (await win.webContents.capturePage()).toPNG());
        app.exit(result.ok ? 0 : 1);
      } catch (error) { console.error(error); app.exit(1); }
    }, 18000));
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit',()=>backend.stop());
