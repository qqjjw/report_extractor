const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const XLSX = require('xlsx');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500, height: 920, minWidth: 980, minHeight: 680,
    title: 'PDF Table Picker', backgroundColor: '#080d19', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webSecurity: false }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function pythonPath() {
  const bundled = path.join(app.getPath('home'), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
  return fs.existsSync(bundled) ? bundled : 'python';
}

function runPdfTool(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath(), [path.join(__dirname, 'extract_pdf.py'), ...args], { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(stderr.trim() || `PDF 분석 실패 (${code})`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(new Error(`분석 결과 파싱 실패: ${error.message}`)); }
    });
  });
}

ipcMain.handle('load-pdfs', async () => {
  const pdfDir = path.join(__dirname, 'pdf');
  const names = fs.readdirSync(pdfDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));
  const cacheRoot = path.join(app.getPath('userData'), 'pdf-cache');
  const results = [];
  for (const name of names) {
    const stat = fs.statSync(path.join(pdfDir, name));
    const safeName = Buffer.from(`${name}:${stat.size}:${stat.mtimeMs}`).toString('base64url');
    results.push(await runPdfTool(['manifest', path.join(pdfDir, name), path.join(cacheRoot, safeName)]));
  }
  return results;
});

ipcMain.handle('parse-selection', async (_event, payload) => {
  const pdfDir = path.resolve(path.join(__dirname, 'pdf'));
  const fileName = path.basename(String(payload?.fileName || ''));
  const filePath = path.resolve(path.join(pdfDir, fileName));
  if (path.dirname(filePath) !== pdfDir || !fileName.toLowerCase().endsWith('.pdf') || !fs.existsSync(filePath)) throw new Error('PDF 파일을 찾을 수 없습니다.');
  const pageNumber = Number(payload?.pageNumber);
  const bbox = Array.isArray(payload?.bbox) ? payload.bbox.map(Number) : [];
  if (!Number.isInteger(pageNumber) || bbox.length !== 4 || bbox.some(value => !Number.isFinite(value))) throw new Error('선택 영역 정보가 올바르지 않습니다.');
  const mode = ['auto', 'lines', 'text'].includes(payload?.mode) ? payload.mode : 'auto';
  return runPdfTool(['parse', filePath, String(pageNumber), JSON.stringify(bbox), mode]);
});

ipcMain.handle('save-excel', async (_event, payload) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Excel 내보내기', defaultPath: 'pdf_tables.xlsx',
    filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
  });
  if (!filePath) return { success: false, cancelled: true };
  try {
    const tables = Array.isArray(payload?.tables) ? payload.tables : [];
    const wb = XLSX.utils.book_new();
    const ws = {};
    const files = [...new Set(tables.map(table => table.fileName))];
    const byFile = Object.fromEntries(files.map(name => [name, tables.filter(table => table.fileName === name)]));
    const colOffset = {};
    const currentRow = {};
    let currentCol = 0;
    files.forEach(name => {
      colOffset[name] = currentCol;
      currentRow[name] = 1;
      const maxCols = Math.max(1, ...byFile[name].map(table => Math.max(1, ...table.parsedData.data.map(row => row.length))));
      currentCol += maxCols + 1;
      ws[XLSX.utils.encode_cell({ r: 0, c: colOffset[name] })] = { v: name, t: 's' };
    });
    ws['!merges'] = [];
    const write = (table, row, col) => {
      table.parsedData.data.forEach((values, ri) => values.forEach((value, ci) => {
        ws[XLSX.utils.encode_cell({ r: row + ri, c: col + ci })] = { v: value, t: 's' };
      }));
      (table.parsedData.merges || []).forEach(merge => ws['!merges'].push({
        s: { r: row + merge.s.r, c: col + merge.s.c }, e: { r: row + merge.e.r, c: col + merge.e.c }
      }));
      return table.parsedData.data.length;
    };
    files.forEach(name => byFile[name].filter(table => !table.groupNo).forEach(table => {
      currentRow[name] += write(table, currentRow[name], colOffset[name]) + 1;
    }));
    const groups = [...new Set(tables.map(table => table.groupNo).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
    groups.forEach(group => {
      const start = Math.max(...files.map(name => currentRow[name]));
      files.forEach(name => {
        let row = start;
        byFile[name].filter(table => table.groupNo === group).forEach(table => { row += write(table, row, colOffset[name]) + 1; });
        currentRow[name] = Math.max(currentRow[name], row);
      });
    });
    const maxRow = Math.max(1, ...Object.values(currentRow));
    ws['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: maxRow, c: Math.max(0, currentCol - 1) });
    ws['!cols'] = Array.from({ length: currentCol }, (_, col) => {
      let width = 10;
      for (let row = 0; row <= maxRow; row++) width = Math.max(width, String(ws[XLSX.utils.encode_cell({ r: row, c: col })]?.v || '').length + 2);
      return { wch: Math.min(width, 42) };
    });
    XLSX.utils.book_append_sheet(wb, ws, 'PDF Tables');
    XLSX.writeFile(wb, filePath);
    return { success: true, path: filePath };
  } catch (error) { return { success: false, error: error.message }; }
});
