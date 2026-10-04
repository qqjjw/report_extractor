const api = window.canvasApp;
let card, active=false;
function render(value) {
  card=value;
  document.getElementById('company').textContent=card.companyName;
  document.getElementById('date').textContent=card.receivedDate;
  document.getElementById('title').textContent=card.reportName;
  document.getElementById('title').title=card.url;
  document.getElementById('status').textContent=card.status;
  document.getElementById('search-toc').disabled=card.searchBusy||card.status!=='열림';
  document.getElementById('search-toc').textContent=card.hasSearch?'새 탐색 시작':'이 목차를 기준으로 찾기';
  const review=card.review;
  document.getElementById('review-result').textContent=review?[review.state,'기준: '+review.sourcePath,review.candidatePath?'후보: '+review.candidatePath:'',review.reason||'','시도 '+review.attempts+'회'].filter(Boolean).join(' · '):'';
  for(const action of ['candidate-accept','candidate-reject','candidate-retry']){const button=document.getElementById(action);button.hidden=action==='candidate-retry'?!review||!['판정 대기','이동 실패'].includes(review.state):review?.state!=='판정 대기';button.disabled=card.searchBusy;}

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
for(const action of ['search-toc','candidate-accept','candidate-reject','candidate-retry'])document.getElementById(action).onclick=()=>api.command(action,card.rcpNo);
api.onCard(render);
