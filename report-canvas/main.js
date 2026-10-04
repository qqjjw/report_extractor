const { app, BrowserWindow, WebContentsView, View, ipcMain } = require('electron');
const path = require('node:path');
const { readReports, createScene, arrange, resize, applySize, zoomTo } = require('./lib/scene');

// ===== 입력값: 수집 앱의 JSON 위치·웹 화면 크롬·동시 로드 수 =====
const REPORTS_FILE = path.resolve(__dirname, '..', 'data', 'reports.json');
const TOOLBAR_HEIGHT = 96;
const CARD_HEADER = 68;
const CARD_FOOTER = 30;
const LOAD_CONCURRENCY = 3;
const LOAD_TIMEOUT_MS = 45000;
const REMOVED_PRODUCTS = /\s(?:Electron|dart-report-canvas)\/\S+/gi;
const localPreferences = { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false };
let win, stage, backdrop, overlay, scene = createScene([]), entries = new Map(), trusted = new Set(), loading = false, error = '', generation = 0, gesture;

// ===== 처리 로직: 네이티브 웹 화면은 캔버스 좌표에 맞춰 이동 =====
const snapshot = () => ({ cards: scene.cards, zoom: scene.zoom, pan: scene.pan, loading, error, file: REPORTS_FILE });
function send(contents, channel, value) { if (!contents.isDestroyed()) contents.send(channel, value); }
function publish() {
  if (!win || win.isDestroyed()) return;
  send(win.webContents, 'canvas:state', snapshot());
  if (backdrop) send(backdrop.webContents, 'canvas:state', snapshot());
  scene.cards.forEach(card => { const entry = entries.get(card.rcpNo); if (entry) { entry.site.setVisible(!card.error); send(entry.chrome.webContents, 'canvas:card', card); } });
}
function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  stage.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
  backdrop.setBounds({ x: 0, y: 0, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
  overlay.setBounds({ x: 0, y: 0, width, height });
  scene.cards.forEach(card => {
    const entry = entries.get(card.rcpNo); if (!entry) return;
    const z = scene.zoom;
    const x = Math.round(scene.pan.x + card.x * z), y = Math.round(scene.pan.y + card.y * z);
    const w = Math.round(card.width * z), h = Math.round(card.height * z);
    entry.group.setBounds({ x, y, width: w, height: h });
    entry.chrome.setBounds({ x: 0, y: 0, width: w, height: h });
    entry.group.setVisible(x < width && x + w > 0 && y < height - TOOLBAR_HEIGHT && y + h > 0);
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
  const epoch = ++generation; cancelGesture(); dispose(); scene = createScene(reports);
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
function authorized(event) { return trusted.has(event.sender.id); }
ipcMain.handle('canvas:state', event => authorized(event) ? snapshot() : null);
ipcMain.handle('canvas:command', async (event, action, id) => {
  if (!authorized(event)) return;
  const card = scene.cards.find(value => value.rcpNo === id);
  if (action === 'refresh') return refresh();
  if (action === 'align' || action === 'asc' || action === 'desc') arrange(scene, action);
  else if (action === 'zoom-in') zoomTo(scene, scene.zoom + 0.1);
  else if (action === 'zoom-out') zoomTo(scene, scene.zoom - 0.1);
  else if (action === 'zoom-reset') zoomTo(scene, 1);
  else if (action === 'apply-size' && card) applySize(scene, card);
  else if (action === 'retry' && card && card.status !== '불러오는 중' && !loading) await loadSite(card, generation);
  layout(); publish(); return snapshot();
});
ipcMain.on('canvas:begin', (event, request) => {
  if (!authorized(event) || !request || !['pan', 'move', 'resize'].includes(request.kind) || !Number.isFinite(request.x) || !Number.isFinite(request.y)) return;
  const card = scene.cards.find(value => value.rcpNo === request.id);
  if (request.kind !== 'pan' && !card) return;
  gesture = { ...request, owner: event.sender.id, card, start: card ? { ...card } : { ...scene.pan } };
  if (card) stage.addChildView(entries.get(card.rcpNo).group);
  win.contentView.addChildView(overlay); overlay.setVisible(true); overlay.webContents.focus();
  send(overlay.webContents, 'canvas:gesture', request.kind);
});
ipcMain.on('canvas:move', (event, request) => {
  if (!gesture || (event.sender !== overlay.webContents && event.sender.id !== gesture.owner) || !Number.isFinite(request.x) || !Number.isFinite(request.y)) return;
  const dx = request.x - gesture.x, dy = request.y - gesture.y;
  if (gesture.kind === 'pan') scene.pan = { x: gesture.start.x + dx, y: gesture.start.y + dy };
  else if (gesture.kind === 'move') { gesture.card.x = gesture.start.x + dx / scene.zoom; gesture.card.y = gesture.start.y + dy / scene.zoom; }
  else resize(gesture.card, gesture.start.width + dx / scene.zoom, gesture.start.height + dy / scene.zoom);
  layout(); if (request.end) { cancelGesture(); publish(); }
});
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
  layout(); win.on('resize', layout); win.on('blur', cancelGesture);
  win.on('closed', () => { generation++; dispose(); if (!overlay.webContents.isDestroyed()) overlay.webContents.close(); if (!backdrop.webContents.isDestroyed()) backdrop.webContents.close(); });
  await refresh();
});
app.on('window-all-closed', () => app.quit());
