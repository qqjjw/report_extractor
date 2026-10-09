(function (root) {
  // This function is serialized and run in the guest page. Never execute page-provided code.
  function extract() {
    const url = new URL(location.href);
    if (url.hostname !== 'dart.fss.or.kr' || url.pathname !== '/dsaf001/main.do') {
      return { state: 'error', error: 'DART 보고서 페이지에서만 목차를 추출할 수 있습니다.' };
    }
    const keys = ['rcpNo', 'dcmNo', 'eleId', 'offset', 'length', 'dtd'];
    const ref = (...sources) => {
      const result = {};
      for (const source of sources) for (const key of keys) {
        if (['string', 'number'].includes(typeof source?.[key])) result[key] = String(source[key]);
      }
      return Object.keys(result).length ? result : null;
    };
    const text = value => {
      return new DOMParser().parseFromString(String(value || ''), 'text/html').body.textContent.trim();
    };
    const result = nodes => ({ state: nodes.length ? 'ready' : 'empty', reportId: url.searchParams.get('rcpNo'), nodes });
    const jq = window.jQuery || window.$;
    const trees = [...document.querySelectorAll('#listTree, .jstree')];
    if (typeof jq === 'function' && jq.fn?.jstree) {
      for (const el of trees) {
        const instance = jq(el).jstree(true);
        if (!instance || typeof instance.get_json !== 'function') continue;
        const json = instance.get_json('#', { flat: false });
        if (!Array.isArray(json)) continue;
        let incomplete = false;
        const visit = (nodes, depth = 0) => {
          if (depth > 100) throw new Error('목차 계층이 너무 깊습니다.');
          return nodes.map(n => {
            const original = instance.get_node(n.id);
            if (n.children === true || original?.state?.loaded === false) incomplete = true;
            return { title: text(n.text), sourceNodeId: n.id == null ? null : String(n.id),
              sourceRef: ref(original?.original, original?.original?.data, n.data),
              children: Array.isArray(n.children) ? visit(n.children, depth + 1) : [] };
          });
        };
        const nodes = visit(json);
        if (incomplete) return { state: 'pending', error: '아직 불러오지 않은 하위 목차가 있습니다.' };
        if (!nodes.length) continue;
        return result(nodes);
      }
    }
    // Older DART viewers used Ext TreePanel. Its model includes collapsed children.
    const manager = window.Ext?.ComponentMgr || window.Ext?.ComponentManager;
    if (manager?.all?.each) {
      let found = null;
      manager.all.each(component => {
        if (found || typeof component.getRootNode !== 'function') return;
        const treeRoot = component.getRootNode();
        if (!treeRoot?.childNodes?.length) return;
        let incomplete = false;
        const visit = (nodes, depth = 0) => {
          if (depth > 100) throw new Error('목차 계층이 너무 깊습니다.');
          return nodes.map(n => {
            if (n.attributes?.leaf === false && n.loaded === false) incomplete = true;
            return { title: text(n.text || n.attributes?.text), sourceNodeId: n.id == null ? null : String(n.id),
              sourceRef: ref(n.attributes, n.attributes?.data), children: visit(n.childNodes || [], depth + 1) };
          });
        };
        const nodes = visit(treeRoot.childNodes);
        if (!incomplete) found = nodes;
      });
      if (found) return result(found);
    }
    // A DOM fallback reads hidden branches as well, without opening/clicking the page tree.
    const container = document.querySelector('#listTree, #tree, [role="tree"]');
    if (!container) return { state: 'pending', error: '페이지에서 목차 트리를 찾지 못했습니다.' };
    if (container.querySelector('[aria-busy="true"], .jstree-loading, .jstree-closed:not(:has(ul))')) {
      return { state: 'pending', error: '아직 불러오지 않은 하위 목차가 있습니다.' };
    }
    const items = [...container.querySelectorAll('li, [role="treeitem"]')];
    const itemSet = new Set(items);
    const children = new Map([[null, []]]);
    for (const item of items) {
      let parent = item.parentElement;
      while (parent && parent !== container && !itemSet.has(parent)) parent = parent.parentElement;
      if (!itemSet.has(parent)) parent = null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(item);
    }
    const visit = (parent, depth = 0) => {
      if (depth > 100) throw new Error('목차 계층이 너무 깊습니다.');
      return (children.get(parent) || []).map(item => {
        const clone = item.cloneNode(true);
        for (const nested of clone.querySelectorAll('ul, ol, [role="group"]')) nested.remove();
        const label = clone.querySelector('.jstree-anchor, .x-tree-node-anchor, a, [role="link"]');
        const action = (label?.getAttribute('onclick') || label?.getAttribute('href') || '') + ' ' + (item.getAttribute('onclick') || '');
        const call = /viewDoc\s*\(([^)]*)\)/.exec(action);
        const args = call ? [...call[1].matchAll(/['"]([^'"]*)['"]/g)].map(m => m[1]) : [];
        const sourceRef = args.length === 6 ? Object.fromEntries(keys.map((k, i) => [k, args[i]])) : null;
        return { title: (label || clone).textContent.trim(), sourceNodeId: item.id || null,
          sourceRef, children: visit(item, depth + 1) };
      });
    };
    const nodes = visit(null);
    if (nodes.length) return result(nodes);
    if (container.dataset.tocEmpty === 'true' || /목차(가|는)?\s*(없|존재하지)/.test(container.textContent)) return result([]);
    return { state: 'pending', error: '목차가 아직 준비되지 않았거나 지원하지 않는 트리 형식입니다.' };
  }
  const api = { script: `(${extract.toString()})()`, extract };
  if (typeof module !== 'undefined') module.exports = api; else root.TocExtractor = api;
})(globalThis);
