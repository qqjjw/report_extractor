(function (root) {
  function text(value) { return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim(); }
  function fingerprint(value) {
    let hash = 2166136261;
    for (const char of value) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16);
  }
  function summarize(table, documentUrl, index) {
    if (table.querySelector('table') || table.closest('[hidden], [aria-hidden="true"]')) return null;
    for (let el = table; el; el = el.parentElement) {
      if (el.style?.display === 'none' || el.style?.visibility === 'hidden') return null;
    }
    const cells = [...table.rows].map(row => [...row.cells].filter(cell => cell.closest('table') === table).map(cell => ({
      text: text(cell.textContent), rowSpan: cell.rowSpan, colSpan: cell.colSpan, header: cell.tagName === 'TH'
    })));
    if (cells.length < 2 || !cells.some(row => row.length >= 2) || !cells.flat().some(c => c.text)) return null;
    const context = [];
    let before = table;
    for (let depth = 0; before && depth < 4 && context.join(' ').length < 1500; depth++, before = before.parentElement) {
      let previous = before.previousElementSibling;
      for (let i = 0; previous && i < 6; i++, previous = previous.previousElementSibling) {
        if (previous.matches('table, script, style') || previous.querySelector('table')) continue;
        const value = text(previous.textContent);
        if (value && value.length <= 500) context.unshift(value);
      }
    }
    const title = text(table.caption?.textContent) || context.at(-1) || '제목 없는 표';
    const headers = [...new Set(cells.flat().filter(c => c.header).map(c => c.text).filter(Boolean))];
    if (!headers.length) headers.push(...cells.slice(0, 3).flat().map(c => c.text).filter(Boolean));
    const rowLabels = cells.map(row => row[0]?.text || '').filter(Boolean);
    const signature = fingerprint(JSON.stringify(cells));
    return { documentUrl, tableIndex: index, fingerprint: signature, title, context: context.join(' ').slice(-1500),
      cells, headers, rowLabels, rowCount: cells.length, columnCount: Math.max(...cells.map(row => row.reduce((n, c) => n + c.colSpan, 0))) };
  }
  function extract(doc, url) {
    return [...doc.querySelectorAll('table')].map((table, i) => summarize(table, url, i)).filter(Boolean);
  }
  function find(doc, dto) {
    const table = doc.querySelectorAll('table')[dto.tableIndex];
    if (!table) return null;
    const current = summarize(table, dto.documentUrl, dto.tableIndex);
    return current?.fingerprint === dto.fingerprint ? table : null;
  }
  function clear(doc) {
    for (const prior of doc.querySelectorAll('[data-report-table-highlight]')) {
      prior.style.outline = prior.dataset.reportPriorOutline || '';
      prior.style.outlineOffset = prior.dataset.reportPriorOffset || '';
      if(prior.dataset.reportPriorPriority)prior.style.setProperty('outline',prior.dataset.reportPriorOutline,prior.dataset.reportPriorPriority);
      delete prior.dataset.reportTableHighlight; delete prior.dataset.reportPriorOutline; delete prior.dataset.reportPriorOffset;
      delete prior.dataset.reportPriorPriority;
    }
  }
  function highlight(table) {
    clear(table.ownerDocument);
    table.dataset.reportPriorOutline = table.style.outline;
    table.dataset.reportPriorPriority = table.style.getPropertyPriority('outline');
    table.dataset.reportPriorOffset = table.style.outlineOffset;
    table.dataset.reportTableHighlight = 'true';
    table.style.setProperty('outline','4px solid #ed65a6','important'); table.style.outlineOffset = '2px';
  }
  const api = { text, fingerprint, summarize, extract, find, highlight, clear };
  root.TableDOM = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
