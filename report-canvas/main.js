const { app, BrowserWindow, WebContentsView, View, ipcMain, dialog } = require('electron');
const toc = require('./lib/toc');
const path = require('node:path');
const { readReports, createScene, arrange, resize, applySize, zoomTo, scrollRange, scrollTo, centerOn, preserveCenter } = require('./lib/scene');

// ===== 입력값: 수집 앱의 JSON 위치·웹 화면 크롬·동시 로드 수 =====
const REPORTS_FILE = path.resolve(__dirname, '..', 'data', 'reports.json');
const TOOLBAR_HEIGHT = 96;
// 패널 폭과 스크롤바 영역은 네이티브 보고서 화면에서 제외합니다.
const PANEL_DEFAULT = 280, PANEL_MIN = 200, PANEL_MAX = 500, CANVAS_MIN = 400;
const SPLITTER_WIDTH = 6, SCROLLBAR_SIZE = 18;
const CARD_HEADER = 68;
const CARD_FOOTER = 106;
const LOAD_CONCURRENCY = 3;
const LOAD_TIMEOUT_MS = 45000;
const REMOVED_PRODUCTS = /\s(?:Electron|dart-report-canvas)\/\S+/gi;
const localPreferences = { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false };
let win, stage, backdrop, overlay, scene = createScene([]), entries = new Map(), trusted = new Set(), loading = false, error = '', generation = 0, gesture;

