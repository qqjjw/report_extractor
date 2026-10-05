// ===== 입력값: 실수로 인한 초기화를 방지하는 누르기 시간 =====
const REFRESH_HOLD_MS = 1500;
const api = window.canvasApp;
let current;
let holdTimer, holdStarted=0, holdSource=null;
const scrollTargets={};
const listButtons=new Map();
let referenceStamp=null;
function renderNavigation(state) {
  current=state;
  if(!state.viewport || !state.range) return;
  const v=state.viewport,r=state.range,sidebar=document.getElementById('sidebar'),splitter=document.getElementById('splitter');
  sidebar.hidden=splitter.hidden=state.panelCollapsed;
  sidebar.style.width=(v.x-6)+'px';splitter.style.left=(v.x-6)+'px';splitter.style.width='6px';
  document.getElementById('toggle-panel').textContent=state.panelCollapsed?'목록 펼치기':'목록 접기';
  const horizontal=document.getElementById('horizontal-scroll'),vertical=document.getElementById('vertical-scroll');
  Object.assign(horizontal.style,{left:v.x+'px',top:(v.y+v.height)+'px',width:v.width+'px',height:'18px'});
  Object.assign(vertical.style,{left:(v.x+v.width)+'px',top:v.y+'px',width:'18px',height:v.height+'px'});
  document.getElementById('horizontal-space').style.width=(r.maxX-r.minX)+'px';
  document.getElementById('vertical-space').style.height=(r.maxY-r.minY)+'px';
  // 프로그램 갱신으로 발생한 scroll 이벤트는 사용자 이동으로 다시 보내지 않습니다.
  horizontal.scrollLeft=-state.pan.x-r.minX;vertical.scrollTop=-state.pan.y-r.minY;
  scrollTargets.horizontal=horizontal.scrollLeft;scrollTargets.vertical=vertical.scrollTop;
  horizontal.setAttribute('aria-disabled',String(r.maxX-r.minX<=v.width));vertical.setAttribute('aria-disabled',String(r.maxY-r.minY<=v.height));
  const list=document.getElementById('report-list'),ids=new Set(state.cards.map(c=>c.rcpNo));
  for(const [id,button] of listButtons)if(!ids.has(id)){button.remove();listButtons.delete(id);}
  state.cards.forEach((card,index)=>{
    let button=listButtons.get(card.rcpNo);
    if(!button){button=document.createElement('div');button.className='list-item';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='target-check';checkbox.setAttribute('aria-label',card.companyName+' '+card.reportName+'에 적용');checkbox.onchange=()=>api.command('target-toggle',card.rcpNo).then(render);
      const focus=document.createElement('button');focus.className='report-focus';focus.onclick=()=>api.command('focus',card.rcpNo).then(render);button.append(checkbox,focus);listButtons.set(card.rcpNo,button);}
    button.classList.toggle('selected',state.selected===card.rcpNo);button.setAttribute('aria-pressed',String(state.selected===card.rcpNo));
    button.querySelector('input').checked=state.targetSelection.includes(card.rcpNo);
    const text=[card.companyName,card.reportName,card.receivedDate+' · '+card.status+' · 선택 '+(card.selectedCount||0)+'개',card.review?[card.review.state,'기준: '+card.review.sourcePath,card.review.candidatePath?'후보: '+card.review.candidatePath:'',card.review.reason||'',card.review.total?'후보 '+card.review.position+'/'+card.review.total:''].filter(Boolean).join(' · '):''];
    if(button.dataset.text!==JSON.stringify(text)){button.querySelector('button').replaceChildren(...text.map((value,i)=>{const node=document.createElement(i===0?'strong':'span');node.textContent=value;if(i===1)node.className='name';return node;}));button.dataset.text=JSON.stringify(text);}
    if(list.children[index]!==button)list.insertBefore(button,list.children[index]||null);
  });
}
function render(state) {
  if (!state) return;
  if (!document.getElementById('refresh')) { document.getElementById('empty').hidden = state.cards.length > 0; document.getElementById('empty').textContent = state.loading ? '보고서를 불러오는 중입니다.' : '수집된 보고서가 없습니다. 수집 앱에서 목록을 만든 뒤 새로고침하세요.'; return; }
  renderNavigation(state);
  renderTableForm(state);
  renderSelections(state);
  document.getElementById('search-summary').textContent=state.searchMessage||('적용 대상 '+state.targetSelection.length+'개');
  document.getElementById('refresh').disabled = state.loading||state.searchBusy||state.exportBusy||state.selectionBusy;
  if(document.getElementById('refresh').disabled)cancelHold();
  document.getElementById('refresh').textContent = state.loading ? '불러오는 중…' : '1.5초 눌러 새로고침';
  document.getElementById('zoom-value').textContent = `${Math.round(state.zoom * 100)}%`;
  document.getElementById('count').textContent = `${state.cards.length}개 · ${state.cards.filter(card=>card.status==='열림').length}개 열림`;
  document.getElementById('error').hidden = !state.error;
  document.getElementById('error').textContent = state.error;
  document.getElementById('empty').hidden = state.cards.length > 0;
  document.getElementById('empty').textContent = state.loading ? '보고서를 불러오는 중입니다.' : 'reports.json에 보고서가 없습니다. 수집 앱에서 목록을 만든 뒤 새로고침하세요.';
}
for(const id of ['target-all','target-none','toggle-panel','align','asc','desc','zoom-out','zoom-in','zoom-reset']) if(document.getElementById(id)) document.getElementById(id).onclick=()=>api.command(id).then(render);
let active = false;
document.getElementById('background').onpointerdown = event => {
  if(event.button!==0) return;
  active=true; event.currentTarget.setPointerCapture(event.pointerId); api.begin('pan',null,event.screenX,event.screenY);
};
document.addEventListener('pointermove',event=>{if(active)api.move(event.screenX,event.screenY,event.buttons===0);});
document.addEventListener('pointerup',event=>{if(active){active=false;api.move(event.screenX,event.screenY,true);}});
if(document.getElementById('splitter'))document.getElementById('splitter').onpointerdown=event=>{if(event.button!==0)return;active=true;event.currentTarget.setPointerCapture(event.pointerId);api.begin('panel',null,event.screenX,event.screenY);};
for(const axis of ['horizontal','vertical']) {
  const bar=document.getElementById(axis+'-scroll');if(!bar)continue;
  bar.addEventListener('scroll',()=>{
    if(!current?.range)return;
    const expected=axis==='horizontal'?-current.pan.x-current.range.minX:-current.pan.y-current.range.minY;
    const actual=axis==='horizontal'?bar.scrollLeft:bar.scrollTop;
    if(Math.abs(expected-actual)<1 || Math.abs(scrollTargets[axis]-actual)<1)return;
    scrollTargets[axis]=actual;
    api.scroll(axis==='horizontal'?current.range.minX+actual:-current.pan.x,axis==='vertical'?current.range.minY+actual:-current.pan.y);
  });
}
function cancelHold() {
  clearTimeout(holdTimer);holdTimer=null;holdSource=null;holdStarted=0;
  document.getElementById('refresh')?.classList.remove('holding');
}
function startHold(source) {
  const button=document.getElementById('refresh');
  if(!button || button.disabled || holdSource)return;
  holdSource=source;holdStarted=performance.now();button.classList.add('holding');
  holdTimer=setTimeout(()=>{
    if(!holdSource || button.disabled || performance.now()-holdStarted<REFRESH_HOLD_MS){cancelHold();return;}
    cancelHold();button.disabled=true;api.command('refresh').then(render);
  },REFRESH_HOLD_MS);
}
const refreshButton=document.getElementById('refresh');
if(refreshButton) {
  refreshButton.style.setProperty('--hold-duration',REFRESH_HOLD_MS+'ms');
  refreshButton.addEventListener('click',event=>event.preventDefault());
  refreshButton.addEventListener('pointerdown',event=>{if(event.button===0){event.preventDefault();refreshButton.focus();startHold('pointer');}});
  for(const type of ['pointerleave','pointercancel','blur'])refreshButton.addEventListener(type,cancelHold);
  document.addEventListener('pointerup',()=>{if(holdSource==='pointer')cancelHold();});
  refreshButton.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();if(!event.repeat)startHold(event.key);}});
  refreshButton.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();cancelHold();}});
  window.addEventListener('blur',cancelHold);
}
api.onState(render); api.state().then(render);

