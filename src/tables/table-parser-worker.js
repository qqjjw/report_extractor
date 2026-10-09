const {parentPort}=require('node:worker_threads');
const {JSDOM}=require('jsdom');
const DOM=require('./table-dom');
parentPort.on('message',({id,html,url})=>{
  let dom;
  try {
    if(!html.trim())throw new Error('DART가 빈 본문을 반환했습니다.');
    dom=new JSDOM(html,{url});
    const tables=DOM.extract(dom.window.document,url);
    if(!tables.length && /비정상|접근.*제한|조회.*실패|시스템.*오류|요청.*너무.*많/.test(dom.window.document.body?.textContent || html))throw new Error('DART가 본문 대신 오류 페이지를 반환했습니다.');
    parentPort.postMessage({id,ok:true,tables});
  }catch(error){parentPort.postMessage({id,ok:false,error:error.message});}
  finally{dom?.window.close();}
});
