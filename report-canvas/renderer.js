// ===== 입력값: 실수로 인한 초기화를 방지하는 누르기 시간 =====
const REFRESH_HOLD_MS = 1500;
const api = window.canvasApp;
let current;
let holdTimer, holdStarted=0, holdSource=null;
const scrollTargets={};
const listButtons=new Map();
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
    if(!button){button=document.createElement('button');button.className='list-item';button.onclick=()=>api.command('focus',card.rcpNo).then(render);listButtons.set(card.rcpNo,button);}
    button.classList.toggle('selected',state.selected===card.rcpNo);button.setAttribute('aria-pressed',String(state.selected===card.rcpNo));
    const text=[card.companyName,card.reportName,card.receivedDate+' · '+card.status];
    if(button.dataset.text!==JSON.stringify(text)){button.replaceChildren(...text.map((value,i)=>{const node=document.createElement(i===0?'strong':'span');node.textContent=value;if(i===1)node.className='name';return node;}));button.dataset.text=JSON.stringify(text);}
    if(list.children[index]!==button)list.insertBefore(button,list.children[index]||null);
  });
}
function render(state) {
  if (!state) return;
  if (!document.getElementById('refresh')) { document.getElementById('empty').hidden = state.cards.length > 0; document.getElementById('empty').textContent = state.loading ? '보고서를 불러오는 중입니다.' : '수집된 보고서가 없습니다. 수집 앱에서 목록을 만든 뒤 새로고침하세요.'; return; }
  renderNavigation(state);
  document.getElementById('refresh').disabled = state.loading;
  if(state.loading)cancelHold();
  document.getElementById('refresh').textContent = state.loading ? '불러오는 중…' : '1.5초 눌러 새로고침';
  document.getElementById('zoom-value').textContent = `${Math.round(state.zoom * 100)}%`;
  document.getElementById('count').textContent = `${state.cards.length}개 · ${state.cards.filter(card=>card.status==='열림').length}개 열림`;
  document.getElementById('error').hidden = !state.error;
  document.getElementById('error').textContent = state.error;
  document.getElementById('empty').hidden = state.cards.length > 0;
  document.getElementById('empty').textContent = state.loading ? '보고서를 불러오는 중입니다.' : 'reports.json에 보고서가 없습니다. 수집 앱에서 목록을 만든 뒤 새로고침하세요.';
}
for(const id of ['toggle-panel','align','asc','desc','zoom-out','zoom-in','zoom-reset']) if(document.getElementById(id)) document.getElementById(id).onclick=()=>api.command(id).then(render);
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
