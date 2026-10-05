const {app,WebContentsView}=require('electron'),fsp=require('node:fs/promises'),path=require('node:path'),readline=require('node:readline');
const toc=require('./lib/toc'),tables=require('./lib/tables'),selection=require('./lib/selection'),browser=require('./lib/browser'),{readReports}=require('./lib/scene'),{writeSelections}=require('./lib/excel');
// ===== 입력값: 원본 목록 위치·후보 페이지 크기 =====
const REPORTS_FILE=path.resolve(__dirname,'../data/reports.json'),DEFAULT_LIMIT=20,MAX_LIMIT=100;
const output=require('node:net').connect({path:process.argv[2],allowHalfOpen:true});let view,reports=[],closing=false;
output.on('error',e=>{process.stderr.write(e.message+'\n');app.exit(1);});
const send=value=>new Promise((resolve,reject)=>output.write(JSON.stringify(value)+'\n',e=>e?reject(e):resolve()));
const fail=(message,code='INVALID_INPUT')=>Object.assign(new Error(message),{code});
function report(id){const r=reports.find(r=>r.rcpNo===id);if(!r)throw fail('reports.json에 없는 접수번호입니다.','UNKNOWN_REPORT');return r;}
function body(node,id){if(!node||!Array.isArray(node.path)||!node.path.every(s=>typeof s==='string')||!node.doc||node.doc.rcpNo!==id)throw fail('목차 정보가 유효하지 않습니다.');const url=new URL('https://dart.fss.or.kr/report/viewer.do');for(const key of ['rcpNo','dcmNo','eleId','offset','length','dtd']){if(typeof node.doc[key]!=='string')throw fail('목차 식별값이 없습니다.');url.searchParams.set(key,node.doc[key]);}return url.href;}
function locator(l){report(l?.rcpNo);if(body(l.node,l.rcpNo)!==l.bodyUrl||!Number.isInteger(l.index)||l.index<0||typeof l.fingerprint!=='string'||!Number.isInteger(l.rowCount)||l.rowCount<1||!Number.isInteger(l.columnCount)||l.columnCount<1)throw fail('locator가 유효하지 않습니다.');return l;}
async function open(url){if(view.webContents.getURL()!==url)await browser.load(view.webContents,url);return view.webContents.mainFrame;}
async function read(l){locator(l);return selection.run(await open(l.bodyUrl),'read',l);}
async function command(name,p){
 if(name==='reports'){reports=await readReports(REPORTS_FILE);return reports.map(r=>({...r,year:selection.reportYear(r)}));}
 if(name==='toc'){const r=report(p.rcpNo);await open(r.url);let data;const until=Date.now()+10000;while(Date.now()<until){try{const value=await toc.inspect(view.webContents);if(value.nodes.length&&value.nodes.every(n=>n.doc.rcpNo===r.rcpNo)){data=value;break;}}catch{}await new Promise(r=>setTimeout(r,150));}if(!data)throw fail('목차를 읽지 못했습니다.','DART_ERROR');return data.nodes.map(node=>({...node,bodyUrl:body(node,r.rcpNo)}));}
 if(name==='find'){
  report(p.rcpNo);const url=body(p.node,p.rcpNo),keywords=Array.isArray(p.keywords)?p.keywords:tables.terms(p.keywords);
  if(!keywords.length||keywords.length>20||keywords.some(s=>typeof s!=='string'||!s.trim()||s.length>200))throw fail('검색 문구는 1~20개, 각 200자 이하입니다.');
  if(p.broad!==true&&!(typeof p.section==='string'&&p.section.trim()))throw fail('구간명을 지정하거나 broad: true를 명시하세요.');
  const offset=p.offset??0,limit=p.limit??DEFAULT_LIMIT;if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>MAX_LIMIT)throw fail('페이지 offset·limit이 유효하지 않습니다.');
  const frame=await open(url),found=await tables.run(frame,'find',{section:p.section||'',keywords,broad:p.broad===true,quiet:true,sectionIsDocument:tables.compact(p.node.title)===tables.compact(p.section||'')});
  const candidates=[];for(const c of found.slice(offset,offset+limit)){const d=await selection.run(frame,'describe',{index:c.index});candidates.push({...d,rcpNo:p.rcpNo,node:p.node,bodyUrl:url});}
  return {total:found.length,offset,limit,nextOffset:offset+limit<found.length?offset+limit:null,candidates};
 }
 if(name==='read')return read(p.locator);
 if(name==='export'){
  if(typeof p.manifestPath!=='string'||typeof p.outputPath!=='string'||!p.outputPath.toLowerCase().endsWith('.xlsx'))throw fail('manifestPath와 .xlsx outputPath가 필요합니다.');
  const manifest=JSON.parse(await fsp.readFile(path.resolve(p.manifestPath),'utf8'));if(manifest.version!==1||!Array.isArray(manifest.tables)||!manifest.tables.length)throw fail('version: 1과 비어 있지 않은 tables 배열이 필요합니다.');
  const destination=path.resolve(p.outputPath);if(p.overwrite!==true){try{await fsp.access(destination);throw fail('출력 파일이 이미 있습니다.','OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
  const items=manifest.tables.map((t,i)=>{const l=locator(t.locator),r=report(l.rcpNo),year=t.year??selection.reportYear(r);if(!Number.isInteger(year)||year<1900||year>9999||!Number.isSafeInteger(t.group)||t.group<1)throw fail('대상 연도와 양의 정수 그룹을 지정하세요.');return {...l,...r,id:String(i),order:i,year,group:t.group};});
  try{await writeSelections(items,destination,read,()=>{},()=>!closing,{overwrite:p.overwrite===true});}catch(e){if(e.selectionId!==undefined)e.locator=manifest.tables[Number(e.selectionId)].locator;throw e;}
  return {outputPath:destination,count:items.length};
 }
 if(name==='close'){closing=true;return {closed:true};}throw fail('알 수 없는 command입니다.');
}
app.whenReady().then(async()=>{
 app.userAgentFallback=app.userAgentFallback.replace(browser.REMOVED_PRODUCTS,'');
 view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});view.webContents.setUserAgent(app.userAgentFallback);view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 try{reports=await readReports(REPORTS_FILE);}catch(e){process.stderr.write(e.message+'\n');}
 const lines=readline.createInterface({input:output,crlfDelay:Infinity});
 try{for await(const line of lines){let request;try{request=JSON.parse(line);if(!request||typeof request.id!=='string'||!request.id||typeof request.command!=='string'||(request.params!==undefined&&(!request.params||typeof request.params!=='object'||Array.isArray(request.params))))throw fail('id 문자열·command·params 객체가 필요합니다.');const result=await command(request.command,request.params||{});await send({id:request.id,ok:true,result});}catch(failure){const e=failure instanceof Error?failure:new Error(String(failure));await send({id:typeof request?.id==='string'?request.id:null,ok:false,error:{code:e.code||'COMMAND_FAILED',message:e.message,locator:e.locator}});}if(closing)break;}}
 finally{lines.close();closing=true;view.webContents.close();output.end(()=>app.quit());}
}).catch(e=>{process.stderr.write(e.message+'\n');app.exit(1);});
