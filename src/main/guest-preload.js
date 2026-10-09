// Bundled with table-dom.js by main.js into a fixed, trusted sandbox preload.
const { ipcRenderer } = require('electron');
let selecting = false;
const documents = new WeakSet();
const showTimers = new Map();
function dart(doc) { try { return new URL(doc.URL).hostname === 'dart.fss.or.kr'; } catch { return false; } }
function install(doc) {
  if (!doc || documents.has(doc) || !dart(doc)) return;
  documents.add(doc);
  doc.addEventListener('click', event => {
    if (!selecting) return;
    const table = event.target.closest?.('table');
    if (!table) return;
    const dto = globalThis.TableDOM.summarize(table, doc.URL, [...doc.querySelectorAll('table')].indexOf(table));
    if (!dto) return;
    const section=globalThis.TableLive?.sectionInfo(doc,table);
    dto.sectionHeading=section?.heading||null;
    dto.sectionPath=section?.path||[];
    dto.sectionHeadingRaw=section?.raw||null;
    event.preventDefault(); event.stopImmediatePropagation(); selecting = false;
    globalThis.TableDOM.highlight(table);
    ipcRenderer.send('table:selected', dto);
  }, true);
  function frames() {
    for (const frame of doc.querySelectorAll('iframe, frame')) {
      if (!frame.dataset.reportFrameListener) {
        frame.dataset.reportFrameListener = 'true';
        frame.addEventListener('load', () => { try { install(frame.contentDocument); } catch {} });
      }
      try { install(frame.contentDocument); } catch {}
    }
  }
  frames(); new MutationObserver(frames).observe(doc.documentElement, { childList: true, subtree: true });
}
ipcRenderer.on('table:mode', (_event, enabled) => { selecting = Boolean(enabled); install(document); });
function walkDocuments(doc,callback) {
  if(!doc || !dart(doc))return;
  callback(doc);
  for(const frame of doc.querySelectorAll('iframe, frame')){try{walkDocuments(frame.contentDocument,callback);}catch{}}
}
ipcRenderer.on('table:clear',()=>walkDocuments(document,doc=>globalThis.TableDOM.clear(doc)));
ipcRenderer.on('table:restore-selection',(_event,dto)=>walkDocuments(document,doc=>{
  if(globalThis.TableRules.sameDocument(doc.URL,dto.documentUrl)){const table=globalThis.TableDOM.find(doc,dto);if(table)globalThis.TableDOM.highlight(table);}
}));
ipcRenderer.on('table:cancel-show',(_event,id)=>{clearInterval(showTimers.get(id));showTimers.delete(id);});
ipcRenderer.on('table:show', (_event, payload) => {
  const walk = doc => {
    if (!doc || !dart(doc)) return false;
    const same=(a,b)=>{const x=new URL(a),y=new URL(b);return x.origin===y.origin && x.pathname===y.pathname && ['rcpNo','dcmNo','eleId','offset','length','dtd'].every(k=>x.searchParams.get(k)===y.searchParams.get(k));};
    if (same(doc.URL,payload.table.documentUrl)) {
      const table = globalThis.TableDOM.find(doc, payload.table);
      if (table) { globalThis.TableDOM.highlight(table); table.scrollIntoView({block:'center',inline:'nearest'}); return true; }
    }
    for (const frame of doc.querySelectorAll('iframe, frame')) { try { if (walk(frame.contentDocument)) return true; } catch {} }
    return false;
  };
  const show = () => {
    if (!walk(document)) return false;
    ipcRenderer.send('table:shown', { requestId: payload.requestId, ok: true }); return true;
  };
  if (show()) return;
  let attempts = 0;
  const timer = setInterval(() => {
    if (show()) {clearInterval(timer);showTimers.delete(payload.requestId);}
    else if (++attempts >= 40) { clearInterval(timer);showTimers.delete(payload.requestId); ipcRenderer.send('table:shown', { requestId: payload.requestId, ok:false, error:'표 위치를 확인하지 못했습니다. 본문이 변경되었거나 HTML 표가 아닙니다.' }); }
  }, 250);
  showTimers.set(payload.requestId,timer);
  window.addEventListener('beforeunload', () => clearInterval(timer), { once:true });
});
window.addEventListener('DOMContentLoaded', () => install(document));
const liveJobs=new Map();
ipcRenderer.on('table:cancel-live',(_event,id)=>{liveJobs.get(id)?.abort();liveJobs.delete(id);});
ipcRenderer.on('table:search-live',async(_event,payload)=>{
  const controller=new AbortController();liveJobs.set(payload.requestId,controller);
  try{
    const deadline=Date.now()+35000;let target;
    while(!target && Date.now()<deadline && !controller.signal.aborted){
      walkDocuments(document,doc=>{if(globalThis.TableRules.sameDocument(doc.URL,payload.documentUrl)&&doc.readyState==='complete')target=doc;});
      if(!target)await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(controller.signal.aborted)return;
    if(!target)throw new Error('보고서 본문이 열리지 않았습니다. 해당 목차의 로딩 상태를 확인하세요.');
    const result=await (payload.choiceRequest?globalThis.TableLive.choiceInspect:globalThis.TableLive.search)(target,payload,controller.signal);
    if(!controller.signal.aborted)ipcRenderer.send('table:live-result',{requestId:payload.requestId,ok:true,result});
  }catch(error){if(!controller.signal.aborted)ipcRenderer.send('table:live-result',{requestId:payload.requestId,ok:false,error:error.message});}
  finally{liveJobs.delete(payload.requestId);}
});
