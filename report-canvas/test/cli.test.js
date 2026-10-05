const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),path=require('node:path');
test('공통 접속 처리의 실패·시간 제한은 종료 후 타이머를 남기지 않는다',async()=>{
 const {load,REMOVED_PRODUCTS}=require('../lib/browser');let stopped=0;
 await assert.rejects(load({loadURL:async()=>{throw new Error('ERR_EMPTY_RESPONSE');},stop:()=>stopped++},'url',10),/ERR_EMPTY_RESPONSE/);
 await new Promise(r=>setTimeout(r,20));assert.equal(stopped,0);
 await assert.rejects(load({loadURL:()=>new Promise(()=>{}),stop:()=>stopped++},'url',5),/초과/);assert.equal(stopped,1);
 assert.equal('Chrome/144 Electron/44 dart-report-canvas/1'.replace(REMOVED_PRODUCTS,''),'Chrome/144');
});
test('CLI JSONL 순서·잘못된 입력 후 계속 처리·close 이후 중단·EOF 종료',{skip:process.platform!=='win32',timeout:20000},async()=>{
 const run=input=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.resolve(__dirname,'../cli.js')],{windowsHide:true}),chunks=[];let error='';child.stdout.on('data',c=>chunks.push(c));child.stderr.on('data',c=>error+=c);child.on('error',reject);child.on('close',code=>{try{assert.equal(code,0,error);resolve(Buffer.concat(chunks).toString().trim().split(/\r?\n/).filter(Boolean).map(JSON.parse));}catch(e){reject(e);}});child.stdin.end(input);});
 let results=await run('broken\n'+[{id:'a',command:'unknown'},{id:'b',command:'reports'},{id:'c',command:'close'},{id:'d',command:'reports'}].map(JSON.stringify).join('\n')+'\n');
 assert.deepEqual(results.map(r=>r.id),[null,'a','b','c']);assert.equal(results[0].ok,false);assert.equal(results[1].ok,false);if(results[2].ok)assert.ok(Array.isArray(results[2].result));else assert.ok(results[2].error.message);assert.equal(results[3].result.closed,true);
 results=await run(JSON.stringify({id:'e',command:'reports'})+'\n');assert.equal(results.length,1);assert.equal(results[0].id,'e');
});
