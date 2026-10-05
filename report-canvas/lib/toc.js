// ===== 입력값: DART 목차·본문 선택자와 로딩 대기 =====
const TREE_SELECTOR='#listTree', FRAME_SELECTOR='#ifrm';
const BODY_HOST='dart.fss.or.kr', BODY_PATH='/report/viewer.do';
const WAIT_MS=10000, POLL_MS=150, EXECUTE_TIMEOUT_MS=5000;
const DOC_KEYS=['rcpNo','dcmNo','eleId','offset','length','dtd'];
function normalize(title){return title.replace(/^\s*(?:[IVXLCDM]+|\d+(?:-\d+)*|[가-힣])\s*[.．、)\]]\s*/i,'').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim().toLowerCase();}
// 목차 데이터만 읽습니다. 전체 본문을 분석하지 않습니다.
function inspectPage(selector,iframeSelector,keys){
 const tree=window.$j?.(selector).jstree(true),iframe=document.querySelector(iframeSelector);
 if(!tree||!iframe)throw new Error('DART 목차 또는 본문 구조를 식별하지 못했습니다.');
 const nodes=tree.get_json('#',{flat:true}).map(item=>{const n=tree.get_node(item.id),o=n.original;if(!o?.rcpNo||!o.eleId)return null;return {id:String(n.id),title:n.text,path:[...n.parents].reverse().filter(id=>id!=='#').map(id=>tree.get_node(id).text).concat(n.text),doc:Object.fromEntries(keys.map(k=>[k,String(o[k]??'')]))};}).filter(Boolean);
 const url=new URL(iframe.src,location.href),doc=Object.fromEntries(keys.map(k=>[k,url.searchParams.get(k)||''])),found=nodes.filter(n=>keys.every(k=>n.doc[k]===doc[k]));
 return {nodes,current:found.length===1?found[0]:null};
}
function sameDoc(a,b){return DOC_KEYS.every(k=>String(a[k]??'')===String(b[k]??''));}
async function execute(frame,code){let timer;try{return await Promise.race([frame.executeJavaScript(code),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('사이트 응답 시간이 초과되었습니다.')),EXECUTE_TIMEOUT_MS);})]);}finally{clearTimeout(timer);}}
async function inspect(contents){return execute(contents.mainFrame,'('+inspectPage.toString()+')('+JSON.stringify(TREE_SELECTOR)+','+JSON.stringify(FRAME_SELECTOR)+','+JSON.stringify(DOC_KEYS)+')');}
async function matches(contents,node){
 const src=await execute(contents.mainFrame,'document.querySelector('+JSON.stringify(FRAME_SELECTOR)+')?.src');
 let currentDoc;try{currentDoc=Object.fromEntries(new URL(src).searchParams);}catch{return false;}
 const frames=contents.mainFrame.framesInSubtree.filter(f=>{try{const u=new URL(f.url);return u.hostname===BODY_HOST&&u.pathname===BODY_PATH&&sameDoc(Object.fromEntries(u.searchParams),node.doc);}catch{return false;}});
 return !!(sameDoc(currentDoc,node.doc)&&frames.length===1&&await execute(frames[0],"document.readyState==='complete'"));
}
function clickPage(selector,node,keys){const tree=window.$j?.(selector).jstree(true),target=tree?.get_node(node.id);if(!target||!keys.every(k=>String(target.original?.[k]??'')===node.doc[k]))throw new Error('목차가 변경되었습니다. 새 탐색을 시작하세요.');
 // 대상 자신의 항목을 선택해 DART의 기존 이벤트로 본문을 엽니다.
 tree.deselect_all(true);tree.select_node(target.id);
}
async function open(contents,node,isCurrent=()=>true){
 if(!isCurrent())throw new Error('탐색이 변경되어 취소했습니다.');
 await execute(contents.mainFrame,'('+clickPage.toString()+')('+JSON.stringify(TREE_SELECTOR)+','+JSON.stringify(node)+','+JSON.stringify(DOC_KEYS)+')');
 const until=Date.now()+WAIT_MS;while(Date.now()<until){if(!isCurrent())throw new Error('탐색이 변경되어 취소했습니다.');if(await matches(contents,node))return;await new Promise(r=>setTimeout(r,POLL_MS));}throw new Error('후보 본문이 열리지 않았습니다. 같은 후보를 다시 열 수 있습니다.');
}
module.exports={normalize,inspect,matches,open,execute};
