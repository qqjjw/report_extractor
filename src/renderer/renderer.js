const $ = id => document.getElementById(id);
const viewport = $('viewport'), world = $('world');
let cards = [], selected = null, scale = 1, bounds = { minX: 0, minY: 0 }, action = null, busy = false, generation = 0;
const hint = '제목 드래그: 이동 · 모서리: 크기 변경 · Ctrl+휠: 줌 · 빈 공간 드래그: 시점 이동';
let tableSource=null, tableRun=0, tableResults=new Map(), tableRequests=new Map(), tableSearching=false;
let selectionSequence=0;
const searchTargets=new Set();
function eligibleTarget(c){const source=cards.find(card=>card.rcpNo===tableSource?.reportId);return Boolean(source&&c.rcpNo!==source.rcpNo&&c.companyName===source.companyName&&c.period&&source.period&&c.period.slice(0,4)!==source.period.slice(0,4));}
function refreshTargets(){
  for(const c of cards){const eligible=eligibleTarget(c);if(!eligible)searchTargets.delete(c.rcpNo);if(c.targetCheckbox){c.targetCheckbox.checked=searchTargets.has(c.rcpNo);c.targetCheckbox.disabled=tableSearching||!eligible;}c.tableUI?.targets(searchTargets.size,tableSearching);}
  // Eligibility pruning may change the final count after an earlier card was rendered.
  for(const c of cards)c.tableUI?.targets(searchTargets.size,tableSearching);
  $('targets-count').textContent=`검색 대상 ${searchTargets.size}개`;
  $('targets-all').disabled=tableSearching||!cards.some(eligibleTarget);$('targets-none').disabled=tableSearching||!searchTargets.size;
}
$('targets-all').onclick=()=>{if(tableSearching)return;for(const c of cards)if(eligibleTarget(c))searchTargets.add(c.rcpNo);refreshTargets();};
$('targets-none').onclick=()=>{if(tableSearching)return;searchTargets.clear();refreshTargets();};
async function cancelTableSearch() {
  tableRun++;tableSearching=false;
  const ids=[...tableRequests.keys()];tableRequests.clear();
  for(const c of cards)c.tableUI?.busy(false);
  await Promise.all(ids.map(id=>window.reportsAPI.cancelTables?.(id)));
  await window.reportsAPI.cancelTables?.();
  refreshTargets();
}
async function tableMode(c,button) {
  try {
    const enabled=button.getAttribute('aria-pressed')!=='true';
    for(const other of cards)if(other!==c){other.tableUI.mode(false);await window.reportsAPI.tableMode?.({guestId:other.site.getWebContentsId(),reportId:other.rcpNo,enabled:false});}
    const response=await window.reportsAPI.tableMode({guestId:c.site.getWebContentsId(),reportId:c.rcpNo,enabled});
    if(!response.ok)throw new Error(response.error);c.tableUI.mode(enabled);
    c.tableUI.status(enabled?'선택 모드: 본문의 표를 클릭하세요.':'선택 모드 종료');
  } catch(e){c.tableUI.status(e.message);}
}
async function showCandidate(c,candidate,run=tableRun) {
  if(!candidate || run!==tableRun)return;
  const sequence=c.showSequence=(c.showSequence||0)+1;c.tableUI.busy(true);
  try {
    await window.reportsAPI.cancelTables?.(`${run}:${c.rcpNo}`);
    if(run!==tableRun || sequence!==c.showSequence || !cards.includes(c))return;
    const result=await window.reportsAPI.showTable({guestId:c.site.getWebContentsId(),reportId:c.rcpNo,table:candidate.table,searchId:`${run}:${c.rcpNo}`});
    if(run!==tableRun || sequence!==c.showSequence || !cards.includes(c))return;
    if(!result.ok)c.tableUI.status(`표 표시 실패: ${result.error}`);
    const state=tableResults.get(c.rcpNo);if(state)state.selectedCandidateId=candidate.id;
  } catch(e){if(run===tableRun && sequence===c.showSequence)c.tableUI.status(e.message);}
  finally {if(run===tableRun && sequence===c.showSequence)c.tableUI.busy(false);}
}
async function searchOne(c,input,run) {
  const requestId=`${run}:${c.rcpNo}`;tableRequests.set(requestId,c);c.tableUI.busy(true);c.tableUI.status('선택 목차의 본문에서 표를 찾는 중…');
  try {
    const response=await window.reportsAPI.searchTables({requestId,guestId:c.site.getWebContentsId(),source:tableSource,toc:c.tocSession.toc,input,mode:input.mode||'rule'});
    if(run!==tableRun || !cards.includes(c))return;
    const result=response.ok?response.result:{mode:input.mode||'rule',report:c.tocSession.toc.report,status:'error',candidates:[],errors:[{error:response.error}]};
    tableResults.set(c.rcpNo,result);c.tableUI.result(result);
    if(result.candidates.length)await showCandidate(c,result.candidates[0],run);
  } catch(e){if(run===tableRun){const result={mode:input.mode||'rule',status:'error',candidates:[],errors:[{error:e.message}]};tableResults.set(c.rcpNo,result);c.tableUI.result(result);}}
  finally {tableRequests.delete(requestId);if(run===tableRun)c.tableUI.busy(false);}
}
async function searchTables(input,onlyReportId) {
  if(!tableSource||tableSearching)return;
  const targets=cards.filter(c=>searchTargets.has(c.rcpNo)&&eligibleTarget(c)&&(!onlyReportId||c.rcpNo===onlyReportId));
  if(!targets.length){refreshTargets();return;}
  await cancelTableSearch();const run=tableRun;tableSearching=true;
  const source=cards.find(c=>c.rcpNo===tableSource.reportId);if(!source)return;
  source.lastTableInput=input;source.tableUI.busy(true);source.tableUI.status('다른 연도 보고서에서 검색 중…');
  for(const c of targets)tableResults.delete(c.rcpNo);refreshTargets();
  await Promise.all(targets.map(c=>window.reportsAPI.tableMode({guestId:c.site.getWebContentsId(),reportId:c.rcpNo,enabled:false,clear:true}).catch(()=>{})));
  await Promise.all(targets.map(c=>searchOne(c,input,run)));
  if(run===tableRun){tableSearching=false;source.tableUI.busy(false);refreshTargets();source.tableUI.status(`검색 완료 · ${targets.length}개 보고서 · 각 보고서 아래 결과를 확인하세요.`);}
}
window.reportsAPI.onTableSelected?.(async payload=> {
  const c=cards.find(c=>c.rcpNo===payload.reportId);if(!c || c.site.getWebContentsId()!==payload.guestId)return;
  const sequence=++selectionSequence;
  await cancelTableSearch();tableResults.clear();
  if(sequence!==selectionSequence||!cards.includes(c))return;
  let tocPath=[];
  for(const section of TableRules.sections(c.tocSession.toc.nodes)) {
    try {if(TableRules.sameDocument(TableRules.viewerUrl(section.sourceRef,c.rcpNo),payload.table.documentUrl))tocPath=section.path;}catch{}
  }
  tableSource={...payload.table,reportId:c.rcpNo,tocPath};
  refreshTargets();
  for(const other of cards)other.tableUI.reset();
  await Promise.all(cards.filter(other=>other!==c).map(other=>window.reportsAPI.tableMode({guestId:other.site.getWebContentsId(),reportId:other.rcpNo,enabled:false,clear:true}).catch(()=>{})));
  if(sequence!==selectionSequence||!cards.includes(c))return;
  await window.reportsAPI.tableMode({guestId:c.site.getWebContentsId(),reportId:c.rcpNo,enabled:false,selection:tableSource}).catch(()=>{});
  if(sequence!==selectionSequence||!cards.includes(c))return;
  c.tableUI.selection(tableSource);c.tableUI.status('표 선택 완료 · 분홍 테두리의 표를 기준으로 검색합니다.');select(c);
});
window.reportsAPI.onTableStatus?.(payload=> {
  if(payload.type==='error'&&payload.guestId){const c=cards.find(c=>{try{return c.site.getWebContentsId()===payload.guestId;}catch{return false;}});c?.tableUI.status(payload.message);return;}
  if(payload.type==='progress'){const c=tableRequests.get(payload.requestId);c?.tableUI.status(`${payload.stage||'검색 중'} · ${payload.scanned}/${payload.total} 구간 · 추출 ${payload.extracted||0}개 · 후보 ${payload.candidates}개 · ${(payload.path||[]).at(-1)||''}`);}
  else if(tableSearching)for(const c of new Set(tableRequests.values()))c.tableUI.status(payload.message);
});
window.getTableSearchSnapshot=()=>JSON.parse(JSON.stringify({schemaVersion:1,source:tableSource,searching:tableSearching,targetReportIds:[...searchTargets],results:[...tableResults.values()]}));
function layout(preserve = true) {
  const next = ReportModel.bounds(cards, viewport.clientWidth / scale, viewport.clientHeight / scale);
  const sx = viewport.scrollLeft + (bounds.minX - next.minX) * scale;
  const sy = viewport.scrollTop + (bounds.minY - next.minY) * scale;
  bounds = next;
  $('spacer').style.width = `${(bounds.maxX - bounds.minX) * scale}px`;
  $('spacer').style.height = `${(bounds.maxY - bounds.minY) * scale}px`;
  world.style.transform = `scale(${scale}) translate(${-bounds.minX}px, ${-bounds.minY}px)`;
  for (const c of cards) {
    Object.assign(c.el.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h + 40 + (c.extraHeight || 0)}px` });
    c.el.style.setProperty('--site-height',`${c.h}px`);
    c.size.textContent = `${c.w} × ${c.h}`;
  }
  if (preserve) { viewport.scrollLeft = sx; viewport.scrollTop = sy; }
  $('zoom').textContent = `${Math.round(scale * 100)}%`;
}
function select(c) {
  selected = c;
  for (const card of cards) { card.el.classList.toggle('selected', card === c); card.row.classList.toggle('selected', card === c); card.el.style.zIndex = card === c ? '2' : '1'; }
  $('apply').disabled = !c;
}
function center(c) {
  select(c);
  viewport.scrollLeft = (c.x - bounds.minX + c.w / 2) * scale - viewport.clientWidth / 2;
  viewport.scrollTop = (c.y - bounds.minY + (c.h + 40 + (c.extraHeight || 0)) / 2) * scale - viewport.clientHeight / 2;
}
function origin() {
  viewport.scrollLeft = -bounds.minX * scale;
  viewport.scrollTop = -bounds.minY * scale;
}
function arrange() {
  cards = ReportModel.sort(cards, $('sort').value);
  let x = 64;
  for (const c of cards) { c.x = x; c.y = 64; x += c.w + 32; $('list').append(c.row, c.tocPanel.row); }
  layout(false); origin();
}
function begin(event, kind, c) {
  if (event.button !== 0) return;
  event.preventDefault();
  if (c) select(c);
  action = { kind, c, x: event.clientX, y: event.clientY };
  document.body.classList.add('interacting');
}
window.addEventListener('pointermove', event => {
  if (!action) return;
  const dx = event.clientX - action.x, dy = event.clientY - action.y;
  action.x = event.clientX; action.y = event.clientY;
  if (action.kind === 'pan') { viewport.scrollLeft -= dx; viewport.scrollTop -= dy; }
  else if (action.kind === 'panel') { $('panel').style.width = `${Math.max(240, Math.min(650, $('panel').getBoundingClientRect().width + dx))}px`; layout(); }
  else {
    const c = action.c;
    if (action.kind === 'move') { c.x += dx / scale; c.y += dy / scale; }
    else { c.w = Math.max(480, Math.round(c.w + dx / scale)); c.h = Math.max(320, Math.round(c.h + dy / scale)); }
    layout();
  }
});
function end() { action = null; document.body.classList.remove('interacting'); }
window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
window.addEventListener('blur', () => { end(); cancelHold(); });
viewport.addEventListener('pointerdown', event => {
  if (['viewport', 'spacer', 'world', 'empty'].includes(event.target.id)) begin(event, 'pan');
});
$('splitter').addEventListener('pointerdown', event => begin(event, 'panel'));
function zoom(direction, clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  const x = Math.max(0, Math.min(viewport.clientWidth, clientX - rect.left));
  const y = Math.max(0, Math.min(viewport.clientHeight, clientY - rect.top));
  const wx = (viewport.scrollLeft + x) / scale + bounds.minX;
  const wy = (viewport.scrollTop + y) / scale + bounds.minY;
  scale = Math.max(.25, Math.min(2, scale * (direction === 'in' ? 1.1 : 1 / 1.1)));
  layout(false);
  viewport.scrollLeft = (wx - bounds.minX) * scale - x;
  viewport.scrollTop = (wy - bounds.minY) * scale - y;
}
viewport.addEventListener('wheel', event => {
  if (!event.ctrlKey) return;
  event.preventDefault(); zoom(event.deltaY < 0 ? 'in' : 'out', event.clientX, event.clientY);
}, { passive: false });
window.reportsAPI.onZoom(p => zoom(p.direction, p.x, p.y));
function createCard(report) {
  const c = { ...report, x: 64, y: 64, w: 1200, h: 900, extraHeight:280 };
  c.el = document.createElement('article'); c.el.className = 'card';
  const title = document.createElement('div'); title.className = 'title';
  const name = document.createElement('strong'); name.textContent = `${c.companyName} · ${c.reportName}`;
  c.size = document.createElement('small'); title.append(name, c.size);
  const site = document.createElement('webview'); site.className = 'site'; site.src = c.url;
  c.site = site;
  c.tableUI=TableUI.attach(report,{mode:button=>tableMode(c,button),search:searchTables,cancel:()=>{cancelTableSearch();c.tableUI.status('검색 취소됨');},
    show:candidate=>showCandidate(c,candidate),retry:()=>{const source=cards.find(c=>c.rcpNo===tableSource?.reportId);if(source)searchTables(source.lastTableInput||{include:[],exclude:[]},c.rcpNo);},hasSource:()=>tableSource?.reportId===c.rcpNo});
  const error = document.createElement('div'); error.className = 'error';
  site.addEventListener('did-fail-load', event => {
    if (event.errorCode === -3) return;
    if(!event.isMainFrame){c.tableUI.status(`보고서 본문 로딩 실패: ${event.errorDescription} · 자동 재시도 후에도 안 열리면 해당 목차를 다시 클릭하세요.`);return;}
    error.textContent = `사이트 로딩 실패: ${event.errorDescription}`; c.el.classList.add('failed');
    c.tocSession.reset(`사이트 로딩 실패: ${event.errorDescription}`);
  });
  site.addEventListener('did-start-loading', () => c.el.classList.remove('failed'));
  site.addEventListener('focus', () => select(c));
  const handle = document.createElement('div'); handle.className = 'handle'; handle.title = '드래그하여 크기 변경';
  title.addEventListener('pointerdown', e => begin(e, 'move', c));
  handle.addEventListener('pointerdown', e => begin(e, 'resize', c));
  c.el.append(title, site, c.tableUI.el, error, handle); world.append(c.el);
  c.row = document.createElement('tr'); c.row.tabIndex = 0;
  for (const text of [c.companyName, c.reportName, c.period || '기간 없음', c.receivedDate]) {
    const cell = document.createElement('td'); cell.textContent = text; c.row.append(cell);
  }
  c.row.addEventListener('click', () => center(c));
  c.row.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === c.row) center(c); });
  const cardGeneration = generation;
  c.tocPanel = TocPanel.attach(report, c.row, () => c.tocSession.run());
  const targetCell=document.createElement('td');c.targetCheckbox=document.createElement('input');c.targetCheckbox.type='checkbox';c.targetCheckbox.disabled=true;c.targetCheckbox.className='search-target';c.targetCheckbox.setAttribute('aria-label',`${c.companyName} ${c.reportName} 검색 대상`);targetCell.append(c.targetCheckbox);c.row.prepend(targetCell);c.tocPanel.row.firstChild.colSpan=6;
  targetCell.addEventListener('click',event=>event.stopPropagation());targetCell.addEventListener('keydown',event=>event.stopPropagation());
  c.targetCheckbox.onchange=()=>{if(tableSearching||!eligibleTarget(c)){refreshTargets();return;}if(c.targetCheckbox.checked)searchTargets.add(c.rcpNo);else searchTargets.delete(c.rcpNo);refreshTargets();};
  c.tocSession = new TocSession(report, () => site.executeJavaScript(TocExtractor.script),
    toc => c.tocPanel.update(toc), () => generation === cardGeneration && cards.includes(c));
  site.addEventListener('did-start-navigation', event => { if (event.isMainFrame && !event.isInPlace) c.tocSession.reset(); });
  site.addEventListener('did-navigate', () => c.tocSession.reset());
  site.addEventListener('dom-ready', () => c.tocSession.run());
  site.addEventListener('destroyed', () => c.tocSession.dispose());
  return c;
}
async function reload() {
  if (busy) return;
  busy = true; $('reload').disabled = true; $('status').textContent = 'reports.json을 읽는 중…';
  try {
    const result = await window.reportsAPI.read();
    if (!result.ok) throw new Error(result.error);
    end();
    await cancelTableSearch();tableSource=null;tableResults.clear();searchTargets.clear();
    for (const c of cards) c.tocSession.dispose();
    world.replaceChildren(); $('list').replaceChildren(); selected = null; $('apply').disabled = true;
    generation++;
    cards = result.reports.map(createCard); scale = 1; bounds = { minX: 0, minY: 0 };
    refreshTargets();
    arrange(); $('count').textContent = `${cards.length}건`;
    $('empty').textContent = '불러온 보고서가 없습니다. data/reports.json을 확인하세요.';
    $('empty').hidden = cards.length > 0;
    $('status').textContent = hint;
  } catch (error) {
    $('status').textContent = `JSON 읽기 실패: ${error.message}`;
    if (!cards.length) { $('empty').hidden = false; $('empty').textContent = '보고서 목록을 불러오지 못했습니다.'; }
  } finally { busy = false; $('reload').disabled = false; }
}
let hold = null, timer = null;
function cancelHold() { clearTimeout(timer); hold = null; $('progress').style.transition = 'none'; $('progress').style.width = '0'; }
$('reload').addEventListener('pointerdown', e => {
  if (e.button !== 0 || busy) return;
  e.preventDefault(); cancelHold(); hold = e.pointerId;
  $('progress').style.width = '0'; void $('progress').offsetWidth;
  $('progress').style.transition = 'width 1.5s linear'; $('progress').style.width = '100%';
  timer = setTimeout(() => { if (hold !== null && document.hasFocus()) { cancelHold(); reload(); } }, 1500);
});
$('reload').addEventListener('pointerleave', cancelHold);
window.addEventListener('pointerup', cancelHold); window.addEventListener('pointercancel', cancelHold);
$('toggle').onclick = () => { document.body.classList.toggle('collapsed'); layout(); };
$('sort').onchange = arrange; $('arrange').onclick = arrange; $('origin').onclick = origin;
$('apply').onclick = () => { if (!selected) return; for (const c of cards) { c.w = selected.w; c.h = selected.h; } layout(); };
new ResizeObserver(() => layout()).observe(viewport);
window.getTocSnapshot = () => TocModel.snapshot(cards.map(c => c.tocSession.toc));
window.runSmokeTests = async () => {
  const checks = [];
  const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
  check('reports and embedded sites', cards.length === 10 && world.querySelectorAll('webview').length === 10);
  const sites = await Promise.all(cards.map(async c => {
    const v = c.el.querySelector('webview');
    try { return { id: c.rcpNo, url: v.getURL(), loading: v.isLoading(), title: await Promise.race([v.executeJavaScript('document.title'), new Promise((_, reject) => setTimeout(() => reject(new Error('사이트 응답 시간 초과')), 3000))]), failed: c.el.classList.contains('failed') }; }
    catch (e) { return { id: c.rcpNo, error: e.message }; }
  }));
  check('DART loaded', sites.every(s => s.url?.startsWith('https://dart.fss.or.kr/') && s.title && !s.failed));
  const tocSnapshot = window.getTocSnapshot();
  check('all DART TOCs extracted', tocSnapshot.reports.length === cards.length && tocSnapshot.reports.every(t => t.status === 'ready' && t.nodes.length > 0));
  const firstToggle = cards[0].row.querySelector('.toc-toggle'); firstToggle.click();
  check('expand report TOC', !cards[0].tocPanel.row.hidden); firstToggle.click();
  check('collapse report keeps data', cards[0].tocPanel.row.hidden && JSON.stringify(window.getTocSnapshot()) === JSON.stringify(tocSnapshot));
  const c = cards[0]; select(c); c.w = 1000; c.h = 700; $('apply').click();
  check('apply size', cards.every(x => x.w === 1000 && x.h === 700));
  c.x = -800; c.y = -600; layout(); check('negative canvas expansion', bounds.minX <= -864 && bounds.minY <= -664);
  center(c); check('center selected', Math.abs(viewport.scrollLeft + viewport.clientWidth / 2 - (c.x - bounds.minX + c.w / 2) * scale) < 2);
  zoom('out', 900, 400); check('zoom', scale < 1);
  scale = .25; layout(); center(c);
  check('center at 25% zoom', Math.abs(viewport.scrollLeft + viewport.clientWidth / 2 - (c.x - bounds.minX + c.w / 2) * scale) < 2 && Math.abs(viewport.scrollTop + viewport.clientHeight / 2 - (c.y - bounds.minY + (c.h + 40 + c.extraHeight) / 2) * scale) < 2);
  $('sort').value = 'asc'; arrange(); check('ascending period', cards[0].period === '2016.12');
  $('sort').value = 'desc'; arrange(); check('descending period', cards[0].period === '2025.12');
  $('toggle').click(); check('collapse panel', $('panel').getBoundingClientRect().width === 0); $('toggle').click();
  const before = generation;
  $('reload').dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 9 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9 }));
  await new Promise(resolve => setTimeout(resolve, 1600));
  check('short click does not reload', generation === before);
  $('reload').dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 9 }));
  $('reload').dispatchEvent(new PointerEvent('pointerleave', { pointerId: 9 }));
  await new Promise(resolve => setTimeout(resolve, 1600));
  check('leaving button cancels reload', generation === before);
  if (document.hasFocus()) {
    $('reload').dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 9 }));
    await new Promise(resolve => setTimeout(resolve, 1800));
    check('long press reloads once', generation === before + 1 && scale === 1 && cards.every(c => c.w === 1200 && c.h === 900));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9 }));
  } else check('long press test requires focused window', false);
  for (const card of cards) { card.w = 1200; card.h = 900; } scale = 1; arrange(); select(cards[0]);
  return { ok: checks.every(c => c.ok), checks, sites };
};
reload();
