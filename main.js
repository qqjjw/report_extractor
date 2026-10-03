const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require('electron');
const path = require('node:path');
const { parseReports, mergeReports } = require('./lib/reports');
const { ReportStore } = require('./lib/store');
const { Capture } = require('./lib/capture');
const { connectDart } = require('./lib/connection');
const { browserUserAgent } = require('./lib/user-agent');
const store = new ReportStore(path.join(__dirname, 'data', 'reports.json'));
let win, dart, capture, reports = [], error = '', connectionError = '', connecting = false, notice = '추출을 켠 후 DART에서 검색하세요.', quitting = false;
const state = () => ({ reports, enabled: capture?.enabled || false, error: [error, connectionError].filter(Boolean).join('\n'), connecting, notice, file: store.file });
function publish() { if (win && !win.isDestroyed()) win.webContents.send('state-update', state()); }
async function reconnect() {
  if (connecting || !dart || dart.webContents.isDestroyed()) return state();
  connecting = true; connectionError = ''; capture.reset(); publish();
  try {
    const connected = await connectDart(dart.webContents, message => { notice = message; publish(); });
    if (connected) { connectionError = ''; notice = 'DART 연결 완료 · 추출을 켠 후 검색하세요.'; }
  } catch (e) {
    connectionError = `DART 접속 실패: ${e.message}\nDART 다시 연결을 눌러 재시도하세요.`;
  } finally { connecting = false; publish(); }
  return state();
}
function save() {
  notice = '저장 중…'; publish();
  return store.save(reports).then(() => { notice = '현재 목록을 저장했습니다.'; publish(); })
    .catch(e => { error = `저장 실패: ${e.message}`; publish(); });
}
function layout() {
  const [width, height] = win.getContentSize();
  dart.setBounds({ x: 0, y: 64, width: Math.max(0, width - 430), height: Math.max(0, height - 64) });
}
app.whenReady().then(async () => {
  app.userAgentFallback = browserUserAgent(app.userAgentFallback);
  try { reports = await store.load(); } catch (e) { error = `목록 복원 실패: ${e.message}`; }
  win = new BrowserWindow({ width: 1500, height: 950, minWidth: 1000, minHeight: 600,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  dart = new WebContentsView({ webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:dart' } });
  dart.webContents.session.setUserAgent(app.userAgentFallback);
  dart.webContents.setUserAgent(app.userAgentFallback);
  win.contentView.addChildView(dart); layout(); win.on('resize', layout);
  dart.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: {
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  } }));
  capture = new Capture(dart.webContents.debugger, incoming => {
    error = ''; reports = mergeReports(reports, incoming);
    if (incoming.length) save(); else { notice = '이번 응답에 보고서가 없습니다.'; publish(); }
  }, message => { error = message; publish(); }, parseReports);
  dart.webContents.debugger.on('message', (_, method, params) => { capture.message(method, params); });
  dart.webContents.debugger.on('detach', () => { capture.setEnabled(false); error = '응답 수집 연결이 끊겼습니다. 앱을 다시 실행하세요.'; publish(); });
  ipcMain.handle('state', () => state());
  ipcMain.handle('reconnect', () => reconnect());
  ipcMain.handle('toggle', () => {
    if (!dart.webContents.debugger.isAttached()) { error = '응답 수집 연결이 없습니다. 앱을 다시 실행하세요.'; }
    else { capture.setEnabled(!capture.enabled); notice = capture.enabled ? '추출 ON · DART에서 검색하거나 페이지를 이동하세요.' : '추출 OFF'; }
    publish(); return state();
  });
  ipcMain.handle('remove', (_, id) => { reports = reports.filter(r => r.rcpNo !== id); save(); return state(); });
  ipcMain.handle('clear', () => { capture.reset(); reports = []; save(); return state(); });
  ipcMain.handle('open-report', (_, id) => { const report = reports.find(r => r.rcpNo === id); if (report) return shell.openExternal(report.url); });
  await win.loadFile(path.join(__dirname, 'index.html'));
  dart.webContents.on('did-fail-load', (_, code, message, url, mainFrame) => {
    if (mainFrame && code !== -3 && !connecting) { connectionError = `DART 로드 실패: ${message}\nDART 다시 연결을 눌러 재시도하세요.`; publish(); }
  });
  dart.webContents.on('did-finish-load', () => { connectionError = ''; publish(); });
  const load = reconnect();
  try { dart.webContents.debugger.attach('1.3'); await dart.webContents.debugger.sendCommand('Network.enable'); }
  catch (e) { error = `응답 수집 연결 실패: ${e.message}`; publish(); }
  await load;
  win.on('closed', () => { if (!dart.webContents.isDestroyed()) dart.webContents.close(); });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  store.queue.finally(() => app.quit());
});
