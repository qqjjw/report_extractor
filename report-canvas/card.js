const api = window.canvasApp;
let card, active=false;
function render(value) {
  card=value;
  document.getElementById('company').textContent=card.companyName;
  document.getElementById('date').textContent=card.receivedDate;
  document.getElementById('title').textContent=card.reportName;
  document.getElementById('title').title=card.url;
  document.getElementById('status').textContent=card.status;
  document.getElementById('pick-table').disabled=card.searchBusy||card.status!=='열림';
  document.getElementById('pick-table').textContent=card.picking?'기준 선택 취소':'검색 기준 선택';
  document.getElementById('manual-select').textContent=card.manual?'표 선택 ON':'표 선택 OFF';
  document.getElementById('manual-select').disabled=card.searchBusy||card.status!=='열림';
  document.getElementById('manual-select').classList.toggle('active',!!card.manual);
  document.getElementById('selected-count').textContent=`선택 ${card.selectedCount||0}개`;
  document.getElementById('search-table').hidden=!card.isReference;
  document.getElementById('search-table').disabled=card.searchBusy;
  const review=card.review;
  document.getElementById('review-result').textContent=card.manual?'표를 클릭해 선택/취소 · 초록색은 엑셀 저장 대상':card.picking?'검색 기준으로 쓸 표를 클릭하세요.':review?[review.state,'구간: '+review.candidatePath,review.total?'후보 '+review.position+'/'+review.total:'',review.reason||'',review.preview||''].filter(Boolean).join(' · '):card.isReference?'검색 기준: 보라 테두리 · 좌측에서 구간과 필수 문구를 지정하세요.':'';
  for(const action of ['table-accept','table-reject','table-retry','table-rescan','table-broad']){
    const button=document.getElementById(action);
    button.hidden=action==='table-accept'||action==='table-reject'?review?.state!=='판정 대기':!review;
    button.disabled=card.searchBusy;
  }

  document.getElementById('dimensions').textContent=`${card.width} × ${card.height}`;
  document.getElementById('card-error').hidden=!card.error;
  document.getElementById('card-error').textContent=card.error;
  document.getElementById('retry').disabled=card.status==='불러오는 중';
}
function begin(event,kind) {
  if(!card || event.button!==0 || event.target.closest('button')) return;
  active=true;event.currentTarget.setPointerCapture(event.pointerId);api.begin(kind,card.rcpNo,event.screenX,event.screenY);event.preventDefault();
}
document.getElementById('card-header').onpointerdown=event=>begin(event,'move');
document.getElementById('handle').onpointerdown=event=>begin(event,'resize');
document.getElementById('retry').onclick=()=>api.command('retry',card.rcpNo);
document.getElementById('apply-size').onclick=()=>api.command('apply-size',card.rcpNo);
document.addEventListener('pointermove',event=>{if(active)api.move(event.screenX,event.screenY,event.buttons===0);});
document.addEventListener('pointerup',event=>{if(active){active=false;api.move(event.screenX,event.screenY,true);}});
for(const action of ['manual-select','pick-table','search-table','table-accept','table-reject','table-retry','table-rescan','table-broad'])document.getElementById(action).onclick=()=>api.command(action,card.rcpNo);
api.onCard(render);
