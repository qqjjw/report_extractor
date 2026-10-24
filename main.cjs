const { app, BrowserWindow, ipcMain, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { retrieve } = require('./core.cjs');
const { createDartProfile } = require('./dart-profile.cjs');
const { attachLoadTracker } = require('./load-status.cjs');
const { createLayout, reconcile, apply, parseReports, sortReports, arrange } = require('./canvas.cjs');
const root = __dirname, local = path.join(root, '.local');
fs.mkdirSync(local, { recursive: true });
app.setPath('userData', path.join(local, 'browser'));
const state = { reports: [], loaded: {}, loadErrors:{}, busy: false, results: {}, events: [], source: null, sourceMode:false, embedding: !!process.env.EMBEDDING_URL, layout: createLayout() };
const views = {};
let win, profile, server;
const fileReports = () => parseReports(fs.readFileSync(path.join(root, 'reports.json'), 'utf8'));
function publish() { if (win && !win.isDestroyed()) win.webContents.send('update', state); }
function publishLayout() { if (win && !win.isDestroyed()) win.webContents.send('layout', state.layout); }
function log(event) {
  const entry = { time: new Date().toISOString(), ...event };
  state.events = [...state.events.slice(-79), entry];
  fs.appendFileSync(path.join(local, 'search.jsonl'), JSON.stringify(entry) + '\n');
  publish();
}
function snapshot() {
  return { ...state, results: Object.fromEntries(Object.entries(state.results).map(([id, r]) => [id, { status: r.status, count: r.count, selected: r.selected, message: r.message, verification: r.verification, position:r.evidence?.position }])), events: state.events.slice(-5) };
}
function targetId(args = {}) {
  const id = args.report !== undefined ? String(args.report) : args.target !== undefined && args.target !== 'both' ? state.reports[Number(args.target)]?.rcpNo : state.layout.active || state.reports[0]?.rcpNo;
  if (!state.layout.windows[id]) throw Error('보고서 ID 또는 target 번호를 확인하세요.');
  return id;
}
function syncZoom(id) {
  const wc = views[id]?.webContents;
  if (wc && !wc.isDestroyed()) wc.setZoomFactor(state.layout.windows[id].zoom * state.layout.canvas.zoom);
}
function layoutCommand(action, args = {}) {
  if(action==='panel-resize' || (action==='panel-toggle' && (args.collapsed===false || args.collapsed==='false' || (args.collapsed===undefined && state.layout.panels[args.side]?.collapsed)))) {
    const other=state.layout.panels[args.side==='left'?'right':'left'];
    const available=win.getContentSize()[0]-(other.collapsed?36:other.width)-360;
    if(action==='panel-resize') args={...args,width:Math.min(Number(args.width),available)};
    else if(state.layout.panels[args.side]) state.layout.panels[args.side].width=Math.min(state.layout.panels[args.side].width,Math.max(220,available));
  }
  const id = action.startsWith('window-') || action === 'site-zoom' ? targetId(args) : undefined;
  apply(state.layout, action, args, id);
  if (action === 'canvas-zoom') Object.keys(views).forEach(syncZoom);
  else if (action === 'site-zoom') syncZoom(id);
  publishLayout();
  return state.layout;
}
function reloadReports() {
  const reports = sortReports(fileReports(), state.layout.sortDirection);
  const old = state.reports;
  reconcile(state.layout, old, reports);
  const keep = new Map(reports.map(r => [r.rcpNo, r.url]));
  for (const r of old) if (keep.get(r.rcpNo) !== r.url) {
    const wc = views[r.rcpNo]?.webContents;
    if (wc && !wc.isDestroyed()) wc.close();
    delete views[r.rcpNo]; delete state.results[r.rcpNo]; delete state.loaded[r.rcpNo];
    delete state.loadErrors[r.rcpNo];
    if(state.source?.report===r.rcpNo)state.source=null;
  }
  state.reports = reports;
  reports.forEach(r => { if (!(r.rcpNo in state.loaded)) state.loaded[r.rcpNo] = false; });
  log({ action: 'JSON 다시 불러오기', count: reports.length });
  return { count: reports.length, reports };
}
function getCandidate(id, candidateId) {
  const result = state.results[id];
  const candidate = result?.candidates?.find(c => c.id === (candidateId || result.selected));
  if (!candidate) throw Error('먼저 검색하고 선별된 후보 ID를 지정하세요.');
  if (candidate.chars > profile.maxChunkChars || result.status === 'refine_chunk') throw Error('더 작은 목차나 검색 대상을 선택하세요.');
  return candidate;
}
const layoutActions = new Set(['window-move', 'window-resize', 'window-focus', 'window-raise', 'canvas-pan', 'canvas-zoom', 'canvas-viewport', 'site-zoom', 'panel-resize', 'panel-toggle']);
function setSourceMode(enabled){
  state.sourceMode=enabled;
  for(const view of Object.values(views))if(!view.webContents.isDestroyed())view.webContents.send('source-mode',enabled);
  publish();return {sourceMode:enabled};
}
async function command(action, args = {}) {
  if (layoutActions.has(action)) return layoutCommand(action, args);
  if(action==='source-get')return state.source;
  if(action==='source-mode')return setSourceMode(args.enabled===undefined?!state.sourceMode:args.enabled===true||args.enabled==='true');
  if (state.busy) throw Error('현재 탐색 중입니다. 완료 후 다시 요청하세요.');
  state.busy = true; publish();
  try {
    if(action==='source-clear'){
      if(state.source)await profile.clearSource(state.source.report);
      state.source=null;setSourceMode(false);return {cleared:true};
    }
    if(action==='source-show'||action==='source-read'){
      if(!state.source)throw Error('먼저 기준 표를 선택하세요.');
      const source=state.source;
      layoutCommand('window-focus',{report:source.report});
      await profile.focus(source.report,source.candidate,'source');
      if(action==='source-show')return source;
      if(source.candidate.chars>profile.maxChunkChars)throw Error('기준 표가 읽기 예산을 초과했습니다. 더 작은 표를 선택하세요.');
      return await profile.read(source.report,source.candidate);
    }
    if (action === 'reports-reload') return reloadReports();
    if (action === 'reports-sort') {
      const reports=sortReports(state.reports,args.direction);
      state.reports=reports; state.layout.sortDirection=args.direction;
      arrange(state.layout,reports);
      if (state.layout.active) apply(state.layout,'window-focus',{},state.layout.active);
      log({action:'접수일 정렬',direction:args.direction}); publishLayout();
      return {direction:args.direction,reports};
    }
    const id = targetId(args);
    layoutCommand('window-focus', { report: id });
    if (!views[id]) throw Error('보고서 로딩 후 다시 요청하세요.');
    if(action==='report-retry'){
      const wc=views[id].webContents, failure=state.loadErrors[id];
      wc.stop();
      if(failure?.isMainFrame)wc.loadURL(state.reports.find(r=>r.rcpNo===id).url).catch(()=>{});
      else await wc.executeJavaScript(`(()=>{const f=document.getElementById('ifrm');if(f?.src){f.src=f.src;}else{location.reload();}})()`);
      return {report:id,retrying:true};
    }
    if(state.loadErrors[id]&&!['report-info','report-reload'].includes(action))throw Error(state.loadErrors[id].message+' 보고서의 다시 시도를 누르세요.');
    if(action==='result-show'){
      const match=String(args.id||'').match(/^([^:]+):table:(\d+)$/);
      if(!match)throw Error('저장된 후보 ID를 지정하세요.');
      await profile.open(id,match[1]);
      const candidate=await profile.describe(id,Number(match[2]));
      if(candidate.chars>profile.maxChunkChars)throw Error('표가 읽기 예산을 초과했습니다.');
      await profile.focus(id,candidate);
      const evidence=await profile.read(id,candidate);
      if(args.hash&&args.hash!==evidence.hash)throw Error('표 내용이 기존 결과와 다릅니다. 다시 검색하세요.');
      state.results[id]={status:'evidence_ready',count:1,candidates:[candidate],selected:candidate.id,query:args.query||'',evidence};
      log({report:id,action:'저장된 결과 표시',location:candidate.id,hash:evidence.hash});
      return {report:id,selected:candidate.id,position:evidence.position,hash:evidence.hash};
    }
    if(action==='source-select'){
      const candidate=args.id?getCandidate(id,args.id):await profile.describe(id,Number(args.table));
      if(args.url&&candidate.url!==args.url)throw Error('본문이 바뀌었습니다. 표를 다시 선택하세요.');
      if(state.source)await profile.clearSource(state.source.report);
      const position=await profile.focus(id,candidate,'source');
      state.source={report:id,reportName:state.reports.find(r=>r.rcpNo===id).reportName,candidate,position};
      setSourceMode(false);
      log({report:id,action:'기준 표 선택',location:candidate.id,rows:candidate.rows,chars:candidate.chars});
      return state.source;
    }
    if(action==='report-info')return await views[id].webContents.executeJavaScript(`({url:location.href,frames:[...document.querySelectorAll('iframe')].map(f=>{try{return {src:f.src,url:f.contentWindow.location.href,ready:f.contentDocument.readyState,chars:f.contentDocument.body?.textContent.length,scrollY:f.contentWindow.scrollY,tables:f.contentDocument.querySelectorAll('table').length}}catch(e){return {src:f.src,error:e.message}}})})`);
    if(action==='report-reload'){views[id].webContents.stop();views[id].webContents.reload();delete state.results[id];return {report:id,reloading:true};}
    if (action === 'toc') return await profile.indexes(id, args.query || '');
    if (action === 'open') {
      const index = (await profile.indexes(id, '')).find(i => i.id === String(args.id));
      if (!index) throw Error('목차 ID를 확인하세요.');
      await profile.open(id, index.id);
      log({ report: id, action: 'AI 목차 이동', location: index.id, title: index.title });
      return index;
    }
    if (action === 'search') {
      const ids = args.target === 'both' && !args.report ? state.reports.slice(0, 2).map(r => r.rcpNo) : [id];
      const results = {};
      for (const report of ids) {
        layoutCommand('window-focus', { report });
        delete state.results[report];
        try {
          results[report] = await retrieve({ profile, target: report, query: args.query || '', indexQuery: args.indexQuery || '', k: Number(args.k || 5), emit: e => log({ ...e, report }) });
          results[report].query = args.query;
          state.results[report] = results[report];
          log({ report, step: 7, action: '검색 기록', status: results[report].status, count: results[report].count, location: results[report].selected || null });
        } catch (error) {
          results[report] = { status: 'error', message: error.message, candidates: [] };
          state.results[report] = results[report];
          log({ report, action: '탐색 오류', message: error.message });
        }
      }
      return results;
    }
    if (action === 'read' || action === 'verify') {
      const candidate = getCandidate(id, args.id);
      await profile.focus(id, candidate);
      const evidence = await profile.read(id, candidate);
      const result = state.results[id];
      Object.assign(result, { selected: candidate.id, evidence, status: 'evidence_ready' });
      if (action === 'read') {
        log({ report: id, action: 'AI 원문 읽기', location: candidate.id, hash: evidence.hash });
        return evidence;
      }
      const required = [args.term || result.query, args.year, args.basis, args.unit].filter(Boolean);
      const source = (evidence.sectionTitle + '\n' + evidence.context + '\n' + evidence.text).replace(/\s+/g, '');
      const checks = required.map(term => ({ term, found: source.includes(String(term).replace(/\s+/g, '')) }));
      const checked = checks.length > 0 && checks.every(c => c.found);
      const verification = { checked, checks, note: '원문 내 조건 존재 확인. 값·열 대응 및 회계적 적합성은 원문으로 확인하세요.' };
      Object.assign(result, { status: checked ? 'conditions_matched' : 'verification_failed', verification });
      log({ report: id, step: 6, action: '원문 조건 검증', location: candidate.id, hash: evidence.hash, checks, checked });
      return verification;
    }
    throw Error('지원하지 않는 동작입니다.');
  } finally { state.busy = false; publish(); }
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1600, height: 980, minWidth: 1000, minHeight: 640, title: 'DART · 로컬 탐색', backgroundColor: '#f5f3ed', webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, webviewTag: true } });
  win.setMenu(null);
  profile = createDartProfile(views);
  reloadReports();
  if(app.commandLine.hasSwitch('recover-layout'))state.layout=JSON.parse(fs.readFileSync(path.join(local,'layout-recovery.json'),'utf8'));
  ipcMain.handle('state', () => state);
  ipcMain.handle('command', (_, action, args) => command(action, args));
  ipcMain.handle('bind-guest', (event, id, guestId) => {
    const wc = webContents.fromId(guestId);
    if (event.sender !== win.webContents || wc?.hostWebContents !== win.webContents || !state.layout.windows[id]) throw Error('사이트 연결 실패');
    if (views[id]?.webContents === wc) return;
    views[id] = { webContents: wc };
    wc.setZoomMode('isolated'); syncZoom(id);
    wc.on('dom-ready',()=>wc.send('source-mode',state.sourceMode));
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    attachLoadTracker(wc,{
      isCurrent:()=>views[id]?.webContents===wc,
      onChange:({loaded,error})=>{
        state.loaded[id]=loaded;
        const previous=state.loadErrors[id];
        if(error){
          state.loadErrors[id]=error;
          if(state.results[id]?.evidence?.position)state.results[id].evidence.position.visible=false;
          if(state.source?.report===id)state.source.position.visible=false;
          if(!previous||previous.code!==error.code||previous.url!==error.url)log({report:id,action:'접속 오류',message:error.message,code:error.code});
          else publish();
        }else{delete state.loadErrors[id];publish();}
      }
    });
    wc.on('destroyed', () => { if (views[id]?.webContents === wc) { delete views[id]; state.loaded[id] = false; } });
  });
  win.webContents.on('will-attach-webview', (event, prefs, params) => {
    if (!state.reports.some(r => r.url === params.src)) { event.preventDefault(); return; }
    prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true;
    prefs.preload = path.join(root, 'site-preload.cjs');
  });
  ipcMain.on('site-input', (event, input) => {
    const id = Object.keys(views).find(id => views[id].webContents === event.sender);
    if (!id) return;
    if (input.type === 'focus') layoutCommand('window-raise', { report: id });
    else if(input.type==='source')command('source-select',{report:id,table:input.tableIndex,url:input.url}).catch(error=>log({report:id,action:'기준 표 선택 실패',message:error.message}));
    else if (input.type === 'zoom' && Number.isFinite(input.delta)) layoutCommand('site-zoom', { report: id, ratio: state.layout.windows[id].zoom + (input.delta > 0 ? -0.1 : 0.1) });
  });
  await win.loadFile('index.html');
  win.on('resize',()=>{
    const room=win.getContentSize()[0]-360, panels=state.layout.panels;
    if((panels.left.collapsed?36:panels.left.width)+(panels.right.collapsed?36:panels.right.width)>room){
      const max=(room-(panels.left.collapsed||panels.right.collapsed?36:0))/(panels.left.collapsed||panels.right.collapsed?1:2);
      Object.values(panels).forEach(p=>{if(!p.collapsed)p.width=Math.max(220,Math.min(p.width,max));});publishLayout();
    }
  });
  const token = randomBytes(24).toString('hex');
  server = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (request.headers.authorization !== 'Bearer ' + token) { response.writeHead(401); response.end('{}'); return; }
    try {
      if (request.method === 'GET' && request.url === '/state') { response.end(JSON.stringify(snapshot())); return; }
      if (request.method !== 'POST' || request.url !== '/command') { response.writeHead(404); response.end('{}'); return; }
      let body = '';
      for await (const chunk of request) { body += chunk; if (body.length > 12000) throw Error('요청이 너무 큽니다.'); }
      const { action, args } = JSON.parse(body);
      response.end(JSON.stringify(await command(action, args)));
    } catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: error.message })); }
  });
  server.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(path.join(local, 'bridge.json'), JSON.stringify({ port: server.address().port, token }));
    log({ action: 'AI 로컬 제어 준비' });
  });
  win.on('closed', () => { Object.values(views).forEach(v => { if (!v.webContents.isDestroyed()) v.webContents.close(); }); server?.close(); app.quit(); });
});
app.on('window-all-closed', () => app.quit());
