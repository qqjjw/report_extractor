'use strict';

let reports = [];
let framePreloadPath = '';
const frames = [];

const viewport = document.getElementById('canvas-viewport');
const world = document.getElementById('canvas-world');
const btnLoad = document.getElementById('btn-load');
const btnEmptyLoad = document.getElementById('btn-empty-load');
const btnExport = document.getElementById('btn-export');
const btnClear = document.getElementById('btn-clear');
const btnFit = document.getElementById('btn-fit');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const zoomLabel = document.getElementById('zoom-label');
const btnSelectionPanel = document.getElementById('btn-selection-panel');
const btnPanelClose = document.getElementById('btn-panel-close');
const countEl = document.getElementById('selection-count');
const selectionSummary = document.getElementById('selection-summary');
const selectionList = document.getElementById('selection-list');
const emptyState = document.getElementById('empty-state');
const canvasStatus = document.getElementById('canvas-status');
const reportCount = document.getElementById('report-count');
const loadingEl = document.getElementById('loading-overlay');
const loadingTxt = document.getElementById('loading-text');
const toastEl = document.getElementById('toast');

let worldX = 0;
let worldY = 0;
let worldScale = 1;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let toastTimer;

(async function init() {
    try {
        framePreloadPath = await window.electronAPI.getFramePreloadPath();
    } catch (error) {
        showToast(`초기화 실패: ${error.message}`, true);
    }
    applyWorldTransform();
    updateSelectionUI();
})();

btnLoad.addEventListener('click', loadReports);
btnEmptyLoad.addEventListener('click', loadReports);
btnExport.addEventListener('click', exportToExcel);
btnClear.addEventListener('click', clearSelections);
btnFit.addEventListener('click', fitAllFrames);
btnZoomIn.addEventListener('click', () => zoomAtViewportCenter(1.2));
btnZoomOut.addEventListener('click', () => zoomAtViewportCenter(1 / 1.2));
zoomLabel.addEventListener('click', () => setZoomAtViewportCenter(1));
btnSelectionPanel.addEventListener('click', toggleSelectionPanel);
btnPanelClose.addEventListener('click', () => setSelectionPanel(false));

async function loadReports() {
    if (getSelectedCount() > 0 && !confirm('현재 선택을 지우고 보고서를 다시 불러올까요?')) return;

    setLoading(true, '보고서 목록을 읽는 중...');
    btnLoad.disabled = true;
    try {
        const loaded = await window.electronAPI.readJson();
        reports = Array.isArray(loaded) ? loaded : [];
        clearFrames();

        const sorted = [...reports].sort((a, b) => extractYear(a) - extractYear(b));
        const frameWidth = 1120;
        const frameHeight = 1440;
        const gap = 56;

        sorted.forEach((report, index) => {
            loadingTxt.textContent = `보고서 준비 중 ${index + 1} / ${sorted.length}`;
            frames.push(createReportFrame(report, 36 + index * (frameWidth + gap), 36, frameWidth, frameHeight));
        });

        emptyState.classList.toggle('hidden', frames.length > 0);
        canvasStatus.classList.toggle('hidden', frames.length === 0);
        reportCount.textContent = `${frames.length}개 보고서`;
        updateSelectionUI();

        if (frames.length > 0) {
            requestAnimationFrame(fitAllFrames);
            showToast(`${frames.length}개 보고서를 불러왔습니다.`);
        } else {
            showToast('불러올 보고서가 없습니다.', true);
        }
    } catch (error) {
        showToast(`dart_reports.json을 읽지 못했습니다: ${error.message}`, true);
    } finally {
        btnLoad.disabled = false;
        setLoading(false);
    }
}

function clearFrames() {
    frames.forEach(frame => frame.el.remove());
    frames.length = 0;
}

