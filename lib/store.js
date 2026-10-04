const fs = require('node:fs/promises');
const path = require('node:path');
const { buildReportUrl } = require('./reports');

// ===== 입력값: 로컬 저장 계약 (DART의 현재 HTML 규칙과는 별개) =====
// 변경하면 기존 reports.json의 호환성 또는 명시적인 마이그레이션을 확인합니다.
const STORAGE_VERSION = 1;
const STORED_RECEIPT_PATTERN = /^\d{14}$/;
const STORED_DATE_PATTERN = /^\d{4}\.\d{2}\.\d{2}$/;
// ===== 처리 로직 =====
class ReportStore {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); this.blocked = false; }
  async load() {
    // 1. 기존 저장 파일을 검사합니다. 링크 형식은 reports.js와 같은 생성 규칙입니다.
    // DART 뷰어 주소 변경 시 기존 URL과의 일치 검사를 함께 검토해야 합니다.
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (data.version !== STORAGE_VERSION || !Array.isArray(data.reports) || !data.reports.every(r =>
        r && STORED_RECEIPT_PATTERN.test(r.rcpNo) && r.url === buildReportUrl(r.rcpNo) &&
        typeof r.reportName === 'string' && typeof r.companyName === 'string' && STORED_DATE_PATTERN.test(r.receivedDate))) throw new Error('저장 파일 형식이 올바르지 않습니다.');
      return data.reports;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      this.blocked = true;
      throw error;
    }
  }
  save(reports) {
    // 2. 호출 시점의 목록을 고정해 저장 큐에서 순서대로 처리합니다.
    const snapshot = JSON.stringify({ version: STORAGE_VERSION, reports }, null, 2);
    const task = this.queue.then(async () => {
      if (this.blocked) throw new Error('기존 저장 파일을 보호하기 위해 저장을 중단했습니다. data/reports.json을 확인한 후 앱을 다시 실행하세요.');
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      // 3. 같은 폴더의 임시 파일에 기록하고 디스크 동기화 후 본체와 교체합니다.
      const temporary = `${this.file}.tmp`;
      const handle = await fs.open(temporary, 'w');
      try { await handle.writeFile(snapshot, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, this.file);
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
module.exports = { ReportStore };
