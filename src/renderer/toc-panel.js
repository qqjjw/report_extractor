(function (root) {
  function attach(report, row, retry) {
    let toc = root.TocModel.create(report);
    const openNodes = new Set();
    const button = document.createElement('button'); button.className = 'toc-toggle';
    button.setAttribute('aria-label', `${report.companyName} ${report.reportName} 목차 펼치기`);
    button.setAttribute('aria-expanded', 'false');
    const cell = document.createElement('td'); cell.append(button); row.prepend(cell);
    const detailRow = document.createElement('tr'); detailRow.className = 'toc-row'; detailRow.hidden = true;
    const content = document.createElement('td'); content.colSpan = row.children.length; detailRow.append(content);
    content.id = `toc-${report.rcpNo}`; button.setAttribute('aria-controls', content.id);
    let expanded = false;
    const states = { loading: '추출 중', empty: '목차 없음', error: '추출 실패' };
    function makeButton(title, callback) {
      const el = document.createElement('button'); el.textContent = title; el.onclick = callback; return el;
    }
    function renderNodes(nodes, parent) {
      const list = document.createElement('ul'); list.className = 'toc-tree'; parent.append(list);
      for (const node of nodes) {
        const item = document.createElement('li'); list.append(item);
        if (!node.children.length) { const label = document.createElement('span'); label.textContent = node.title; item.append(label); continue; }
        const details = document.createElement('details'); details.dataset.nodeId = node.id;
        details.open = openNodes.has(node.id);
        const summary = document.createElement('summary'); summary.textContent = node.title; details.append(summary); item.append(details);
        renderNodes(node.children, details);
        details.addEventListener('toggle', () => { if (details.open) openNodes.add(node.id); else openNodes.delete(node.id); });
      }
    }
    function render() {
      const count = root.TocModel.count(toc.nodes);
      button.textContent = `${expanded ? '▾' : '▸'} ${toc.status === 'ready' ? `목차 ${count}` : states[toc.status]}`;
      button.setAttribute('aria-expanded', String(expanded)); detailRow.hidden = !expanded;
      content.replaceChildren();
      if (!expanded) return;
      const toolbar = document.createElement('div'); toolbar.className = 'toc-toolbar';
      if (toc.status === 'ready') {
        toolbar.append(makeButton('전체 펼치기', () => {
          for (const details of content.querySelectorAll('details')) { details.open = true; openNodes.add(details.dataset.nodeId); }
        }), makeButton('전체 접기', () => {
          openNodes.clear(); for (const details of content.querySelectorAll('details')) details.open = false;
        }));
        content.append(toolbar); renderNodes(toc.nodes, content);
      } else {
        const message = document.createElement('p'); message.className = 'toc-message';
        message.textContent = toc.status === 'error' ? toc.error : toc.status === 'empty' ? '이 보고서에는 목차가 없습니다.' : '보고서 페이지의 목차를 읽고 있습니다…';
        message.setAttribute('role', 'status'); content.append(message);
        if (toc.status === 'error') content.append(makeButton('목차 다시 추출', retry));
      }
    }
    button.onclick = event => { event.stopPropagation(); expanded = !expanded; render(); };
    button.addEventListener('keydown', event => event.stopPropagation());
    detailRow.addEventListener('click', event => event.stopPropagation());
    detailRow.addEventListener('keydown', event => event.stopPropagation());
    render();
    return { row: detailRow, update(value) { toc = value; render(); } };
  }
  root.TocPanel = { attach };
})(globalThis);
