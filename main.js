const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx'); // 💡 엑셀 모듈 명시적 추가

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 980,
        minHeight: 680,
        title: 'DART Table Picker',
        backgroundColor: '#0b1020',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            webviewTag: true,               // 💡 웹뷰(<webview>) 태그 활성화 (복구됨)
            nodeIntegrationInSubFrames: true // 💡 DART 중첩 아이프레임 권한 허용 (복구됨)
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC: dart_reports.json 읽기 ───────────────────────────────────────────
ipcMain.handle('read-json', async () => {
    const jsonPath = path.join(__dirname, 'dart_reports.json');
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const reports = JSON.parse(raw);
    if (!Array.isArray(reports)) throw new Error('JSON 최상위 값은 배열이어야 합니다.');
    return reports.filter(report => report && report.url);
});

// ─── IPC: preload-frame.js 경로 반환 ──────────────────────────────────────
ipcMain.handle('get-frame-preload-path', () => {
    return path.join(__dirname, 'preload-frame.js');
});

// ─── IPC: Excel 저장 ───────────────────────────────────────────────────────
ipcMain.handle('save-excel', async (event, payload) => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Excel 내보내기',
        defaultPath: 'dart_tables.xlsx',
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });

    if (!filePath) return { success: false };

    try {
        const wb = XLSX.utils.book_new();
        const ws = {};
        const tables = Array.isArray(payload?.tables) ? payload.tables : [];

        if (!tables || tables.length === 0) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['선택된 표가 없습니다.']]), 'Sheet1');
            XLSX.writeFile(wb, filePath);
            return { success: true, path: filePath };
        }

        // ── 1. 연도 목록 추출 (오름차순)
        const yearSet = new Set(tables.map(t => t.year));
        const years = Array.from(yearSet).sort((a, b) => a - b);

        // ── 2. 연도별 테이블 그룹화
        const tablesByYear = {};
        years.forEach(y => { tablesByYear[y] = []; });
        tables.forEach(t => tablesByYear[t.year].push(t));

		// ── 3. 연도별 열(Column) 시작 오프셋 계산 부분 수정
		const COL_GAP = 1;
		const colOffset = {}; 
		let curCol = 0;

		years.forEach(year => {
			colOffset[year] = curCol;
			const maxCols = Math.max(
				// 💡 htmlRows 대신 parsedData.data 참조
				...tablesByYear[year].map(t => Math.max(...t.parsedData.data.map(r => r.length), 1)), 1
			);
			curCol += maxCols + COL_GAP;
		});

        // ── 4. 시작 행(Row) 및 상태 초기화
        const currentRow = {}; 
        years.forEach(y => { currentRow[y] = 1; }); // 0행은 헤더

        // 헤더 행 기입
        years.forEach(year => {
            const rep = tablesByYear[year][0];
            const label = rep ? `${rep.company || ''} ${year}` : String(year);
            const cellAddr = XLSX.utils.encode_cell({ r: 0, c: colOffset[year] });
            ws[cellAddr] = { v: label, t: 's', s: { font: { bold: true } } };
        });

		// 💡 엑셀 시트에 병합 정보를 담을 배열 초기화
		if (!ws['!merges']) ws['!merges'] = [];

		const writeTable = (table, startRow, startCol) => {
			const grid = Array.isArray(table?.parsedData?.data) ? table.parsedData.data : [];
			const merges = Array.isArray(table?.parsedData?.merges) ? table.parsedData.merges : [];

			// 데이터 쓰기
			grid.forEach((row, ri) => {
				row.forEach((cellVal, ci) => {
					const addr = XLSX.utils.encode_cell({ r: startRow + ri, c: startCol + ci });
					ws[addr] = { v: cellVal, t: 's' };
				});
			});

			// 💡 병합 범위 적용 (테이블이 배치된 시작 좌표 startRow, startCol 만큼 더해줌)
			merges.forEach(merge => {
				ws['!merges'].push({
					s: { r: startRow + merge.s.r, c: startCol + merge.s.c },
					e: { r: startRow + merge.e.r, c: startCol + merge.e.c }
				});
			});

			return grid.length;
		};

        // ── 5. 그룹 없는 표 먼저 배치
        years.forEach(year => {
            tablesByYear[year].filter(t => !t.groupNo).forEach(table => {
                const startRow = currentRow[year];
                const usedRows = writeTable(table, startRow, colOffset[year]);
                currentRow[year] = startRow + usedRows + 1; // 표 사이 빈 행 확보
            });
        });

        // ── 6. 그룹 있는 표 배치 (💡 덮어쓰기 버그 해결 및 자동 누적 로직) ──
        // 선택된 표들의 그룹 번호를 찾아 숫자 오름차순으로 정렬
        const uniqueGroups = [...new Set(tables.map(t => t.groupNo).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
        const groupYearCursor = {}; // groupNo -> { year -> 해당 연도에서 다음 표를 적을 행 위치 }

        uniqueGroups.forEach(groupNo => {
            // 💡 핵심: 그룹이 새로 시작할 때는, 현재까지 모든 연도 중 가장 깊이 내려간 행(Max)을 기준으로 삼아 가로 오와 열을 일치시킴
            const maxCurrentRow = Math.max(...years.map(y => currentRow[y]));
            groupYearCursor[groupNo] = {};

            years.forEach(year => {
                tablesByYear[year]
                    .filter(t => t.groupNo === groupNo)
                    .forEach(table => {
                        // 이 그룹, 이 연도에 배정된 첫 표라면 maxCurrentRow부터 시작
                        if (groupYearCursor[groupNo][year] === undefined) {
                            groupYearCursor[groupNo][year] = maxCurrentRow;
                        }

                        const startRow = groupYearCursor[groupNo][year];
                        const usedRows = writeTable(table, startRow, colOffset[year]);

                        // 💡 커서 업데이트: 같은 연도 & 같은 그룹의 다음 표는 방금 쓴 표 바로 밑에 쌓이도록(Stacking) 계산
                        groupYearCursor[groupNo][year] = startRow + usedRows + 1;
                        
                        // 글로벌 커서 갱신
                        if (groupYearCursor[groupNo][year] > currentRow[year]) {
                            currentRow[year] = groupYearCursor[groupNo][year];
                        }
                    });
            });
        });

        // ── 7. 시트 범위 지정 및 최종 저장
        const maxRow = Math.max(...Object.values(currentRow));
        ws['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: maxRow, c: curCol });

        // 개인 분석용으로 열 너비를 읽기 좋은 범위에서 자동 조정한다.
        ws['!cols'] = Array.from({ length: curCol + 1 }, (_, col) => {
            let width = 10;
            for (let row = 0; row <= maxRow; row++) {
                const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
                if (cell?.v !== undefined) width = Math.max(width, String(cell.v).length + 2);
            }
            return { wch: Math.min(width, 42) };
        });

        XLSX.utils.book_append_sheet(wb, ws, 'DART Tables');
        XLSX.writeFile(wb, filePath);

        return { success: true, path: filePath };

    } catch (err) {
        console.error('Excel 저장 오류:', err);
        return { success: false, error: err.message };
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
