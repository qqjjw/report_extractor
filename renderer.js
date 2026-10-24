const $ = id => document.getElementById(id);
let state, layout, panFrame = 0, drag = null;
const cards = new Map();
const viewport = $('viewport'), board = $('board');
const send = (action, args = {}) => window.dart.command(action, args);
function act(action, args) { return send(action, args).catch(error => { $('status').textContent = error.message; }); }
function el(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; }
const ratio = zoom => Math.round(zoom * 100) + '%';
function createCard(report) {
  const id = report.rcpNo, card = el('section', undefined, 'site');
  card.dataset.report = id;
  const titlebar = el('div', undefined, 'titlebar'), title = el('div', undefined, 'title');
  title.append(el('b', report.companyName + ' · ' + report.reportName), el('small', id));
  const tools = el('div', undefined, 'site-tools');
  for (const [label, delta, aria] of [['−', -0.1, '사이트 축소'], ['100%', 0, '사이트 배율 복원'], ['+', 0.1, '사이트 확대']]) {
    const button = el('button', label);
    button.setAttribute('aria-label', aria + ' ' + id);
    if (!delta) button.className = 'site-ratio';
    button.addEventListener('pointerdown', event => event.stopPropagation());
    button.onclick = () => act('site-zoom', { report: id, ratio: delta ? layout.windows[id].zoom + delta : 1 });
    tools.append(button);
  }
  titlebar.append(title, tools); card.append(titlebar);
  titlebar.addEventListener('pointerdown', event => beginDrag(event, id, 'move'));
  const wrap = el('div', undefined, 'guest-wrap'), guest = document.createElement('webview');
  guest.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes,nodeIntegration=no');
  guest.setAttribute('src', report.url);
  let bound = false;
  const bind = () => {
    if (bound) return;
    try { const guestId = guest.getWebContentsId(); bound = true; window.dart.bindGuest(id, guestId).catch(error => { bound = false; $('status').textContent = error.message; }); } catch {}
  };
  guest.addEventListener('did-attach', bind); guest.addEventListener('dom-ready', bind);
  guest.addEventListener('focus', () => act('window-raise', { report: id }));
  wrap.append(guest); card.append(wrap);
  const loadError=el('div',undefined,'load-error');loadError.hidden=true;
  const errorText=el('span'),retry=el('button','다시 시도');
  retry.onclick=()=>act('report-retry',{report:id});loadError.append(errorText,retry);card.append(loadError);
  for (const edge of ['n','e','s','w','nw','ne','sw','se']) {
    const handle = el('div', undefined, 'handle ' + edge);
    handle.addEventListener('pointerdown', event => beginDrag(event, id, edge)); card.append(handle);
  }
  card.addEventListener('pointerdown', () => act('window-raise', { report: id }));
  board.append(card); cards.set(id, { card, guest, titlebar, wrap, loadError, errorText, retry, url: report.url });
}
function renderLayout(next) {
  layout = next;
  for(const side of ['left','right']) {
    const p=layout.panels[side], panel=$(side+'Panel');
    document.documentElement.style.setProperty('--'+side+'-panel',(p.collapsed?36:p.width)+'px');
    panel.classList.toggle('collapsed',p.collapsed);
    $(side==='left'?'toggleLeft':'toggleRight').textContent=side==='left'?(p.collapsed?'›':'‹'):(p.collapsed?'‹':'›');
  }
  const c = layout.canvas, z = c.zoom;
  board.style.width = Math.ceil((c.maxX - c.minX) * z) + 'px';
  board.style.height = Math.ceil((c.maxY - c.minY) * z) + 'px';
  board.style.backgroundSize = 24 * z + 'px ' + 24 * z + 'px';
  for (const [id, item] of cards) {
    const w = layout.windows[id]; if (!w) continue;
    const h = 56 * z;
    Object.assign(item.card.style, { left: (w.x - c.minX) * z + 'px', top: (w.y - c.minY) * z + 'px', width: w.width * z + 'px', height: w.height * z + 'px', borderWidth: z + 'px', zIndex: w.z });
    item.card.classList.toggle('active', layout.active === id);
    item.titlebar.style.height = h + 'px'; item.titlebar.style.fontSize = Math.max(10, 14 * z) + 'px';
    Object.assign(item.wrap.style, {top:h+'px',left:5*z+'px',right:5*z+'px',bottom:5*z+'px'});
    item.loadError.style.top=h+'px';
    item.card.querySelector('.site-ratio').textContent = ratio(w.zoom);
  }
  const left = (c.x - c.minX) * z, top = (c.y - c.minY) * z;
  if (Math.abs(viewport.scrollLeft - left) > 1) viewport.scrollLeft = left;
  if (Math.abs(viewport.scrollTop - top) > 1) viewport.scrollTop = top;
  $('canvasRatio').textContent = ratio(z);
  $('position').textContent = Math.round(c.x) + ', ' + Math.round(c.y);
  document.querySelectorAll('.report-link').forEach(button => button.classList.toggle('selected',button.dataset.report===layout.active));
}
function render(next) {
  state = next;
  for (const [id, item] of cards) {
    const report = state.reports.find(r => r.rcpNo === id);
    if (!report || report.url !== item.url) { item.card.remove(); cards.delete(id); }
  }
  for (const report of state.reports) {
    if (!cards.has(report.rcpNo)) createCard(report);
    cards.get(report.rcpNo).titlebar.querySelector('b').textContent=report.companyName+' · '+report.reportName;
    const item=cards.get(report.rcpNo),error=state.loadErrors?.[report.rcpNo];
    item.loadError.hidden=!error;
    item.errorText.textContent=error?.message||'';item.retry.disabled=state.busy;
  }
  $('sortDirection').value=state.layout.sortDirection;
  $('sortDirection').disabled=state.busy;
  $('reportList').replaceChildren(...state.reports.map((r,i) => {
    const button=el('button',undefined,'report-link'); button.dataset.report=r.rcpNo;
    button.append(el('b',(i+1)+'. '+r.companyName+' · '+r.reportName),el('small',(r.receivedDate||'')+' · '+(state.loadErrors?.[r.rcpNo]?'접속 오류':state.loaded[r.rcpNo]?'연결됨':'연결 중')));
    button.onclick=()=>act('window-focus',{report:r.rcpNo}); return button;
  }));
  renderLayout(state.layout);
  $('run').disabled = state.busy || !state.loaded[layout.active];
  $('reload').disabled = state.busy;
  $('selectSource').disabled=state.busy;
  $('selectSource').textContent=state.sourceMode?'선택 취소 · 표를 클릭하세요':'기준 표 선택';
  $('selectSource').classList.toggle('picking',state.sourceMode);
  $('clearSource').disabled=state.busy||!state.source;
  $('showSource').hidden=!state.source;
  $('sourceStatus').textContent=state.sourceMode?'웹페이지의 표를 클릭하세요. 선택한 표가 파란 테두리로 표시됩니다.':state.source?'파랑 · '+state.source.reportName+' / 표 '+(state.source.candidate.tableIndex+1)+' / '+state.source.candidate.rows+'행\n이 표를 기준으로 AI에게 검색을 요청하세요.':'파랑: 기준 표 · 주황: 검색 결과';
  const loaded = Object.values(state.loaded).filter(Boolean).length;
  $('reportCount').textContent = loaded + ' / ' + state.reports.length + '개 연결';
  $('status').textContent = state.busy ? '탐색 중 · 선택한 원문에서 이동과 강조를 확인하세요.' : '로컬 제어 준비 · 보고서 ' + state.reports.length + '개\n임베딩: ' + (state.embedding ? '서버 설정됨' : '미설정 · 단일 후보는 바로 확인');
  if(state.loadErrors?.[layout.active])$('status').textContent=state.loadErrors[layout.active].message+'\n보고서 위의 다시 시도를 누르세요.';
  renderResults();
  $('keepSource').disabled=state.busy||!state.source;
  $('selections').replaceChildren(...(state.selections||[]).map(item=>{
    const row=el('div',undefined,'result');
    row.append(el('b',item.group+' · '+item.reportName));
    const show=el('button','표로 이동','mini secondary');show.disabled=state.busy;
    show.onclick=()=>act('selection-show',{key:item.key});
    const remove=el('button','제외','mini secondary');remove.disabled=state.busy;
    remove.onclick=()=>act('selection-remove',{key:item.key});
    row.append(show,remove);return row;
  }));
  $('logs').replaceChildren(...state.events.slice(-12).reverse().map(e => el('div', new Date(e.time).toLocaleTimeString('ko-KR', {timeZone:'Asia/Seoul',hour12:false}) + ' ' + (e.step ? e.step + '/7 ' : '') + e.action + (e.count === undefined ? '' : ' · ' + e.count + '개') + (e.title ? ' · ' + e.title : '') + (e.message ? ' · ' + e.message : ''), 'log')));
}
const labels = { refine_index:'목차를 더 구체적으로 지정하세요.', retry_query:'후보 없음 · 목차나 검색어를 바꿔 재시도하세요.', refine_query:'후보가 K를 초과했습니다. 검색어를 추가하세요.', refine_chunk:'읽기 예산 초과 · 더 작은 목차를 지정하세요.', needs_embedding:'복수 후보 · 아래 표를 선택해 원문을 읽거나 검색어를 좁히세요.', evidence_ready:'선택한 원문 표' };
function renderResults() {
  const id = layout.active, value = state.results[id]; $('results').replaceChildren();
  const report=state.reports.find(r=>r.rcpNo===id);
  $('activeReport').textContent=report?report.companyName+' · '+report.reportName:'보고서를 선택하세요.';
  if (!value) return;
  const item = el('div', undefined, 'result');
  item.append(el('b', '후보 ' + (value.count ?? '—') + '개'), el('p', labels[value.status] || value.message || value.status));
  if (value.evidence) {
    const evidence = value.evidence, terms = (value.query || '').split(/\s+/).filter(Boolean);
    const lines = evidence.text.split('\n');
    const hits = lines.filter(line => terms.some(term => line.replace(/\s+/g,'').includes(term.replace(/\s+/g,''))));
    item.append(el('div', [evidence.sectionTitle, evidence.context, ...lines.slice(0, 3), '···', ...hits].join('\n'), 'row'));
    const keep=el('button','이 표를 목록에 추가','mini');keep.disabled=state.busy;
    keep.onclick=()=>act('selection-add',{report:id,id:value.selected,group:$('selectionGroup').value.trim()});item.append(keep);
  }
  for (const candidate of value.candidates || []) {
    const button = el('button', '표 ' + (candidate.tableIndex + 1) + ' · ' + candidate.rows + '행', 'mini secondary');
    button.disabled = state.busy || value.status === 'refine_chunk';
    button.onclick = () => act('read', { report:id, id:candidate.id }); item.append(button);
  }
  $('results').append(item);
}
viewport.addEventListener('scroll', () => {
  if (!layout || panFrame) return;
  panFrame = requestAnimationFrame(() => {
    panFrame = 0;
    const c = layout.canvas, x = c.minX + viewport.scrollLeft / c.zoom, y = c.minY + viewport.scrollTop / c.zoom;
    if (Math.abs(x - c.x) * c.zoom > 1.1 || Math.abs(y - c.y) * c.zoom > 1.1) act('canvas-pan', { x, y });
  });
});
viewport.addEventListener('wheel', event => {
  if (!event.ctrlKey || !layout) return;
  event.preventDefault();
  const r = viewport.getBoundingClientRect();
  act('canvas-zoom', { ratio:layout.canvas.zoom + (event.deltaY > 0 ? -0.1 : 0.1), anchorX:event.clientX-r.left, anchorY:event.clientY-r.top });
}, {passive:false});
new ResizeObserver(() => { if (layout) act('canvas-viewport', {width:viewport.clientWidth,height:viewport.clientHeight}); }).observe(viewport);
$('canvasMinus').onclick = () => act('canvas-zoom', {ratio:layout.canvas.zoom - 0.1});
$('canvasPlus').onclick = () => act('canvas-zoom', {ratio:layout.canvas.zoom + 0.1});
$('canvasRatio').onclick = () => act('canvas-zoom', {ratio:1});
$('sortDirection').onchange=()=>act('reports-sort',{direction:$('sortDirection').value});
$('selectSource').onclick=()=>act('source-mode',{enabled:!state.sourceMode});
$('clearSource').onclick=()=>act('source-clear');
$('keepSource').onclick=()=>act('selection-add',{report:state.source.report,source:'true',group:$('selectionGroup').value.trim()});
$('showSource').onclick=()=>act('source-show');
$('search').onsubmit = event => { event.preventDefault(); act('search', { report:layout.active, indexQuery:$('indexQuery').value.trim(), query:$('query').value.trim(), k:Number($('k').value) }); };
function beginDrag(event, id, edge) {
  if (event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  act('window-raise', {report:id});
  drag = { id, edge, original:{...layout.windows[id]}, startX:event.clientX, startY:event.clientY, x:event.clientX, y:event.clientY, cameraX:layout.canvas.x, cameraY:layout.canvas.y, zoom:layout.canvas.zoom };
  event.currentTarget.setPointerCapture(event.pointerId);
  $('dragShield').hidden = false; $('dragShield').style.cursor = edge === 'move' ? 'grabbing' : getComputedStyle(event.currentTarget).cursor;
  requestAnimationFrame(dragFrame);
}
function updateDrag() {
  if (!drag) return;
  if(drag.mode==='panel') {act('panel-resize',{side:drag.side,width:drag.width+(drag.x-drag.startX)*(drag.side==='left'?1:-1)});return;}
  const d = drag, c = layout.canvas, r = viewport.getBoundingClientRect();
  let panX = 0, panY = 0;
  if (d.x < r.left + 22) panX = -10 / c.zoom;
  else if (d.x > r.right - 30) panX = 10 / c.zoom;
  if (d.y < r.top + 22) panY = -10 / c.zoom;
  else if (d.y > r.bottom - 30) panY = 10 / c.zoom;
  if (panX || panY) act('canvas-pan', {x:c.x+panX,y:c.y+panY});
  const dx = (d.x-d.startX)/d.zoom + c.x-d.cameraX, dy = (d.y-d.startY)/d.zoom + c.y-d.cameraY;
  const w = d.original;
  if (d.edge === 'move') act('window-move', {report:d.id,x:w.x+dx,y:w.y+dy});
  else {
    let x=w.x,y=w.y,width=w.width,height=w.height;
    if (d.edge.includes('e')) width=Math.max(480,w.width+dx);
    if (d.edge.includes('s')) height=Math.max(320,w.height+dy);
    if (d.edge.includes('w')) { width=Math.max(480,w.width-dx); x=w.x+w.width-width; }
    if (d.edge.includes('n')) { height=Math.max(320,w.height-dy); y=w.y+w.height-height; }
    act('window-resize',{report:d.id,x,y,width,height});
  }
}
function dragFrame() { if (!drag) return; updateDrag(); requestAnimationFrame(dragFrame); }
document.addEventListener('pointermove', event => { if (drag) { drag.x=event.clientX; drag.y=event.clientY; } }, true);
function endDrag(event) { if (!drag) return; if (event?.clientX !== undefined) {drag.x=event.clientX;drag.y=event.clientY;} updateDrag(); drag=null; $('dragShield').hidden=true; }
document.addEventListener('pointerup', endDrag, true);
document.addEventListener('pointercancel', () => endDrag(), true);
window.addEventListener('blur', () => endDrag());
for(const side of ['left','right']) {
  $(side==='left'?'toggleLeft':'toggleRight').onclick=()=>act('panel-toggle',{side,collapsed:!layout.panels[side].collapsed});
  $(side==='left'?'resizeLeft':'resizeRight').addEventListener('pointerdown',event=>{
    if(event.button!==0)return;event.preventDefault();
    drag={mode:'panel',side,width:layout.panels[side].width,startX:event.clientX,x:event.clientX};
    event.currentTarget.setPointerCapture(event.pointerId);$('dragShield').hidden=false;$('dragShield').style.cursor='ew-resize';
    requestAnimationFrame(dragFrame);
  });
}
let holdTimer = null, holdFrame = 0, holdStart = 0;
function cancelHold() { clearTimeout(holdTimer); holdTimer=null; cancelAnimationFrame(holdFrame); $('reload').querySelector('i').style.width='0'; }
function holdProgress() { if (!holdTimer) return; $('reload').querySelector('i').style.width=Math.min(100,(performance.now()-holdStart)/10)+'%'; holdFrame=requestAnimationFrame(holdProgress); }
$('reload').addEventListener('pointerdown', event => {
  if (event.button !== 0 || state.busy || holdTimer) return;
  event.preventDefault(); holdStart=performance.now();
  holdTimer=setTimeout(() => { cancelHold(); act('reports-reload'); },1000);
  holdProgress();
});
$('reload').addEventListener('pointerleave',cancelHold);
document.addEventListener('pointerup',cancelHold,true);
document.addEventListener('pointercancel',cancelHold,true);
window.addEventListener('blur',cancelHold);
window.dart.onUpdate(render);
window.dart.onLayout(next => { const previous=layout?.active; renderLayout(next); if (state && previous !== next.active) {renderResults(); $('run').disabled=state.busy || !state.loaded[next.active];} });
window.dart.state().then(next => { render(next); act('canvas-viewport',{width:viewport.clientWidth,height:viewport.clientHeight}); });