function renderTableForm(state){
 const form=document.getElementById('table-search-form');if(!form)return;
 const ref=state.tableReference;form.hidden=!ref;
 if(!ref){referenceStamp=null;return;}
 document.getElementById('reference-path').textContent=ref.path;
 document.getElementById('reference-preview').textContent=ref.preview;
 if(referenceStamp!==ref.stamp){referenceStamp=ref.stamp;
  document.getElementById('table-section').value=ref.section;
  document.getElementById('table-keywords').value=ref.keywords.join('\n');
  const choices=document.getElementById('keyword-choices');choices.replaceChildren();
  for(const cell of ref.cells){const button=document.createElement('button');button.type='button';button.textContent=cell;button.title=cell;button.onclick=()=>{const input=document.getElementById('table-keywords'),words=input.value.split(/\n|,/).map(s=>s.trim()).filter(Boolean),parts=cell.split(',').map(s=>s.trim()).filter(Boolean);input.value=(parts.every(s=>words.includes(s))?words.filter(s=>!parts.includes(s)):[...new Set([...words,...parts])]).join('\n');};choices.append(button);}
 }
 for(const id of ['run-table-search','save-table-options'])document.getElementById(id).disabled=state.searchBusy||state.exportBusy||state.selectionBusy;
}
// ===== 처리 로직: 선택 표 목록에는 전문 대신 최대 3×4 셀 미리보기만 표시 =====
let selectionSignature='';
function renderSelections(state){
 const list=document.getElementById('selection-list');if(!list)return;
 const busy=state.searchBusy||state.exportBusy||state.selectionBusy;
 document.getElementById('selection-total').textContent=state.selectedTables.length;
 document.getElementById('selection-message').textContent=state.selectionMessage||'표 선택 ON에서 원하는 표를 클릭하세요.';
 document.getElementById('export-selections').disabled=busy||state.loading||!state.selectedTables.length;
 const signature=JSON.stringify([state.selectedTables,state.cards.map(c=>[c.rcpNo,c.reportYear]),busy]);if(signature===selectionSignature)return;selectionSignature=signature;
 const expanded=new Map([...list.querySelectorAll('details')].map(d=>[d.dataset.id,d.open]));list.replaceChildren();
 const text=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el;};
 for(const card of state.cards){
  const items=state.selectedTables.filter(i=>i.rcpNo===card.rcpNo),details=document.createElement('details');details.dataset.id=card.rcpNo;details.open=expanded.get(card.rcpNo)??items.length>0;
  details.append(text('summary',`${card.companyName} · ${card.reportName} · ${items.length}개`));
  if(!card.reportYear){const label=text('label','보고서 연도 '),input=document.createElement('input');input.type='number';input.min=1900;input.max=9999;input.placeholder='예: 2023';input.disabled=busy;input.onchange=()=>api.command('report-year',card.rcpNo,{year:input.value}).then(render);label.append(input);details.append(label);}
  for(const item of items){
   const article=document.createElement('article');article.className='selection-item';article.append(text('strong',`${item.year}년 · ${item.rowCount}행 × ${item.columnCount}열`));
   const label=text('label','그룹 G'),input=document.createElement('input');input.type='number';input.min=1;input.step=1;input.value=item.group;input.disabled=busy;input.onchange=()=>api.command('selection-group',item.id,{group:input.value}).then(render);label.append(input);article.append(label,text('div',item.path));
   const preview=document.createElement('table');for(const row of item.preview){const tr=document.createElement('tr');for(const value of row)tr.append(text('td',value));preview.append(tr);}article.append(preview);
   if(item.error){const error=text('p',item.error);error.className='selection-error';article.append(error);}
   for(const [title,action]of [['원문 보기','selection-show'],['선택 취소','selection-remove']]){const button=text('button',title);button.disabled=busy;button.onclick=()=>api.command(action,item.id).then(render);article.append(button);}
   details.append(article);
  }
  list.append(details);
 }
}
for(const tab of ['reports','selections'])document.getElementById(tab+'-tab')?.addEventListener('click',()=>{
 document.getElementById('reports-panel').hidden=tab!=='reports';document.getElementById('selections-panel').hidden=tab!=='selections';for(const name of ['reports','selections'])document.getElementById(name+'-tab').classList.toggle('active',name===tab);
});
document.getElementById('export-selections')?.addEventListener('click',()=>api.command('export-selections').then(render));
function tableOptions(){return {section:document.getElementById('table-section').value,keywords:document.getElementById('table-keywords').value};}
const tableForm=document.getElementById('table-search-form');
if(tableForm){tableForm.onsubmit=event=>{event.preventDefault();if(current?.tableReference)api.command('search-table',current.tableReference.sourceId,tableOptions()).then(render);};
 document.getElementById('save-table-options').onclick=()=>{if(current?.tableReference)api.command('table-options',current.tableReference.sourceId,tableOptions()).then(render);};
}
