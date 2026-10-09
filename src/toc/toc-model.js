(function (root) {
  const reportKeys = ['rcpNo', 'url', 'companyName', 'reportName', 'period', 'receivedDate'];
  const refKeys = ['rcpNo', 'dcmNo', 'eleId', 'offset', 'length', 'dtd'];
  const api = {
    create(report) {
      return { schemaVersion: 1, report: Object.fromEntries(reportKeys.map(k => [k, report[k] || ''])),
        status: 'loading', extractedAt: null, error: null, nodes: [] };
    },
    normalize(reportId, nodes) {
      if (!Array.isArray(nodes)) throw new Error('목차 배열이 아닙니다.');
      const seen = new Set();
      const visit = (items, prefix, depth) => {
        if (depth > 100) throw new Error('목차 계층이 너무 깊습니다.');
        return items.map((node, index) => {
          if (!node || typeof node.title !== 'string' || !node.title.trim() || !Array.isArray(node.children)) throw new Error('목차 제목 또는 계층 정보가 올바르지 않습니다.');
          const location = [...prefix, index];
          const sourceNodeId = node.sourceNodeId == null ? null : String(node.sourceNodeId);
          let id = `${reportId}:` + (sourceNodeId ? `source:${encodeURIComponent(sourceNodeId)}` : `path:${location.join('.')}`);
          if (seen.has(id)) id += `:path:${location.join('.')}`;
          seen.add(id);
          const sourceRef = Object.fromEntries(refKeys.filter(k => ['string', 'number'].includes(typeof node.sourceRef?.[k])).map(k => [k, String(node.sourceRef[k])]));
          return { id, title: node.title.trim(), sourceNodeId,
            sourceRef: Object.keys(sourceRef).length ? sourceRef : null,
            children: visit(node.children, location, depth + 1) };
        });
      };
      return visit(nodes, [], 0);
    },
    count(nodes) { return nodes.reduce((sum, node) => sum + 1 + api.count(node.children), 0); },
    snapshot(tocs) { return JSON.parse(JSON.stringify({ schemaVersion: 1, reports: tocs })); }
  };
  if (typeof module !== 'undefined') module.exports = api; else root.TocModel = api;
})(globalThis);
