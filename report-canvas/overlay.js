const api=window.canvasApp;
api.onGesture(kind=>{document.body.style.cursor=kind==='resize'?'nwse-resize':'grabbing';});
let latest, frame;
document.addEventListener('pointermove',event=>{
  latest={x:event.screenX,y:event.screenY,end:event.buttons===0};
  if(!frame)frame=requestAnimationFrame(()=>{frame=null;api.move(latest.x,latest.y,latest.end);});
});
document.addEventListener('pointerup',event=>{if(frame)cancelAnimationFrame(frame);frame=null;api.move(event.screenX,event.screenY,true);});
