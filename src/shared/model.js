(function (root) {
  const api = {
    period(name) {
      const m = /\((\d{4})\.(0[1-9]|1[0-2])\)/.exec(name || '');
      return m ? `${m[1]}.${m[2]}` : '';
    },
    validate(data) {
      if (!data || data.version !== 1 || !Array.isArray(data.reports)) throw new Error('version: 1과 reports 배열이 필요합니다.');
      const ids = new Set();
      return data.reports.map((r, i) => {
        if (!r || ['rcpNo', 'url', 'reportName', 'companyName', 'receivedDate'].some(k => typeof r[k] !== 'string' || !r[k].trim())) throw new Error(`${i + 1}번째 보고서의 필수 항목을 확인하세요.`);
        const url = new URL(r.url);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('HTTP(S) 사이트만 열 수 있습니다.');
        if (ids.has(r.rcpNo)) throw new Error(`중복 접수번호: ${r.rcpNo}`);
        ids.add(r.rcpNo);
        return { ...r, period: api.period(r.reportName), index: i };
      });
    },
    sort(reports, direction) {
      return [...reports].sort((a, b) => {
        if (!a.period || !b.period) return a.period ? -1 : b.period ? 1 : a.index - b.index;
        return a.period.localeCompare(b.period) * (direction === 'asc' ? 1 : -1) || a.index - b.index;
      });
    },
    bounds(cards, width, height) {
      const padX = Math.max(64, width / 2), padY = Math.max(64, height / 2);
      return {
        minX: Math.min(0, ...cards.map(c => c.x - padX)),
        minY: Math.min(0, ...cards.map(c => c.y - padY)),
        maxX: Math.max(width, ...cards.map(c => c.x + c.w + padX)),
        maxY: Math.max(height, ...cards.map(c => c.y + c.h + 40 + (c.extraHeight || 0) + padY))
      };
    }
  };
  if (typeof module !== 'undefined') module.exports = api;
  else root.ReportModel = api;
})(globalThis);
