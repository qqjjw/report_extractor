const fs=require('node:fs/promises');
const path=require('node:path');
const {TableParser}=require('./table-parser');
const {bounded,delay}=require('../shared/async-task');
const {TableSearch}=require('./table-search');
const {LayaBridge}=require('../laya/laya-bridge');
function dartUrl(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='dart.fss.or.kr'||!['/report/viewer.do','/dsaf001/main.do'].includes(url.pathname))throw new Error('허용되지 않은 DART 본문 주소입니다.');
  return url;
}
class TableBackend {
  constructor(directory,fetch,status,options={}) {
    this.directory=directory;this.fetch=fetch;this.status=status;this.cache=new Map();this.jobs=new Map();this.active=0;this.waiting=[];
    this.bridge=new LayaBridge(directory,message=>this.status({type:'laya',message}));
    this.parser=options.parser || new TableParser();
    this.options={fetchTimeoutMs:12000,parseTimeoutMs:30000,reportTimeoutMs:180000,retries:2,spacingMs:250,...options};
    this.nextFetch=0;
  }
  async slot(signal) {
    if(signal.aborted)throw new Error('검색 취소됨');
    if(this.active<3){this.active++;return;}
    await new Promise((resolve,reject)=>{
      const task={resolve:()=>{signal.removeEventListener('abort',abort);resolve();},reject};
      const abort=()=>{this.waiting=this.waiting.filter(x=>x!==task);reject(new Error('검색 취소됨'));};
      this.waiting.push(task);signal.addEventListener('abort',abort,{once:true});
    });
  }
  release() {const next=this.waiting.shift();if(next)next.resolve();else this.active--;}
  async load(url,signal) {
    dartUrl(url);if(this.cache.has(url))return this.cache.get(url);
    await this.slot(signal);
    try {
      let html,lastError;
      for(let attempt=0;attempt<=this.options.retries;attempt++){
        const wait=Math.max(0,this.nextFetch-Date.now());this.nextFetch=Date.now()+wait+this.options.spacingMs;
        if(wait)await delay(wait,signal);
        const controller=new AbortController();const requestSignal=AbortSignal.any([signal,controller.signal]);
        try{
          html=await bounded(async()=>{
            const response=await this.fetch(url,{signal:requestSignal,headers:{Referer:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+dartUrl(url).searchParams.get('rcpNo')}});
            if(!response.ok)throw new Error(`DART 본문 HTTP ${response.status}`);
            dartUrl(response.url || url);
            const buffer=await response.arrayBuffer();if(buffer.byteLength>15000000)throw new Error('본문 크기가 너무 큽니다.');
            if(!buffer.byteLength)throw new Error('DART가 빈 본문을 반환했습니다.');
            const prefix=new TextDecoder('ascii').decode(buffer.slice(0,4096));
            const charset=/charset\s*=\s*["']?([\w-]+)/i.exec(`${response.headers.get('content-type') || ''} ${prefix}`)?.[1] || 'utf-8';
            const body=new TextDecoder(charset.toLowerCase()==='ks_c_5601-1987'?'euc-kr':charset).decode(buffer);
            if(!body.trim())throw new Error('DART가 빈 본문을 반환했습니다.');return body;
          },this.options.fetchTimeoutMs,signal,'DART 본문 수신 시간 초과');break;
        }catch(error){
          lastError=error;
          if(signal.aborted || attempt===this.options.retries || /HTTP (400|401|403|404)|허용되지|크기가 너무/.test(error.message))throw error;
          this.status({type:'network',url,message:`DART 본문 재시도 ${attempt+1}/${this.options.retries}: ${error.message}`});
          await delay(this.options.spacingMs*(attempt+1)*2,signal);
        }finally{controller.abort();}
      }
      if(html==null)throw lastError;
      const tables=await this.parser.parse(html,url,signal,this.options.parseTimeoutMs);
      if(this.cache.size>=200)this.cache.delete(this.cache.keys().next().value);
      this.cache.set(url,tables);return tables;
    } finally {this.release();}
  }
  async search(payload) {
    const key=payload.requestId; if(typeof key!=='string')throw new Error('검색 ID가 필요합니다.');
    this.jobs.get(key)?.abort();const controller=new AbortController();this.jobs.set(key,controller);
    try {
      const rules=JSON.parse(await fs.readFile(path.join(this.directory,'data','table-rules.json'),'utf8'));
      if(rules.version!==1 || !Number.isFinite(rules.minimumRuleScore) || rules.minimumRuleScore<0 || rules.minimumRuleScore>1 || !Number.isFinite(rules.aiThreshold) || rules.aiThreshold<.5 || rules.aiThreshold>1 || !Array.isArray(rules.include) || !Array.isArray(rules.exclude))throw new Error('table-rules.json 설정을 확인하세요.');
      const deadline=new AbortController();
      const timer=setTimeout(()=>{const error=new Error('보고서 검색 시간 제한에 도달했습니다. 수집한 후보만 표시합니다. 다시 검색할 수 있습니다.');error.name='TimeoutError';deadline.abort(error);},this.options.reportTimeoutMs);
      const searchSignal=AbortSignal.any([controller.signal,deadline.signal]);
      const config=JSON.parse(await fs.readFile(path.join(this.directory,'data','laya-config.json'),'utf8'));
      rules.aiEnabled=config.enabled===true;
      const engine=new TableSearch((url,signal,scope,scopePath)=>this.options.liveLoad?this.options.liveLoad(url,payload,rules,scope,signal,scopePath):this.load(url,signal),async(pairs,signal)=>{await this.bridge.prepare(signal);return this.bridge.judge(pairs,signal);},rules);
      try{return await engine.report(payload.source,payload.toc,payload.input,searchSignal,progress=>this.status({type:'progress',requestId:key,...progress}));}
      finally{clearTimeout(timer);}
    } finally {if(this.jobs.get(key)===controller)this.jobs.delete(key);}
  }
  cancel(id) {if(id)this.jobs.get(id)?.abort();else {for(const job of this.jobs.values())job.abort();this.bridge.failure=null;}}
  reset(){this.cancel();this.cache.clear();}
  stop(){this.reset();this.parser.stop();this.bridge.stop();}
}
module.exports={TableBackend,dartUrl};
