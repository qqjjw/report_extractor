const { app, BrowserWindow, WebContentsView, View, ipcMain, dialog } = require('electron');
const toc = require('./lib/toc');
const tables = require('./lib/tables');
const selections = require('./lib/selection');
const { writeSelections } = require('./lib/excel');
const path = require('node:path');
const { readReports, createScene, arrange, resize, applySize, zoomTo, scrollRange, scrollTo, centerOn, preserveCenter } = require('./lib/scene');

// ===== 입력값: 수집 앱의 JSON 위치·웹 화면 크롬·동시 로드 수 =====
const REPORTS_FILE = path.resolve(__dirname, '..', 'data', 'reports.json');
const TOOLBAR_HEIGHT = 96;
// 패널 폭과 스크롤바 영역은 네이티브 보고서 화면에서 제외합니다.
const PANEL_DEFAULT = 280, PANEL_MIN = 200, PANEL_MAX = 500, CANVAS_MIN = 400;
const SPLITTER_WIDTH = 6, SCROLLBAR_SIZE = 18;
const CARD_HEADER = 68;
const CARD_FOOTER = 126;
const LOAD_CONCURRENCY = 3;
const {LOAD_TIMEOUT_MS,REMOVED_PRODUCTS}=require('./lib/browser');
const localPreferences = { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false };
let win, stage, backdrop, overlay, scene = createScene([]), entries = new Map(), trusted = new Set(), loading = false, error = '', generation = 0, gesture;

