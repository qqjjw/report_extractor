const api = window.canvasApp;
function render(state) {
  if (!state) return;
  if (!document.getElementById('refresh')) { document.getElementById('empty').hidden = state.cards.length > 0; document.getElementById('empty').textContent = state.loading ? '보고서를 불러오는 중입니다.' : '수집된 보고서가 없습니다. 수집 앱에서 목록을 만든 뒤 새로고침하세요.'; return; }
  document.getElementById('refresh').disabled = state.loading;
  document.getElementById('refresh').textContent = state.loading ? '불러오는 중…' : '목록 새로고침';
  document.getElementById('zoom-value').textContent = `${Math.round(state.zoom * 100)}%`;
  document.getElementById('count').textContent = `${state.cards.length}개 · ${state.cards.filter(card=>card.status==='열림').length}개 열림`;
  document.getElementById('error').hidden = !state.error;
  document.getElementById('error').textContent = state.error;
  document.getElementById('empty').hidden = state.cards.length > 0;
  document.getElementById('empty').textContent = state.loading ? '보고서를 불러오는 중입니다.' : 'reports.json에 보고서가 없습니다. 수집 앱에서 목록을 만든 뒤 새로고침하세요.';
}
for(const id of ['refresh','align','asc','desc','zoom-out','zoom-in','zoom-reset']) if(document.getElementById(id)) document.getElementById(id).onclick=()=>api.command(id).then(render);
let active = false;
document.getElementById('background').onpointerdown = event => {
  if(event.button!==0) return;
  active=true; event.currentTarget.setPointerCapture(event.pointerId); api.begin('pan',null,event.screenX,event.screenY);
};
document.addEventListener('pointermove',event=>{if(active)api.move(event.screenX,event.screenY,event.buttons===0);});
document.addEventListener('pointerup',event=>{if(active){active=false;api.move(event.screenX,event.screenY,true);}});
api.onState(render); api.state().then(render);
