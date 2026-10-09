const {Worker}=require('node:worker_threads');
const path=require('node:path');
class TableParser {
  constructor(options={}){this.file=options.file || path.join(__dirname,'table-parser-worker.js');this.worker=null;this.queue=[];this.current=null;this.sequence=0;}
  parse(html,url,signal,timeoutMs=30000){
    if(signal?.aborted)return Promise.reject(new Error('검색 취소됨'));
    return new Promise((resolve,reject)=>{
      const job={id:++this.sequence,html,url};
      const finish=(callback,value)=>{if(job.done)return;job.done=true;clearTimeout(job.timer);signal?.removeEventListener('abort',abort);callback(value);};
      job.resolve=value=>finish(resolve,value);job.reject=error=>finish(reject,error);
      const remove=error=>{
        this.queue=this.queue.filter(x=>x!==job);job.reject(error);
        if(this.current===job){this.current=null;this.destroyWorker();}
        this.pump();
      };
      const abort=()=>remove(new Error('검색 취소됨'));
      job.timer=setTimeout(()=>remove(new Error('HTML 표 파싱 시간 초과')),timeoutMs);
      signal?.addEventListener('abort',abort,{once:true});this.queue.push(job);this.pump();
    });
  }
  destroyWorker(){const worker=this.worker;this.worker=null;worker?.terminate().catch(()=>{});}
  pump(){
    if(this.current || !this.queue.length)return;
    if(!this.worker){
      const worker=new Worker(this.file);this.worker=worker;
      worker.on('message',result=>{
        if(this.worker!==worker || this.current?.id!==result.id)return;
        const job=this.current;this.current=null;
        result.ok?job.resolve(result.tables):job.reject(new Error(result.error));this.pump();
      });
      const fail=error=>{if(this.worker!==worker)return;this.current?.reject(error);this.current=null;this.destroyWorker();this.pump();};
      worker.on('error',fail);worker.on('exit',code=>{if(this.worker===worker)fail(new Error(`표 파싱 작업 종료 (${code})`));});
    }
    this.current=this.queue.shift();
    try{this.worker.postMessage({id:this.current.id,html:this.current.html,url:this.current.url});}
    catch(error){this.current.reject(error);this.current=null;this.destroyWorker();this.pump();}
  }
  stop(){for(const job of this.queue)job.reject(new Error('파싱 작업 취소됨'));this.queue=[];this.current?.reject(new Error('파싱 작업 취소됨'));this.current=null;this.destroyWorker();}
}
module.exports={TableParser};