let targetSelection=new Set(), searchBusy=false, searchMessage='', searchJob=0;
let searchSession=null, tableReference=null, tablePicking=null, pickTimer, pickJob=0;
const selectedTables = new selections.SelectionList(), yearOverrides = new Map();
let manualMode = null, manualTimer, exportBusy = false, selectionBusy = false, selectionMessage = '', scratch;
const editorFrames=new Map();let editorTimer;
const selectionLocked=()=>searchBusy||exportBusy||selectionBusy||loading;
const editorItems=id=>selectedTables.items.filter(i=>i.rcpNo===id).map(({id,bodyUrl,index,fingerprint,group})=>({id,bodyUrl,index,fingerprint,group}));
const publicReference=()=>tableReference?{stamp:tableReference.stamp,sourceId:tableReference.sourceId,path:tableReference.node.path.join(' → '),section:tableReference.section,keywords:tableReference.keywords,cells:tableReference.cells,preview:tableReference.text.slice(0,220)}:null;
let panelWidth=PANEL_DEFAULT, panelCollapsed=false, selected=null, viewport=null, range=null;
// ===== 처리 로직: 네이티브 웹 화면은 캔버스 좌표에 맞춰 이동 =====
const snapshot = () => ({ cards: scene.cards.map(c=>({...c,selectedCount:selectedTables.items.filter(i=>i.rcpNo===c.rcpNo).length,reportYear:yearOverrides.get(c.rcpNo)||selections.reportYear(c)})), zoom: scene.zoom, pan: scene.pan, loading, error, file: REPORTS_FILE, panelWidth, panelCollapsed, selected, viewport, range, hasSearch:!!searchSession, tableReference:publicReference(), pickingId:tablePicking?.sourceId||null, targetSelection:[...targetSelection], searchBusy, searchMessage,selectedTables:selectedTables.publicItems(),manualId:manualMode?.id||null,exportBusy,selectionBusy,selectionMessage });
function send(contents, channel, value) { if (!contents.isDestroyed()) contents.send(channel, value); }
function publish() {
  if (!win || win.isDestroyed()) return;
  updateEditingControls();
  send(win.webContents, 'canvas:state', snapshot());
  if (backdrop) send(backdrop.webContents, 'canvas:state', snapshot());
  scene.cards.forEach(card => { const entry = entries.get(card.rcpNo); if (entry) { entry.site.setVisible(!card.error); send(entry.chrome.webContents, 'canvas:card', {...card,searchBusy:searchBusy||exportBusy||selectionBusy,manual:manualMode?.id===card.rcpNo,selectedCount:selectedTables.items.filter(i=>i.rcpNo===card.rcpNo).length,hasSearch:!!searchSession,isReference:tableReference?.sourceId===card.rcpNo,picking:tablePicking?.sourceId===card.rcpNo,hasReference:!!tableReference}); } });
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
  editorFrames.clear();
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
  if (loading || exportBusy || searchBusy || selectionBusy) return snapshot();
  loading = true; error = ''; publish();
  let reports;
  try { reports = await readReports(REPORTS_FILE); }
  catch (failure) { loading = false; error = failure.message; publish(); return snapshot(); }
  await stopManual();const epoch = ++generation; await cancelPick();tableReference=null;selectedTables.clear();yearOverrides.clear();selectionMessage='';cancelGesture(); dispose(); scene = createScene(reports); selected=null; range=null; targetSelection.clear();searchJob++;searchBusy=false;searchMessage='';searchSession=null;
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
      site.webContents.on('did-frame-finish-load', () => restoreSelections(card.rcpNo).catch(()=>{}));
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
async function cancelPick(){
 pickJob++;clearTimeout(pickTimer);const picking=tablePicking;tablePicking=null;if(picking&&!picking.frame.isDestroyed())try{await tables.run(picking.frame,'stop');}catch{}
}
async function clearHighlights(){
 await Promise.allSettled([...entries.values()].map(async entry=>{const frame=await tables.bodyFrame(entry.site.webContents);await tables.run(frame,'clear');}));
}
async function togglePick(id){
 if(searchBusy||exportBusy||selectionBusy)return;await stopManual();
 if(tablePicking?.sourceId===id){await cancelPick();searchMessage='표 선택을 취소했습니다.';publish();return;}
 await cancelPick();const card=scene.cards.find(c=>c.rcpNo===id),entry=entries.get(id),epoch=generation,pickToken=pickJob;
 try{if(!entry||card?.status!=='열림')throw new Error('보고서가 아직 준비되지 않았습니다.');
 const data=await toc.inspect(entry.site.webContents);if(!data.current||!await toc.matches(entry.site.webContents,data.current))throw new Error('현재 본문과 목차를 연결하지 못했습니다. 목차를 먼저 선택하세요.');
 const frame=await tables.bodyFrame(entry.site.webContents);if(epoch!==generation||pickToken!==pickJob)return;
 const picking={sourceId:id,frame,node:data.current,epoch};tablePicking=picking;
 await tables.run(frame,'start');searchMessage='본문의 원하는 표를 클릭하세요. 표 선택 버튼을 다시 누르면 취소합니다.';publish();
 const poll=async()=>{if(tablePicking!==picking||epoch!==generation)return;
  try{if(frame.isDestroyed())throw new Error('본문이 변경되었습니다. 표 선택을 다시 시작하세요.');const picked=await tables.run(frame,'poll');if(tablePicking!==picking||epoch!==generation)return;
   if(picked){if(picked.error)throw new Error(picked.error);if(!await toc.matches(entry.site.webContents,picking.node))throw new Error('본문이 변경되었습니다. 표를 다시 선택하세요.');
    if(tableReference&&tableReference.frame!==frame&&!tableReference.frame.isDestroyed())await tables.run(tableReference.frame,'clear');
    await clearHighlights();if(tablePicking!==picking||epoch!==generation)return;
    tableReference={...picked,stamp:Date.now(),sourceId:id,node:picking.node,frame,url:frame.url,section:picked.suggestedSection||picking.node.title,keywords:[]};
    await tables.run(frame,'show',{...picked,reference:true});tablePicking=null;searchJob++;searchSession=null;scene.cards.forEach(c=>delete c.review);searchMessage='기준 표를 선택했습니다. 세부 구간명과 기준 표의 필수 문구를 지정하세요.';publish();return;
   }
  }catch(failure){if(tablePicking===picking){await cancelPick();searchMessage=failure.message;publish();}return;}
  pickTimer=setTimeout(poll,tables.PICK_INTERVAL_MS);
 };pickTimer=setTimeout(poll,tables.PICK_INTERVAL_MS);
 }catch(failure){if(pickToken===pickJob){await cancelPick();searchMessage=failure.message;publish();}}
}
// 기준 본문을 바꾼 뒤에는 이전 표를 기준으로 후속 탐색·판정을 진행하지 않습니다.
async function verifyReference(reference){
 const entry=entries.get(reference.sourceId);
 if(!entry||reference.frame.isDestroyed()||!await toc.matches(entry.site.webContents,reference.node))throw new Error('기준 본문이 변경되었습니다. 표를 다시 선택하세요.');
 await tables.run(reference.frame,'verify',reference);
}
function tableReview(card,record,state,reason=''){
 const candidate=record.candidates?.[record.index];card.review={state,reason,sourcePath:searchSession.reference.node.path.join(' → '),candidatePath:record.node?.path.join(' → ')||'',attempts:record.attempts,total:record.candidates?.length||0,position:candidate?record.index+1:0,preview:candidate?.preview||''};
}
async function scanTarget(card,record,current,{manual=false,broad=false}={}){
 const entry=entries.get(card.rcpNo);if(!entry||card.status!=='열림')throw new Error('보고서가 아직 준비되지 않았습니다.');
 const data=await toc.inspect(entry.site.webContents);if(!current())return;
 record.node=manual?data.current:tables.route(searchSession.reference,data.nodes);if(!record.node)throw new Error('현재 목차를 식별하지 못했습니다.');
 if(!manual){record.attempts++;tableReview(card,record,'구간 이동 중');publish();await toc.open(entry.site.webContents,record.node,current);}
 if(!current())return;
 const frame=await tables.bodyFrame(entry.site.webContents);record.frame=frame;record.url=frame.url;
 const section=searchSession.options.section;
 const sectionIsDocument=!!section&&tables.compact(record.node.title)===tables.compact(section);
 record.candidates=await tables.run(frame,'find',{...searchSession.options,broad,sectionIsDocument});record.index=0;
 if(!current())return;await showTable(card,record,current);
}
async function showTable(card,record,current){
 if(!current())return;
 if(!record.candidates||record.index>=record.candidates.length){if(record.frame&&!record.frame.isDestroyed())await tables.run(record.frame,'clear');if(current())tableReview(card,record,'후보 없음');return;}
 if(record.frame.isDestroyed()||!await toc.matches(entries.get(card.rcpNo).site.webContents,record.node))throw new Error('현재 본문이 변경되었습니다. 현재 구간에서 다시 검색하세요.');
 if(!current())return;await tables.run(record.frame,'show',record.candidates[record.index]);if(current())tableReview(card,record,'판정 대기');
}
async function startTableSearch(id,payload){
 if(searchBusy||exportBusy||selectionBusy)return;await stopManual();await cancelPick();const reference=tableReference;
 if(!reference){searchMessage='먼저 기준 표를 선택하세요.';publish();return;}
 if(id&&id!==reference.sourceId)return;
 const targets=scene.cards.filter(c=>c.rcpNo!==reference.sourceId&&targetSelection.has(c.rcpNo));if(!targets.length){searchMessage='탐색할 다른 보고서를 선택하세요.';publish();return;}
 searchBusy=true;publish();const epoch=generation,job=++searchJob,current=()=>epoch===generation&&job===searchJob;
 try{
 const options=tables.validateOptions(reference,payload?.section??reference.section,payload?.keywords??reference.keywords.join('\n'));
 if(!options.section)throw new Error('세부 구간명을 입력하세요. 범위가 넓다면 대상별 현재 구간 전체 검색을 명시적으로 사용하세요.');
 await verifyReference(reference);if(!current())return;
 if(searchSession){const answer=await dialog.showMessageBox(win,{type:'question',buttons:['취소','새 표 검색'],defaultId:0,cancelId:0,message:'새 검색을 시작하면 이전 판정과 제외 기록이 초기화됩니다.'});if(!current()||answer.response!==1)return;}
 reference.section=options.section;reference.keywords=options.keywords;await clearHighlights();if(!current())return;await tables.run(reference.frame,'show',{...reference,reference:true});
 searchSession={reference:{...reference},options,records:new Map()};scene.cards.forEach(c=>delete c.review);searchMessage='표 검색 중: '+options.section+' / '+options.keywords.join(' + ');publish();
 for(const card of targets){if(!current())break;await verifyReference(reference);if(!current())break;const record={node:null,candidates:null,index:0,attempts:0};searchSession.records.set(card.rcpNo,record);
  try{await scanTarget(card,record,current);}catch(failure){if(current())tableReview(card,record,'범위 확인 필요',failure.message);}if(current())publish();
 }
 if(current())searchMessage='기준: '+options.section+' / '+options.keywords.join(' + ')+' · 대상별 파란 후보 테두리를 확인하세요. 저장할 표는 직접 선택하세요.';
 }catch(failure){if(current())searchMessage=failure.message;}finally{if(current()){searchBusy=false;publish();}}
}
async function judgeTable(action,id){
 if(searchBusy||exportBusy||selectionBusy||!searchSession)return;await stopManual();const card=scene.cards.find(c=>c.rcpNo===id),record=searchSession.records.get(id);if(!card||!record)return;
 if(card.review?.state==='합격'&&action!=='table-rescan'&&action!=='table-broad')return;
 const epoch=generation,job=++searchJob,current=()=>epoch===generation&&job===searchJob;searchBusy=true;publish();
 try{
 await verifyReference(searchSession.reference);if(!current())return;
 if(action==='table-rescan'||action==='table-broad'){await scanTarget(card,record,current,{manual:true,broad:action==='table-broad'});return;}
 if(action==='table-retry'){if(record.candidates?.length)await showTable(card,record,current);else await scanTarget(card,record,current);return;}
 if(card.review?.state!=='판정 대기')return;
 if(record.frame.isDestroyed()||!await toc.matches(entries.get(id).site.webContents,record.node))throw new Error('현재 본문이 후보 구간과 다릅니다. 현재 구간에서 다시 검색하세요.');
 await tables.run(record.frame,'verify',record.candidates[record.index]);if(!current())return;
 if(action==='table-accept')tableReview(card,record,'합격');else{record.index++;await showTable(card,record,current);}
 }catch(failure){if(current())tableReview(card,record,'범위 확인 필요',failure.message);}finally{if(current()){searchBusy=false;publish();}}
}
// ===== 처리 로직: 수동 선택은 메타데이터만 유지하고 본문 이동 때 표시를 복원 =====
async function syncFrame(id, frame) {
 const items=selectedTables.items.filter(i=>i.rcpNo===id&&i.bodyUrl===frame.url);
 let record=editorFrames.get(id);if(!record||record.frame!==frame){record={frame,url:frame.url,epoch:generation,revision:0,signature:''};editorFrames.set(id,record);}
 // 같은 WebFrame 객체가 목차 이동 후에도 재사용될 수 있어 주소는 매번 갱신합니다.
 record.url=frame.url;
 const currentItems=editorItems(id).filter(i=>i.bodyUrl===frame.url),busy=selectionLocked();
 record.revision++;record.signature=JSON.stringify([busy,currentItems]);
 const invalid=await selections.run(frame,'sync',{items:currentItems,busy,revision:record.revision});
 if(!currentItems.length&&manualMode?.id!==id)editorFrames.delete(id);
 for(const item of items)item.error=invalid.includes(item.id)?'원문 표가 변경되었습니다. 취소 후 다시 선택하세요.':'';
}
// OFF 상태에서도 작은 편집 이벤트 큐만 읽습니다. 본문·셀을 주기적으로 분석하지 않습니다.
function updateEditingControls(){
 for(const [id,record] of editorFrames){
  if(record.epoch!==generation||record.frame.isDestroyed()){editorFrames.delete(id);continue;}
  const items=editorItems(id).filter(i=>i.bodyUrl===record.url),busy=selectionLocked(),signature=JSON.stringify([busy,items]);
  if(signature===record.signature)continue;record.signature=signature;record.revision++;
  selections.run(record.frame,'edit',{items,busy,revision:record.revision}).catch(()=>{});
 }
}
function changeGroup(id,value){selectedTables.group(id,value);selectionMessage='그룹 번호를 변경했습니다. 다른 표의 그룹은 유지합니다.';}
function handleGroupEvents(id,frame,events){
 const record=editorFrames.get(id);if(!record||record.frame!==frame||record.epoch!==generation||frame.isDestroyed()||frame.url!==record.url)return;
 const revision=record.revision;let changed=false;
 for(const event of events.filter(e=>e.kind==='group')){
  if(selectionLocked()||event.revision!==revision)continue;
  const item=selectedTables.items.find(i=>i.id===event.id&&i.rcpNo===id&&i.bodyUrl===record.url&&i.fingerprint===event.fingerprint);if(!item)continue;
  try{changeGroup(item.id,event.group);changed=true;}catch(e){selectionMessage=e.message;}
 }
 if(changed)publish();
}
async function pollEditors(){
 for(const [id,record] of editorFrames){
  if(record.frame.isDestroyed()||record.epoch!==generation){editorFrames.delete(id);continue;}
  if(manualMode?.id===id||!selectedTables.items.some(i=>i.rcpNo===id&&i.bodyUrl===record.url))continue;
  try{const events=await selections.run(record.frame,'poll');handleGroupEvents(id,record.frame,events);}catch{}
 }
 if(win&&!win.isDestroyed())editorTimer=setTimeout(pollEditors,selections.EDIT_POLL_MS);
}
async function flushGroupEdits(){
 if(selectionLocked())return;
 if(manualMode)await drainManual(manualMode);
 for(const [id,record] of editorFrames){
  if(manualMode?.id===id||record.frame.isDestroyed()||record.epoch!==generation)continue;
  try{handleGroupEvents(id,record.frame,await selections.run(record.frame,'poll'));}catch{}
 }
}
async function restoreSelections(id) {
 const epoch=generation,entry=entries.get(id);if(!entry||exportBusy)return;
 const frame=await tables.bodyFrame(entry.site.webContents);if(epoch!==generation)return;
 await syncFrame(id,frame);
 if(manualMode?.id===id){const data=await toc.inspect(entry.site.webContents);if(!data.current||!await toc.matches(entry.site.webContents,data.current))return;manualMode.frame=frame;manualMode.node=data.current;await selections.run(frame,'mode',{on:true});}
 publish();
}
async function drainManual(mode) {
 if(!mode?.frame||mode.frame.isDestroyed())return;
 const frame=mode.frame,node=mode.node;
 const events=await selections.run(frame,'poll');if(!events.length||mode.epoch!==generation||!entries.has(mode.id))return;
 handleGroupEvents(mode.id,frame,events);
 if(events.every(e=>e.kind==='group'))return;
 if(mode.frame!==frame||!await toc.matches(entries.get(mode.id).site.webContents,node)){selectionMessage='본문 이동 중 선택은 취소되었습니다. 새 본문에서 다시 선택하세요.';return;}
 const card=scene.cards.find(c=>c.rcpNo===mode.id),year=yearOverrides.get(mode.id)||selections.reportYear(card);
 for(const descriptor of events){if(descriptor.kind==='group')continue;if(descriptor.error){selectionMessage=descriptor.error;continue;}selectedTables.toggle(card,node,frame.url,descriptor,year);}
 await syncFrame(mode.id,frame);selectionMessage=`선택 표 ${selectedTables.items.length}개 · 연도별 선택 순번으로 그룹을 지정합니다.`;publish();
}
async function stopManual() {
 clearTimeout(manualTimer);const mode=manualMode;manualMode=null;
 if(mode?.frame&&!mode.frame.isDestroyed()){try{await selections.run(mode.frame,'mode',{on:false});await drainManual(mode);}catch{}}
}
async function toggleManual(id) {
 if(searchBusy||exportBusy||selectionBusy||loading)return;
 selectionBusy=true;publish();
 try{
  if(manualMode?.id===id){await stopManual();return;}
  await stopManual();await cancelPick();const entry=entries.get(id),card=scene.cards.find(c=>c.rcpNo===id);
  if(!entry||card.status!=='열림')throw new Error('보고서가 아직 준비되지 않았습니다.');
  if(!yearOverrides.get(id)&&!selections.reportYear(card))throw new Error('선택 표 탭에서 이 보고서의 연도를 먼저 지정하세요.');
  const data=await toc.inspect(entry.site.webContents),frame=await tables.bodyFrame(entry.site.webContents);
  if(!data.current||!await toc.matches(entry.site.webContents,data.current))throw new Error('현재 목차와 본문을 확인하지 못했습니다. 목차를 먼저 여세요.');
  const mode={id,frame,node:data.current,epoch:generation};manualMode=mode;await syncFrame(id,frame);await selections.run(frame,'mode',{on:true});selectionMessage='표 선택 ON · 표를 클릭하면 추가, 다시 클릭하면 취소합니다.';publish();
  const poll=async()=>{if(manualMode!==mode||mode.epoch!==generation)return;
   try{await drainManual(mode);}catch(e){if(!mode.frame?.isDestroyed())selectionMessage=e.message;}
   if(manualMode===mode)manualTimer=setTimeout(poll,selections.POLL_MS);
  };manualTimer=setTimeout(poll,selections.POLL_MS);
 }catch(e){selectionMessage=e.message;}finally{selectionBusy=false;publish();}
}
async function showSelection(id) {
 if(searchBusy||exportBusy||selectionBusy)return;await stopManual();await cancelPick();
 const item=selectedTables.items.find(i=>i.id===id);if(!item)return;
 selectionBusy=true;publish();const epoch=generation;
 try{
  const card=scene.cards.find(c=>c.rcpNo===item.rcpNo),entry=entries.get(item.rcpNo);if(!entry||card.status!=='열림')throw new Error('보고서가 아직 준비되지 않았습니다.');
  if(!await toc.matches(entry.site.webContents,item.node)){const data=await toc.inspect(entry.site.webContents),node=data.nodes.find(n=>n.id===item.node.id&&Object.keys(item.node.doc).every(k=>n.doc[k]===item.node.doc[k]));if(!node)throw new Error('원문 목차가 변경되었습니다. 표를 다시 선택하세요.');await toc.open(entry.site.webContents,node,()=>epoch===generation);}
  const frame=await tables.bodyFrame(entry.site.webContents);if(frame.url!==item.bodyUrl)throw new Error('원문 주소가 변경되었습니다. 다시 선택하세요.');
  selected=item.rcpNo;centerOn(scene,card,viewport);stage.addChildView(entry.group);layout(false,'view');await syncFrame(item.rcpNo,frame);await selections.run(frame,'show',item);item.error='';selectionMessage='선택 표의 원문 위치로 이동했습니다.';
 }catch(e){item.error=e.message;selectionMessage=e.message;}finally{selectionBusy=false;publish();}
}
async function removeSelection(id) {
 if(searchBusy||exportBusy||selectionBusy)return;await stopManual();const item=selectedTables.items.find(i=>i.id===id);if(!item)return;selectedTables.remove(id);
 try{const frame=await tables.bodyFrame(entries.get(item.rcpNo).site.webContents);await syncFrame(item.rcpNo,frame);}catch{}
 selectionMessage='선택을 취소했습니다. 다른 표의 그룹은 유지합니다.';publish();
}
async function exportSelections() {
 if(searchBusy||exportBusy||selectionBusy||loading)return;await stopManual();await cancelPick();if(!selectedTables.items.length){selectionMessage='먼저 표를 선택하세요.';publish();return;}
 exportBusy=true;publish();const epoch=generation,current=()=>epoch===generation&&win&&!win.isDestroyed();
 try{
  const answer=await dialog.showSaveDialog(win,{title:'선택 표 엑셀 저장',defaultPath:'선택한_보고서_표.xlsx',filters:[{name:'Excel 통합 문서',extensions:['xlsx']}]});if(answer.canceled||!answer.filePath){selectionMessage='저장을 취소했습니다.';return;}
  const destination=/\.xlsx$/i.test(answer.filePath)?answer.filePath:answer.filePath+'.xlsx';
  const readTable=async item=>{
   const url=new URL(item.bodyUrl);if(url.protocol!=='https:'||url.hostname!=='dart.fss.or.kr'||url.pathname!=='/report/viewer.do'||url.username||url.password||url.port)throw new Error('선택 원문 주소가 유효하지 않습니다.');
   let frame;const entry=entries.get(item.rcpNo);
   try{const live=await tables.bodyFrame(entry.site.webContents);if(live.url===item.bodyUrl)frame=live;}catch{}
   if(!frame){
    if(!scratch){scratch=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'persist:report-canvas',backgroundThrottling:false}});scratch.webContents.setUserAgent(app.userAgentFallback);scratch.webContents.setWindowOpenHandler(()=>({action:'deny'}));}
    if(scratch.webContents.getURL()!==item.bodyUrl){let timer;try{await Promise.race([scratch.webContents.loadURL(item.bodyUrl),new Promise((_,reject)=>{timer=setTimeout(()=>{scratch.webContents.stop();reject(new Error('원문 읽기 시간이 초과되었습니다.'));},LOAD_TIMEOUT_MS);})]);}finally{clearTimeout(timer);}}
    frame=scratch.webContents.mainFrame;
   }
   return selections.run(frame,'read',item);
  };
  await writeSelections([...selectedTables.items],destination,readTable,(done,total)=>{selectionMessage=`엑셀 저장 중 ${done}/${total}개`;publish();},current);
  selectedTables.items.forEach(i=>i.error='');selectionMessage='엑셀 저장 완료: '+destination;
 }catch(e){const item=selectedTables.items.find(i=>i.id===e.selectionId);if(item)item.error=e.message;selectionMessage='엑셀 저장 실패: '+e.message;}
 finally{if(scratch&&!scratch.webContents.isDestroyed())scratch.webContents.close();scratch=null;exportBusy=false;publish();}
}
function authorized(event) { return trusted.has(event.sender.id); }
ipcMain.handle('canvas:state', event => authorized(event) ? snapshot() : null);
ipcMain.handle('canvas:command', async (event, action, id, payload) => {
  if (!authorized(event)) return;
  // Enter 직후 저장/검색을 눌러도 아직 큐에 있는 그룹 변경을 먼저 반영합니다.
  if(['manual-select','selection-show','selection-remove','selection-group','export-selections','refresh','pick-table','search-table','table-accept','table-reject','table-retry','table-rescan','table-broad'].includes(action))await flushGroupEdits();
  const card = scene.cards.find(value => value.rcpNo === id);
  if(action==='manual-select'){await toggleManual(id);return snapshot();}
  if(action==='selection-show'){await showSelection(id);return snapshot();}
  if(action==='selection-remove'){await removeSelection(id);return snapshot();}
  if(action==='export-selections'){await exportSelections();return snapshot();}
  if(action==='selection-group'){if(!selectionLocked())try{changeGroup(id,payload?.group);}catch(e){selectionMessage=e.message;}publish();return snapshot();}
  if(action==='report-year'){if(card&&!searchBusy&&!exportBusy&&!selectionBusy&&!selectedTables.items.some(i=>i.rcpNo===id)){const year=Number(payload?.year);if(Number.isInteger(year)&&year>=1900&&year<=9999)yearOverrides.set(id,year);else selectionMessage='보고서 연도는 1900~9999 사이의 정수로 지정하세요.';}publish();return snapshot();}
  if(exportBusy||selectionBusy)return snapshot();
  if (action === 'refresh') return refresh();
  if (action === 'table-options') {
    if(tableReference&&id===tableReference.sourceId&&!searchBusy)try{const options=tables.validateOptions(tableReference,payload?.section,payload?.keywords);tableReference.section=options.section;tableReference.keywords=options.keywords;searchMessage='검색 조건을 저장했습니다.';}catch(failure){searchMessage=failure.message;}
    publish();return snapshot();
  }
  if (action === 'pick-table') {await togglePick(id);return snapshot();}
  if (action === 'search-table') {await startTableSearch(id,payload);return snapshot();}
  if (['table-accept','table-reject','table-retry','table-rescan','table-broad'].includes(action)) {await judgeTable(action,id);return snapshot();}
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
  win.on('closed', () => { generation++;searchJob++;clearTimeout(pickTimer);clearTimeout(manualTimer);clearTimeout(editorTimer);manualMode=null;tablePicking=null;if(scratch&&!scratch.webContents.isDestroyed())scratch.webContents.close();scratch=null;dispose(); if (!overlay.webContents.isDestroyed()) overlay.webContents.close(); if (!backdrop.webContents.isDestroyed()) backdrop.webContents.close(); });
  editorTimer=setTimeout(pollEditors,selections.EDIT_POLL_MS);
  await refresh();
});
app.on('window-all-closed', () => app.quit());
