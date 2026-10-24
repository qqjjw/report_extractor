const { ipcRenderer } = require('electron');
const attached = new WeakSet();
const documents=new Set();
let sourceMode=false;
ipcRenderer.on('source-mode',(_,enabled)=>{sourceMode=!!enabled;for(const doc of documents){try{doc.documentElement.style.cursor=sourceMode?'crosshair':'';}catch{}}});
function attach(doc) {
  if (!doc || attached.has(doc)) return;
  attached.add(doc);
  documents.add(doc);
  doc.defaultView.addEventListener('unload',()=>documents.delete(doc),{once:true});
  doc.documentElement.style.cursor=sourceMode?'crosshair':'';
  doc.addEventListener('click',event=>{
    if(!sourceMode)return;
    let table=event.target.closest?.('table');if(!table)return;
    while(table.parentElement?.closest('table'))table=table.parentElement.closest('table');
    if(!doc.defaultView.location.href.includes('/report/viewer.do'))return;
    event.preventDefault();event.stopImmediatePropagation();
    const tables=[...doc.querySelectorAll('table')].filter(t=>!t.parentElement.closest('table'));
    ipcRenderer.send('site-input',{type:'source',tableIndex:tables.indexOf(table),url:doc.defaultView.location.href});
  },true);
  doc.addEventListener('pointerdown', () => ipcRenderer.send('site-input', { type: 'focus' }), true);
  doc.addEventListener('wheel', event => {
    if (!event.ctrlKey) return;
    event.preventDefault(); event.stopPropagation();
    ipcRenderer.send('site-input', { type: 'zoom', delta: event.deltaY });
  }, { passive: false, capture: true });
  const frames = () => doc.querySelectorAll('iframe').forEach(frame => { try { attach(frame.contentDocument); } catch {} });
  doc.addEventListener('load', event => { if (event.target.tagName === 'IFRAME') frames(); }, true);
  frames();
}
window.addEventListener('DOMContentLoaded', () => attach(document));