let targetSelection=new Set(), searchBusy=false, searchMessage='', searchJob=0;
let searchSession=null;
let panelWidth=PANEL_DEFAULT, panelCollapsed=false, selected=null, viewport=null, range=null;
// ===== 처리 로직: 네이티브 웹 화면은 캔버스 좌표에 맞춰 이동 =====
const snapshot = () => ({ cards: scene.cards, zoom: scene.zoom, pan: scene.pan, loading, error, file: REPORTS_FILE, panelWidth, panelCollapsed, selected, viewport, range, hasSearch:!!searchSession, targetSelection:[...targetSelection], searchBusy, searchMessage });
function send(contents, channel, value) { if (!contents.isDestroyed()) contents.send(channel, value); }
function publish() {
  if (!win || win.isDestroyed()) return;
  send(win.webContents, 'canvas:state', snapshot());
  if (backdrop) send(backdrop.webContents, 'canvas:state', snapshot());
  scene.cards.forEach(card => { const entry = entries.get(card.rcpNo); if (entry) { entry.site.setVisible(!card.error); send(entry.chrome.webContents, 'canvas:card', {...card,searchBusy,hasSearch:!!searchSession}); } });
}
function layout(resetRange = false, rangeMode = 'content') {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const visiblePanel = panelCollapsed ? 0 : Math.min(panelWidth, Math.max(PANEL_MIN,width-CANVAS_MIN-SPLITTER_WIDTH-SCROLLBAR_SIZE));
  const next={x:visiblePanel+(panelCollapsed?0:SPLITTER_WIDTH),y:TOOLBAR_HEIGHT,width:Math.max(1,width-visiblePanel-(panelCollapsed?0:SPLITTER_WIDTH)-SCROLLBAR_SIZE),height:Math.max(1,height-TOOLBAR_HEIGHT-SCROLLBAR_SIZE)};
  if(viewport) preserveCenter(scene,viewport,next);
  viewport=next;
  range=scrollRange(scene,viewport,resetRange===true?null:range,rangeMode);
  stage.setBounds(viewport);
  backdrop.setBounds({x:0,y:0,width:viewport.width,height:viewport.height});
  overlay.setBounds({ x: 0, y: 0, width, height });
  scene.cards.forEach(card => {
    const entry = entries.get(card.rcpNo); if (!entry) return;
    const z = scene.zoom;
    const x = Math.round(scene.pan.x + card.x * z), y = Math.round(scene.pan.y + card.y * z);
    const w = Math.round(card.width * z), h = Math.round(card.height * z);
    entry.group.setBounds({ x, y, width: w, height: h });
    entry.chrome.setBounds({ x: 0, y: 0, width: w, height: h });
    // 화면 밖에서도 본문 뷰포트 크기를 유지합니다. 부모 stage가 화면 영역에서 자릅니다.
    entry.group.setVisible(true);
    entry.chrome.webContents.setZoomFactor(z);
    entry.site.setBounds({ x: 0, y: Math.round(CARD_HEADER * z), width: w, height: Math.max(1, h - Math.round((CARD_HEADER + CARD_FOOTER) * z)) });
    entry.site.webContents.setZoomFactor(z);
  });
}
function dispose() {
  for (const entry of entries.values()) {
    stage.removeChildView(entry.group); trusted.delete(entry.chrome.webContents.id);
    if (!entry.site.webContents.isDestroyed()) entry.site.webContents.close();
    if (!entry.chrome.webContents.isDestroyed()) entry.chrome.webContents.close();
  }
  entries.clear();
}
function cancelGesture() { gesture = null; if (overlay) overlay.setVisible(false); }
async function loadSite(card, epoch) {
  const entry = entries.get(card.rcpNo); if (!entry || epoch !== generation) return;
  // 다시 열기도 원본 JSON에 기록된 실제 보고서 URL을 사용합니다.
  const token = ++entry.token; card.status = '불러오는 중'; card.error = ''; publish();
  let timer;
  try {
    await Promise.race([
      entry.site.webContents.loadURL(card.url),
      new Promise((_, reject) => { timer = setTimeout(() => { if (!entry.site.webContents.isDestroyed()) entry.site.webContents.stop(); reject(new Error('접속 시간이 초과되었습니다.')); }, LOAD_TIMEOUT_MS); })
    ]);
    if (epoch === generation && token === entry.token) { card.status = '열림'; card.error = ''; }
  } catch (failure) {
    if (epoch === generation && token === entry.token) { card.status = '접속 실패'; card.error = failure.message; }
  } finally { clearTimeout(timer); if (epoch === generation && token === entry.token) publish(); }
}
async function refresh() {
  if (loading) return snapshot();
  loading = true; error = ''; publish();
  let reports;
  try { reports = await readReports(REPORTS_FILE); }
  catch (failure) { loading = false; error = failure.message; publish(); return snapshot(); }
  const epoch = ++generation; cancelGesture(); dispose(); scene = createScene(reports); selected=null; range=null; targetSelection.clear();searchJob++;searchBusy=false;searchMessage='';searchSession=null;
  try {
    for (const card of scene.cards) {
      const chrome = new WebContentsView({ webPreferences: { ...localPreferences, partition: 'canvas-controls' } });
      const site = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'persist:report-canvas', backgroundThrottling: false } });
      site.webContents.session.setUserAgent(app.userAgentFallback);
      site.webContents.setUserAgent(app.userAgentFallback);
      site.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } } }));
      const group = new View(); group.addChildView(chrome); group.addChildView(site); stage.addChildView(group);
      entries.set(card.rcpNo, { group, chrome, site, token: 0 }); trusted.add(chrome.webContents.id);
      chrome.webContents.on('did-finish-load', () => send(chrome.webContents, 'canvas:card', card));
      site.webContents.on('render-process-gone', () => { card.status = '접속 실패'; card.error = '웹 화면이 종료되었습니다. 다시 열기를 누르세요.'; publish(); });
      await chrome.webContents.loadFile(path.join(__dirname, 'card.html'));
    }
    layout(); publish();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, scene.cards.length) }, async () => {
      while (next < scene.cards.length && epoch === generation) await loadSite(scene.cards[next++], epoch);
    }));
  } catch (failure) { error = `웹 화면 생성 실패: ${failure.message}`; }
  finally { loading = false; publish(); }
  return snapshot();
}
function setReview(card,record,state,reason=''){
 const node=record.candidates?.[record.index];card.review={state,reason,sourcePath:searchSession.source.path.join(' → '),candidatePath:node?.path.join(' → ')||'',attempts:record.attempts};
}
async function tryCandidate(card,record,current){
 if(!current())return;
 try{const entry=entries.get(card.rcpNo);if(card.status!=='열림'||!entry)throw new Error('보고서가 아직 준비되지 않았습니다.');
 if(record.candidates===null){const data=await toc.inspect(entry.site.webContents);if(!current())return;record.candidates=toc.candidates(searchSession.source,data.nodes);}
 if(record.index>=record.candidates.length){setReview(card,record,'후보 없음');return;}
 record.attempts++;setReview(card,record,'이동 중');publish();
 await toc.open(entry.site.webContents,record.candidates[record.index],()=>current()&&entries.get(card.rcpNo)===entry);if(current())setReview(card,record,'판정 대기');
 }catch(failure){if(current())setReview(card,record,'이동 실패',failure.message);}
}
async function startSearch(id){
 if(searchBusy)return snapshot();const source=scene.cards.find(c=>c.rcpNo===id),targets=scene.cards.filter(c=>c.rcpNo!==id&&targetSelection.has(c.rcpNo));
 if(!targets.length){searchMessage='탐색할 다른 보고서를 선택하세요.';publish();return snapshot();}if(!source||source.status!=='열림'){searchMessage='기준 보고서가 아직 준비되지 않았습니다.';publish();return snapshot();}
 searchBusy=true;publish();const epoch=generation,job=++searchJob,current=()=>epoch===generation&&job===searchJob;
 try{if(searchSession){const answer=await dialog.showMessageBox(win,{type:'question',buttons:['취소','새 탐색 시작'],defaultId:0,cancelId:0,message:'새 탐색을 시작하면 기존 판정과 제외 기록이 초기화됩니다.'});if(!current()||answer.response!==1)return snapshot();}
 const data=await toc.inspect(entries.get(id).site.webContents);if(!data.current||!await toc.matches(entries.get(id).site.webContents,data.current))throw new Error('현재 본문과 목차를 연결하지 못했습니다. 목차를 선택한 뒤 다시 시도하세요.');if(!current())return snapshot();
 searchSession={sourceId:id,source:data.current,records:new Map()};scene.cards.forEach(c=>delete c.review);source.review={state:'기준 목차',sourcePath:data.current.path.join(' → '),candidatePath:'',attempts:0};searchMessage='기준: '+data.current.path.join(' → ');publish();
 for(const card of targets){if(!current())break;const record={candidates:null,index:0,attempts:0};searchSession.records.set(card.rcpNo,record);await tryCandidate(card,record,current);if(current())publish();}
 }catch(failure){if(current())searchMessage=failure.message;}finally{if(current()){searchBusy=false;publish();}}return snapshot();
}
async function judgeCandidate(action,id){
 if(searchBusy||!searchSession)return snapshot();const record=searchSession.records.get(id),card=scene.cards.find(c=>c.rcpNo===id);if(!record||!card||['합격','후보 없음'].includes(card.review?.state))return snapshot();
 const epoch=generation,job=++searchJob,current=()=>epoch===generation&&job===searchJob;searchBusy=true;publish();
 try{if(action==='candidate-retry'){await tryCandidate(card,record,current);return snapshot();}if(card.review?.state!=='판정 대기')return snapshot();
 const entry=entries.get(id),node=record.candidates[record.index];if(!entry||!await toc.matches(entry.site.webContents,node)){if(current())setReview(card,record,'이동 실패','현재 목차가 후보와 다릅니다. 현재 후보 다시 열기를 누르세요.');return snapshot();}if(!current())return snapshot();
 if(action==='candidate-accept')setReview(card,record,'합격');else{record.index++;await tryCandidate(card,record,current);}
 }catch(failure){if(current())setReview(card,record,'이동 실패',failure.message);}finally{if(current()){searchBusy=false;publish();}}return snapshot();
}
function authorized(event) { return trusted.has(event.sender.id); }
ipcMain.handle('canvas:state', event => authorized(event) ? snapshot() : null);
ipcMain.handle('canvas:command', async (event, action, id) => {
  if (!authorized(event)) return;
  const card = scene.cards.find(value => value.rcpNo === id);
  if (action === 'refresh') return refresh();
  if (action === 'search-toc') {await startSearch(id);return snapshot();}
  if (['candidate-accept','candidate-reject','candidate-retry'].includes(action)) {await judgeCandidate(action,id);return snapshot();}
  if (action === 'target-toggle' && card) {targetSelection.has(id)?targetSelection.delete(id):targetSelection.add(id);publish();return snapshot();}
  if (action === 'target-all' || action === 'target-none') {targetSelection=action==='target-all'?new Set(scene.cards.map(c=>c.rcpNo)):new Set();publish();return snapshot();}
  if (action === 'align' || action === 'asc' || action === 'desc') arrange(scene, action);
  else if (action === 'zoom-in') zoomTo(scene, scene.zoom + 0.1);
  else if (action === 'zoom-out') zoomTo(scene, scene.zoom - 0.1);
  else if (action === 'zoom-reset') zoomTo(scene, 1);
  else if (action === 'toggle-panel') panelCollapsed=!panelCollapsed;
  else if (action === 'focus' && card) { selected=id;centerOn(scene,card,viewport);stage.addChildView(entries.get(id).group); }
  else if (action === 'apply-size' && card) applySize(scene, card);
  else if (action === 'retry' && card && card.status !== '불러오는 중' && !loading) await loadSite(card, generation);
  layout(['align','asc','desc','zoom-in','zoom-out','zoom-reset'].includes(action),action==='apply-size'?'content':'view'); publish(); return snapshot();
});
ipcMain.on('canvas:begin', (event, request) => {
  if (!authorized(event) || !request || !['pan', 'move', 'resize', 'panel'].includes(request.kind) || !Number.isFinite(request.x) || !Number.isFinite(request.y)) return;
  const card = scene.cards.find(value => value.rcpNo === request.id);
  if (!['pan','panel'].includes(request.kind) && !card) return;
  gesture = { ...request, owner: event.sender.id, card, start: card ? { ...card } : { ...scene.pan }, panelWidth };
  if (card) { selected=card.rcpNo;stage.addChildView(entries.get(card.rcpNo).group); }
  win.contentView.addChildView(overlay); overlay.setVisible(true); overlay.webContents.focus();
  send(overlay.webContents, 'canvas:gesture', request.kind);
});
ipcMain.on('canvas:move', (event, request) => {
  if (!gesture || (event.sender !== overlay.webContents && event.sender.id !== gesture.owner) || !Number.isFinite(request.x) || !Number.isFinite(request.y)) return;
  const dx = request.x - gesture.x, dy = request.y - gesture.y;
  if (gesture.kind === 'pan') scene.pan = { x: gesture.start.x + dx, y: gesture.start.y + dy };
  else if (gesture.kind === 'move') { gesture.card.x = gesture.start.x + dx / scene.zoom; gesture.card.y = gesture.start.y + dy / scene.zoom; }
  else if(gesture.kind==='panel') panelWidth=Math.min(PANEL_MAX,win.getContentSize()[0]-CANVAS_MIN-SPLITTER_WIDTH-SCROLLBAR_SIZE,Math.max(PANEL_MIN,gesture.panelWidth+dx));
  else resize(gesture.card, gesture.start.width + dx / scene.zoom, gesture.start.height + dy / scene.zoom);
  layout(false,['pan','panel'].includes(gesture.kind)?'view':'content'); send(win.webContents,'canvas:state',snapshot()); if (request.end) { cancelGesture(); publish(); }
});
ipcMain.on('canvas:scroll',(event,request)=>{
  if(!authorized(event)||!request||!Number.isFinite(request.x)||!Number.isFinite(request.y))return;
  if(!viewport || !range)return;
  scrollTo(scene,viewport,range,request.x,request.y);layout(false,'fixed');publish();
});
// 여러 네이티브 웹 화면이 겹쳐도 컨트롤의 스크롤 이벤트와 화면 갱신을 유지합니다.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async () => {
  app.userAgentFallback = app.userAgentFallback.replace(REMOVED_PRODUCTS, '');
  win = new BrowserWindow({ width: 1500, height: 950, minWidth: 900, minHeight: 600, title: 'DART 보고서 캔버스', webPreferences: localPreferences });
  stage = new View(); win.contentView.addChildView(stage);
  backdrop = new WebContentsView({ webPreferences: localPreferences }); stage.addChildView(backdrop);
  trusted.add(backdrop.webContents.id);
  await backdrop.webContents.loadFile(path.join(__dirname, 'background.html'));
  overlay = new WebContentsView({ webPreferences: localPreferences });
  overlay.setBackgroundColor('#00000000'); overlay.setVisible(false); win.contentView.addChildView(overlay);
  trusted.add(win.webContents.id); trusted.add(overlay.webContents.id);
  await overlay.webContents.loadFile(path.join(__dirname, 'overlay.html'));
  await win.loadFile(path.join(__dirname, 'index.html'));
  layout(); win.on('resize', ()=>{layout(false,'view');publish();}); win.on('blur', cancelGesture);
  win.on('closed', () => { generation++;searchJob++; dispose(); if (!overlay.webContents.isDestroyed()) overlay.webContents.close(); if (!backdrop.webContents.isDestroyed()) backdrop.webContents.close(); });
  await refresh();
});
app.on('window-all-closed', () => app.quit());
