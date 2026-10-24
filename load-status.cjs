// Track the document inside DART's iframe, not just the outer viewer's load event.
const probeScript = `(() => {
  const f=document.getElementById('ifrm');
  if(!f)return {ready:false};
  try {
    const actual=new URL(f.contentWindow.location.href),expected=new URL(f.src);
    return {ready:f.contentDocument.readyState==='complete' && !!f.contentDocument.body?.textContent.trim() && ['rcpNo','dcmNo','eleId','offset'].every(k=>actual.searchParams.get(k)===expected.searchParams.get(k)),url:actual.href};
  }catch{return {ready:false};}
})()`;
function errorMessage(code, detail) {
  return ({'-21':'네트워크가 변경되어 본문 연결이 끊겼습니다.','-106':'인터넷 연결이 끊겨 본문을 불러오지 못했습니다.','-105':'DART 주소를 찾지 못했습니다. 네트워크 연결을 확인하세요.'})[String(code)] || '페이지를 불러오지 못했습니다. ('+detail+')';
}
function attachLoadTracker(wc, {isCurrent=()=>true,onChange=()=>{}}={}) {
  let generation=0, loaded=false, error=null;
  const publish=()=>{if(isCurrent())onChange({loaded,error});};
  const check=async()=>{
    const current=generation;
    try {
      const probe=await wc.executeJavaScript(probeScript);
      if(!isCurrent()||wc.isDestroyed()||current!==generation)return;
      loaded=!!probe.ready;
      if(loaded)error=null;
      publish();
    }catch{if(isCurrent()&&current===generation){loaded=false;publish();}}
  };
  wc.on('did-start-loading',()=>{generation++;loaded=false;publish();});
  wc.on('did-fail-load',(_,code,detail,url,isMainFrame)=>{
    if(code===-3||!isCurrent())return;
    loaded=false;error={code,message:errorMessage(code,detail),detail,url,isMainFrame:!!isMainFrame};publish();
  });
  wc.on('did-frame-finish-load',check);
  wc.on('did-stop-loading',check);
  if(!wc.isLoading())check();
  return {check};
}
module.exports={attachLoadTracker,errorMessage};
