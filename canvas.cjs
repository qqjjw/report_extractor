const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
function number(value) {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n)) throw Error('유효한 숫자가 필요합니다.');
  return n;
}
function createLayout() {
  return { canvas: { x: -24, y: -24, zoom: 0.6, width: 1000, height: 750, minX: -1600, minY: -1600, maxX: 6000, maxY: 6000 }, windows: {}, active: null, order: 0, sortDirection: 'desc', panels: {left:{width:250,collapsed:false},right:{width:300,collapsed:false}} };
}
function expand(layout) {
  const c = layout.canvas, pad = 1200;
  c.minX = Math.min(c.minX, c.x - pad); c.minY = Math.min(c.minY, c.y - pad);
  c.maxX = Math.max(c.maxX, c.x + c.width / c.zoom + pad);
  c.maxY = Math.max(c.maxY, c.y + c.height / c.zoom + pad);
  for (const w of Object.values(layout.windows)) {
    c.minX = Math.min(c.minX, w.x - pad); c.minY = Math.min(c.minY, w.y - pad);
    c.maxX = Math.max(c.maxX, w.x + w.width + pad); c.maxY = Math.max(c.maxY, w.y + w.height + pad);
  }
}
function reconcile(layout, oldReports, reports) {
  const old = new Map(oldReports.map(r => [r.rcpNo, r]));
  const keep = {};
  let nextX = oldReports.length ? Math.max(0, ...Object.values(layout.windows).map(w => w.x + w.width + 24)) : 0;
  for (const r of reports) {
    if (old.get(r.rcpNo)?.url === r.url && layout.windows[r.rcpNo]) keep[r.rcpNo] = layout.windows[r.rcpNo];
    else {
      keep[r.rcpNo] = { x: nextX, y: 0, width: 1152, height: 1520, zoom: 1, z: ++layout.order };
      nextX += 1176;
    }
  }
  layout.windows = keep;
  if (!keep[layout.active]) layout.active = reports[0]?.rcpNo || null;
  expand(layout);
}
function apply(layout, action, args = {}, id) {
  const c = layout.canvas, w = layout.windows[id];
  if ((action.startsWith('window-') || action === 'site-zoom') && !w) throw Error('보고서 ID를 확인하세요.');
  if (action === 'panel-resize' || action === 'panel-toggle') {
    const panel=layout.panels[args.side]; if(!panel)throw Error('패널은 left 또는 right를 지정하세요.');
    if(action==='panel-resize')panel.width=clamp(number(args.width),220,520);
    else panel.collapsed=args.collapsed===undefined?!panel.collapsed:args.collapsed===true||args.collapsed==='true';
  } else if (action === 'window-move') { w.x = number(args.x); w.y = number(args.y); }
  else if (action === 'window-resize') {
    w.width = Math.max(480, number(args.width)); w.height = Math.max(320, number(args.height));
    if (args.x !== undefined) w.x = number(args.x);
    if (args.y !== undefined) w.y = number(args.y);
  } else if (action === 'window-focus' || action === 'window-raise') {
    if (layout.active !== id || w.z !== layout.order) { w.z = ++layout.order; layout.active = id; }
    if (action === 'window-focus') {
      const visible = w.x >= c.x && w.y >= c.y && w.x + Math.min(w.width, c.width / c.zoom) <= c.x + c.width / c.zoom && w.y + Math.min(w.height, c.height / c.zoom) <= c.y + c.height / c.zoom;
      if (!visible) { c.x = w.x - 24; c.y = w.y - 24; }
    }
  } else if (action === 'canvas-pan') { c.x = number(args.x); c.y = number(args.y); }
  else if (action === 'canvas-viewport') { c.width = Math.max(1, number(args.width)); c.height = Math.max(1, number(args.height)); }
  else if (action === 'canvas-zoom') {
    const zoom = clamp(number(args.ratio), 0.5, 2);
    const ax = args.anchorX === undefined ? c.width / 2 : number(args.anchorX);
    const ay = args.anchorY === undefined ? c.height / 2 : number(args.anchorY);
    c.x += ax / c.zoom - ax / zoom; c.y += ay / c.zoom - ay / zoom; c.zoom = zoom;
  } else if (action === 'site-zoom') w.zoom = clamp(number(args.ratio), 0.5, 2.5);
  else throw Error('지원하지 않는 캔버스 동작입니다.');
  expand(layout);
  return layout;
}
function sortReports(reports, direction) {
  if (!['asc','desc'].includes(direction)) throw Error('정렬은 asc 또는 desc를 지정하세요.');
  const dateKey = r => String(r.receivedDate || r.rcpNo.slice(0,8)).replace(/\D/g,'');
  return [...reports].sort((a,b) => (dateKey(a).localeCompare(dateKey(b)) || a.rcpNo.localeCompare(b.rcpNo)) * (direction === 'asc' ? 1 : -1));
}
function arrange(layout, reports) {
  let x = 0;
  for (const r of reports) { const w=layout.windows[r.rcpNo]; w.x=x; w.y=0; x+=w.width+24; }
  expand(layout);
}
function parseReports(text) {
  const value = JSON.parse(text);
  if (!Array.isArray(value.reports)) throw Error('reports 배열이 필요합니다.');
  const ids = new Set();
  for (const r of value.reports) {
    if (!r || typeof r.rcpNo !== 'string' || !r.rcpNo || ids.has(r.rcpNo)) throw Error('보고서 ID가 없거나 중복되었습니다.');
    const url = new URL(r.url);
    if (url.protocol !== 'https:' || url.hostname !== 'dart.fss.or.kr') throw Error('DART HTTPS 보고서 주소가 필요합니다.');
    ids.add(r.rcpNo);
  }
  return value.reports;
}
module.exports = { createLayout, reconcile, apply, parseReports, sortReports, arrange };