function createReportFrame(report, x, y, width, height) {
    const year = extractYear(report);
    const el = document.createElement('section');
    el.className = 'report-frame';
    Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });

    const header = document.createElement('header');
    header.className = 'frame-header';
    const headerLeft = document.createElement('div');
    headerLeft.className = 'frame-header-left';
    const dot = document.createElement('span');
    dot.className = 'frame-dot';
    const title = document.createElement('span');
    title.className = 'frame-title';
    title.textContent = `${report.company || '회사명 없음'} — ${report.report_name || '보고서'}`;
    title.title = title.textContent;
    const yearBadge = document.createElement('span');
    yearBadge.className = 'frame-year-badge';
    yearBadge.textContent = year || '연도 미상';
    const close = document.createElement('button');
    close.className = 'frame-close';
    close.type = 'button';
    close.title = '보고서 닫기';
    close.textContent = '×';
    headerLeft.append(dot, title, yearBadge);
    header.append(headerLeft, close);

    const webview = document.createElement('webview');
    webview.className = 'frame-webview';
    webview.setAttribute('src', report.url);
    webview.setAttribute('preload', toFileUrl(framePreloadPath));
    webview.setAttribute('webpreferences', 'contextIsolation=false, nodeIntegration=true, webSecurity=false, nodeIntegrationInSubFrames=true');
    webview.setAttribute('allowpopups', '');

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'frame-resize-handle';
    resizeHandle.title = '크기 조절';
    el.append(header, webview, resizeHandle);
    world.appendChild(el);

    const frame = { el, webview, report, year, selectionsBySource: new Map() };

    webview.addEventListener('ipc-message', event => {
        if (event.channel !== 'table-selection-updated') return;
        const payload = event.args[0];
        if (Array.isArray(payload)) {
            frame.selectionsBySource.set('legacy', payload);
        } else if (payload?.sourceId) {
            frame.selectionsBySource.set(payload.sourceId, Array.isArray(payload.tables) ? payload.tables : []);
        }
        updateSelectionUI();
    });
    webview.addEventListener('did-start-loading', () => dot.classList.add('loading'));
    webview.addEventListener('did-stop-loading', () => dot.classList.remove('loading'));
    webview.addEventListener('did-fail-load', event => {
        if (event.errorCode === -3) return;
        dot.classList.remove('loading');
        dot.classList.add('error');
        showToast(`${year || ''} 보고서를 불러오지 못했습니다.`, true);
    });

    close.addEventListener('click', event => {
        event.stopPropagation();
        el.remove();
        const index = frames.indexOf(frame);
        if (index >= 0) frames.splice(index, 1);
        reportCount.textContent = `${frames.length}개 보고서`;
        emptyState.classList.toggle('hidden', frames.length > 0);
        canvasStatus.classList.toggle('hidden', frames.length === 0);
        updateSelectionUI();
    });
    el.addEventListener('mousedown', () => focusFrame(frame));
    setupFrameDrag(header, el);
    setupFrameResize(resizeHandle, el);
    return frame;
}

function focusFrame(target) {
    frames.forEach(frame => frame.el.classList.toggle('is-focused', frame === target));
    target.el.style.zIndex = String(getMaxZ() + 1);
}

function setupFrameDrag(handle, frameEl) {
    let dragging = false;
    let startX = 0, startY = 0, originalLeft = 0, originalTop = 0;
    handle.addEventListener('mousedown', event => {
        if (event.button !== 0 || event.target.closest('.frame-close')) return;
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        originalLeft = parseFloat(frameEl.style.left) || 0;
        originalTop = parseFloat(frameEl.style.top) || 0;
        event.preventDefault();
        event.stopPropagation();
    });
    document.addEventListener('mousemove', event => {
        if (!dragging) return;
        frameEl.style.left = `${originalLeft + (event.clientX - startX) / worldScale}px`;
        frameEl.style.top = `${originalTop + (event.clientY - startY) / worldScale}px`;
    });
    document.addEventListener('mouseup', () => { dragging = false; });
}

function setupFrameResize(handle, frameEl) {
    let resizing = false;
    let startX = 0, startY = 0, originalWidth = 0, originalHeight = 0;
    handle.addEventListener('mousedown', event => {
        if (event.button !== 0) return;
        resizing = true;
        startX = event.clientX;
        startY = event.clientY;
        originalWidth = frameEl.offsetWidth;
        originalHeight = frameEl.offsetHeight;
        event.preventDefault();
        event.stopPropagation();
    });
    document.addEventListener('mousemove', event => {
        if (!resizing) return;
        frameEl.style.width = `${Math.max(400, originalWidth + (event.clientX - startX) / worldScale)}px`;
        frameEl.style.height = `${Math.max(300, originalHeight + (event.clientY - startY) / worldScale)}px`;
    });
    document.addEventListener('mouseup', () => { resizing = false; });
}

viewport.addEventListener('mousedown', event => {
    if (event.button !== 0 || event.target.closest('.report-frame')) return;
    isPanning = true;
    panStart = { x: event.clientX - worldX, y: event.clientY - worldY };
    viewport.classList.add('panning');
});
document.addEventListener('mousemove', event => {
    if (!isPanning) return;
    worldX = event.clientX - panStart.x;
    worldY = event.clientY - panStart.y;
    applyWorldTransform();
});
document.addEventListener('mouseup', () => {
    isPanning = false;
    viewport.classList.remove('panning');
});
viewport.addEventListener('wheel', event => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * .0012);
    zoomAroundPoint(factor, event.clientX - viewport.offsetLeft, event.clientY - viewport.offsetTop);
}, { passive: false });

