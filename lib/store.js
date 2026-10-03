const fs = require('node:fs/promises');
const path = require('node:path');
class ReportStore {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); this.blocked = false; }
  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.reports) || !data.reports.every(r =>
        r && /^\d{14}$/.test(r.rcpNo) && r.url === `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r.rcpNo}` &&
        typeof r.reportName === 'string' && typeof r.companyName === 'string' && /^\d{4}\.\d{2}\.\d{2}$/.test(r.receivedDate))) throw new Error('저장 파일 형식이 올바르지 않습니다.');
      return data.reports;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      this.blocked = true;
      throw error;
    }
  }
  save(reports) {
    const snapshot = JSON.stringify({ version: 1, reports }, null, 2);
    const task = this.queue.then(async () => {
      if (this.blocked) throw new Error('기존 저장 파일을 보호하기 위해 저장을 중단했습니다. data/reports.json을 확인한 후 앱을 다시 실행하세요.');
      await fs.mkdir(path.dirname(this.file), { recursive: true });
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
