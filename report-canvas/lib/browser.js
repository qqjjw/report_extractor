// ===== 입력값: DART 접속 제한 시간·요청에서 제거할 제품명 =====
const LOAD_TIMEOUT_MS=45000;
const REMOVED_PRODUCTS=/\s(?:Electron|dart-report-canvas)\/\S+/gi;
async function load(contents,url,timeout=LOAD_TIMEOUT_MS){let timer;try{await Promise.race([contents.loadURL(url),new Promise((_,reject)=>{timer=setTimeout(()=>{contents.stop();reject(new Error('접속 시간이 초과되었습니다.'));},timeout);})]);}finally{clearTimeout(timer);}}
module.exports={LOAD_TIMEOUT_MS,REMOVED_PRODUCTS,load};