function zoomAroundPoint(factor, x, y) {
    const nextScale = clamp(worldScale * factor, .1, 3);
    const ratio = nextScale / worldScale;
    worldX = x - (x - worldX) * ratio;
    worldY = y - (y - worldY) * ratio;
    worldScale = nextScale;
    applyWorldTransform();
}

function zoomAtViewportCenter(factor) {
    zoomAroundPoint(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
}

function setZoomAtViewportCenter(scale) {
    zoomAtViewportCenter(scale / worldScale);
}

function fitAllFrames() {
    if (frames.length === 0) return;
    const padding = 32;
    const bounds = frames.reduce((acc, frame) => {
        const left = parseFloat(frame.el.style.left) || 0;
        const top = parseFloat(frame.el.style.top) || 0;
        const right = left + frame.el.offsetWidth;
        const bottom = top + frame.el.offsetHeight;
        return {
            left: Math.min(acc.left, left), top: Math.min(acc.top, top),
            right: Math.max(acc.right, right), bottom: Math.max(acc.bottom, bottom)
        };
    }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    const width = Math.max(bounds.right - bounds.left, 1);
    const height = Math.max(bounds.bottom - bounds.top, 1);
    worldScale = clamp(Math.min((viewport.clientWidth - padding * 2) / width, (viewport.clientHeight - padding * 2) / height), .1, 1);
    worldX = (viewport.clientWidth - width * worldScale) / 2 - bounds.left * worldScale;
    worldY = (viewport.clientHeight - height * worldScale) / 2 - bounds.top * worldScale;
    applyWorldTransform();
}

function applyWorldTransform() {
    world.style.transform = `translate(${worldX}px, ${worldY}px) scale(${worldScale})`;
    zoomLabel.textContent = `${Math.round(worldScale * 100)}%`;
}

async function clearSelections() {
    if (getSelectedCount() === 0 || !confirm('선택한 표를 모두 초기화할까요?')) return;
    frames.forEach(frame => {
        frame.selectionsBySource.clear();
        frame.webview.reload();
    });
    updateSelectionUI();
    showToast('선택을 초기화했습니다. 보고서 화면을 새로 읽습니다.');
}

async function exportToExcel() {
    const allTables = [];
    frames.forEach(frame => {
        getFrameSelections(frame).forEach(item => {
            allTables.push({
                reportUrl: frame.report.url,
                year: frame.year || extractYear(frame.report),
                company: frame.report.company || '',
                groupNo: String(item.groupNo || '').trim(),
                parsedData: parseHTMLTableToRows(item.outerHTML)
            });
        });
    });

    if (allTables.length === 0) {
        showToast('먼저 보고서에서 필요한 표를 선택해주세요.', true);
        return;
    }

    setLoading(true, `${allTables.length}개 표를 Excel로 정리하는 중...`);
    try {
        const result = await window.electronAPI.saveExcel({ tables: allTables });
        if (result.success) showToast(`Excel 저장 완료: ${result.path}`);
        else if (result.error) showToast(`저장 실패: ${result.error}`, true);
    } catch (error) {
        showToast(`저장 실패: ${error.message}`, true);
    } finally {
        setLoading(false);
    }
}

function getFrameSelections(frame) {
    return [...frame.selectionsBySource.values()].flat();
}

function getSelectedCount() {
    return frames.reduce((sum, frame) => sum + getFrameSelections(frame).length, 0);
}

function updateSelectionUI() {
    const total = getSelectedCount();
    countEl.textContent = String(total);
    btnExport.disabled = total === 0;
    btnClear.disabled = total === 0;
    selectionList.replaceChildren();

    const selectedFrames = frames.map(frame => ({ frame, items: getFrameSelections(frame) })).filter(entry => entry.items.length > 0);
    selectionSummary.textContent = total === 0
        ? (frames.length ? '보고서 안의 표를 클릭하면 여기에 선택 현황이 표시됩니다.' : '보고서를 불러오고 필요한 표를 클릭하세요.')
        : `${selectedFrames.length}개 보고서에서 ${total}개 표를 선택했습니다.`;

    if (selectedFrames.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'selection-empty';
        empty.textContent = '아직 선택한 표가 없습니다.\n보고서에서 표를 클릭해 추가하세요.';
        empty.style.whiteSpace = 'pre-line';
        selectionList.appendChild(empty);
        return;
    }

    selectedFrames.forEach(({ frame, items }) => {
        const group = document.createElement('section');
        group.className = 'selection-group';
        const head = document.createElement('div');
        head.className = 'selection-group-head';
        const labels = document.createElement('div');
        const company = document.createElement('strong');
        company.textContent = frame.report.company || '회사명 없음';
        const name = document.createElement('span');
        name.textContent = frame.report.report_name || `${frame.year} 보고서`;
        const count = document.createElement('b');
        count.className = 'selection-count';
        count.textContent = `${items.length}개`;
        labels.append(company, name);
        head.append(labels, count);
        group.appendChild(head);
        items.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'selection-item';
            const number = document.createElement('span');
            number.className = 'selection-index';
            number.textContent = String(index + 1).padStart(2, '0');
            const label = document.createElement('span');
            label.textContent = '선택한 표';
            row.append(number, label);
            if (item.groupNo) {
                const chip = document.createElement('span');
                chip.className = 'group-chip';
                chip.textContent = `그룹 ${item.groupNo}`;
                row.appendChild(chip);
            }
            group.appendChild(row);
        });
        selectionList.appendChild(group);
    });
}

