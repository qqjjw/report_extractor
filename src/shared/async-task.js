function bounded(task, timeoutMs, signal, message) {
  if(signal?.aborted)return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('검색 취소됨'));
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(callback,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);callback(value);};
    const abort=()=>finish(reject,signal.reason instanceof Error ? signal.reason : new Error('검색 취소됨'));
    const timer=setTimeout(()=>finish(reject,new Error(message)),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{if(done)return;return task();}).then(value=>finish(resolve,value),error=>finish(reject,error));
  });
}
const delay=(ms,signal)=>bounded(()=>new Promise(resolve=>setTimeout(resolve,ms)),ms+100,signal,'대기 시간 초과');
module.exports={bounded,delay};
