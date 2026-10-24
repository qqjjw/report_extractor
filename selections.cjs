// Keep confirmed tables separate from the replaceable search results.
function createSelections() {
  let items = [];
  const keyOf = (report, id) => report + '/' + id;
  return {
    list: () => items.map(({ evidence, ...item }) => item),
    get(key) {
      const item = items.find(item => item.key === key);
      if (!item) throw Error('선택 목록의 표를 지정하세요.');
      return item;
    },
    add(report, candidate, evidence, group) {
      if (!String(group || '').trim()) throw Error('표 종류(group)를 입력하세요.');
      if (!evidence.position?.visible) throw Error('표를 화면에 표시한 뒤 추가하세요.');
      const key = keyOf(report.rcpNo, candidate.id);
      const item = { key, report: report.rcpNo, reportUrl: report.url, reportName: report.reportName, companyName: report.companyName,
        group: String(group).trim(), candidate: { ...candidate }, evidence: structuredClone(evidence) };
      items = [...items.filter(item => item.key !== key), item];
      return key;
    },
    remove(key) { this.get(key); items = items.filter(item => item.key !== key); },
    retain(reports) { items = items.filter(item => reports.some(r => r.rcpNo === item.report && r.url === item.reportUrl)); }
  };
}
module.exports = { createSelections };