function toggleSelectionPanel() {
    setSelectionPanel(document.body.classList.contains('panel-collapsed'));
}

function setSelectionPanel(open) {
    document.body.classList.toggle('panel-collapsed', !open);
    btnSelectionPanel.setAttribute('aria-expanded', String(open));
}

function parseHTMLTableToRows(outerHTML) {
    try {
        const doc = new DOMParser().parseFromString(outerHTML, 'text/html');
        const table = doc.querySelector('table');
        if (!table) return { data: [['(파싱 실패)']], merges: [] };

        const grid = [];
        const merges = [];
        const occupied = new Set();
        const rows = [...table.querySelectorAll('tr')];
        rows.forEach((tr, rowIndex) => {
            if (!grid[rowIndex]) grid[rowIndex] = [];
            let columnIndex = 0;
            [...tr.children].filter(cell => /^(TH|TD)$/.test(cell.tagName)).forEach(cell => {
                while (occupied.has(`${rowIndex},${columnIndex}`)) columnIndex++;
                const rowspan = Math.max(parseInt(cell.getAttribute('rowspan'), 10) || 1, 1);
                const colspan = Math.max(parseInt(cell.getAttribute('colspan'), 10) || 1, 1);
                grid[rowIndex][columnIndex] = (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim();
                if (rowspan > 1 || colspan > 1) {
                    merges.push({ s: { r: rowIndex, c: columnIndex }, e: { r: rowIndex + rowspan - 1, c: columnIndex + colspan - 1 } });
                }
                for (let row = 0; row < rowspan; row++) {
                    for (let col = 0; col < colspan; col++) {
                        if (row === 0 && col === 0) continue;
                        occupied.add(`${rowIndex + row},${columnIndex + col}`);
                    }
                }
                columnIndex += colspan;
            });
        });
        const maxColumns = Math.max(1, ...grid.map(row => row.length));
        const data = grid.map(row => Array.from({ length: maxColumns }, (_, index) => row[index] || ''));
        return { data, merges };
    } catch (error) {
        return { data: [[`(파싱 오류: ${error.message})`]], merges: [] };
    }
}

function extractYear(report) {
    const match = String(report.report_name || '').match(/\((\d{4})\./);
    if (match) return Number(match[1]);
    const submitted = String(report.submit_date || '');
    return /^\d{4}/.test(submitted) ? Number(submitted.slice(0, 4)) : 0;
}

function getMaxZ() {
    return frames.reduce((max, frame) => Math.max(max, Number(frame.el.style.zIndex) || 0), 0);
}

function toFileUrl(filePath) {
    return encodeURI(`file:///${String(filePath || '').replace(/\\/g, '/')}`);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function setLoading(visible, message) {
    if (message) loadingTxt.textContent = message;
    loadingEl.classList.toggle('hidden', !visible);
}

function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.toggle('error', isError);
    toastEl.classList.remove('hidden');
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), isError ? 5200 : 3600);
}

document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        loadReports();
    } else if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!btnExport.disabled) exportToExcel();
    } else if (!event.ctrlKey && event.key.toLowerCase() === 'f') {
        fitAllFrames();
    } else if (event.key === 'Escape') {
        setSelectionPanel(false);
    }
});

window.addEventListener('resize', () => {
    if (frames.length > 0 && worldScale < .2) fitAllFrames();
});
