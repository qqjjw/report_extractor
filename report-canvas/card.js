const api = window.canvasApp;
let card, active=false;
function render(value) {
  card=value;
  document.getElementById('company').textContent=card.companyName;
  document.getElementById('date').textContent=card.receivedDate;
  document.getElementById('title').textContent=card.reportName;
  document.getElementById('title').title=card.url;
  document.getElementById('status').textContent=card.status;
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
api.onCard(render);
