const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const {bounded}=require('../shared/async-task');
function validateAnswers(values, count) {
  if (!Array.isArray(values) || values.length !== count || values.some(v=>!v || ['sameProbability','scopeConflictProbability'].some(k=>!Number.isFinite(v[k]) || v[k]<0 || v[k]>1) || !['current','previous','mixed','unknown'].includes(v.period) || typeof v.truncated !== 'boolean')) throw new Error('Laya 응답 형식이 올바르지 않습니다.');
  return values;
}
class LayaBridge {
  constructor(directory, status = ()=>{}) { this.directory=directory; this.status=status; this.child=null; this.pending=new Map(); this.sequence=0; this.queue=Promise.resolve(); this.ready=false; }
  async candidates(config) {
    if (config.pythonPath) return [[config.pythonPath,[]]];
    const candidates = [['py',['-3.11']],['python',[]],['python3',[]]];
    const base=path.join(process.env.LOCALAPPDATA || '', 'Packages','PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0','LocalCache','local-packages','Python311','Scripts','laya.exe');
    try {
      const match=(await fs.readFile(base)).toString('utf8').match(/#!(C:[^\r\n\0]+\.exe)\r?\n/);
      if (match) candidates.unshift([match[1],[]]);
    } catch {}
    return candidates;
  }
  async start(signal) {
    if (this.ready) return;
    this.config=JSON.parse(await fs.readFile(path.join(this.directory,'data','laya-config.json'),'utf8'));
    for (const key of ['startupTimeoutMs','requestTimeoutMs']) if (!Number.isFinite(this.config[key]) || this.config[key]<1000) throw new Error('Laya 시간 제한 설정을 확인하세요.');
    this.status('Laya Python 실행 환경 확인 중');
    let lastError;
    for (const [executable,args] of await this.candidates(this.config)) {
      if (signal?.aborted) throw new Error('검색 취소됨');
      try {
        this.child = await new Promise((resolve,reject)=> {
          const child=spawn(executable,[...args,'-u',path.join(__dirname,'laya-worker.py')],{windowsHide:true,shell:false,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
          child.once('error',reject); child.once('spawn',()=>resolve(child));
        });
        break;
      } catch(e) { lastError=e; this.child=null; }
    }
    if (!this.child) throw new Error(`Python을 실행하지 못했습니다. data/laya-config.json의 pythonPath를 지정하세요. ${lastError?.code || ''}`);
    const child=this.child;
    readline.createInterface({input:child.stdout}).on('line',line=> {
      let result; try {result=JSON.parse(line);} catch {return;}
      const pending=this.pending.get(result.id); if (!pending) return;
      result.ok ? pending.resolve(result.result) : pending.reject(new Error(result.error));
    });
    child.stderr.on('data',chunk=>this.status(`Laya 준비/판정: ${chunk.toString('utf8').replace(/\x1b\[[0-9;]*m/g,'').trim().slice(-220)}`));
    child.on('error',error=>{if(this.child===child)this.fail(error);});
    child.stdin.on('error',error=>{if(this.child===child)this.fail(error);});
    child.on('exit',()=>{ if(this.child===child) this.fail(new Error('Laya Python 프로세스가 종료되었습니다.')); });
    this.status('Laya multilingual 가중치 준비 중 · 최초 실행은 다운로드가 필요할 수 있습니다');
    try { await this.request('init',{config:this.config},this.config.startupTimeoutMs,signal); this.ready=true; this.status('Laya multilingual 준비 완료'); }
    catch(error) {this.stop(); throw error;}
  }
  request(type,payload,timeout,signal) {
    if (signal?.aborted) return Promise.reject(new Error('검색 취소됨'));
    return new Promise((resolve,reject)=> {
      const id=++this.sequence;
      const finish=(callback,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending.delete(id);callback(value);};
      const abort=()=>{finish(reject,new Error('검색 취소됨'));this.stop();};
      const timer=setTimeout(()=>{finish(reject,new Error('Laya 응답 시간 초과'));this.stop();},timeout);
      this.pending.set(id,{resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)});
      signal?.addEventListener('abort',abort,{once:true});
      this.child.stdin.write(JSON.stringify({id,type,...payload})+'\n',error=>{if(error)this.pending.get(id)?.reject(error);});
    });
  }
  prepare(signal) {
    if(this.failure && Date.now()<this.failure.until)return Promise.reject(new Error(this.failure.message));
    if(!this.preparing){
      const work=this.queue.catch(()=>{}).then(()=>this.start(signal)).catch(error=>{if(!signal?.aborted)this.failure={message:error.message,until:Date.now()+60000};throw error;});
      this.queue=work;this.preparing=work;
      work.finally(()=>{if(this.preparing===work)this.preparing=null;}).catch(()=>{});
    }
    return bounded(()=>this.preparing,this.config?.startupTimeoutMs || 300000,signal,'Laya 준비 대기 시간 초과');
  }
  judge(pairs,signal) {
    const waiting=new AbortController();
    const taskSignal=AbortSignal.any([waiting.signal,...(signal?[signal]:[])]);
    const work=this.queue.catch(()=>{}).then(async()=> {
      if(taskSignal.aborted)throw new Error('Laya 대기 취소됨');
      if(this.failure && Date.now()<this.failure.until)throw new Error(this.failure.message);
      try {
        await this.start(taskSignal);
        return validateAnswers(await this.request('judge',{pairs},this.config.requestTimeoutMs,taskSignal),pairs.length);
      } catch(error){if(!signal?.aborted)this.failure={message:error.message,until:Date.now()+60000};throw error;}
    });
    this.queue=work;
    return bounded(()=>work,this.config?.requestTimeoutMs || 120000,signal,'Laya 대기·판정 시간 초과').finally(()=>waiting.abort());
  }
  fail(error) {this.ready=false;this.child=null; for(const request of [...this.pending.values()])request.reject(error);}
  stop() { const child=this.child; this.fail(new Error('Laya 작업 종료됨')); child?.kill(); }
}
module.exports={LayaBridge,validateAnswers};
