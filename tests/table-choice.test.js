const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {TableChoice,summary}=require('../src/tables/table-choice');
const {TableBackend}=require('../src/tables/table-backend');
const {LayaBridge,validateChoice}=require('../src/laya/laya-bridge');
const Live=require('../src/tables/table-live');
const rules={...require('../data/table-rules.json'),aiEnabled:false};
const ref={dcmNo:'1',eleId:'1',offset:'0',length:'100',dtd:'dart3.xsd'};
const node=(id,title,children=[])=>({id,title,children,sourceRef:ref});
const source={tocPath:['재무','연결 주석','현금흐름표'],sectionPath:['현금흐름표'],title:'퇴직급여',context:'연결',headers:[],rowLabels:[]};
const toc={report:{rcpNo:'20200101000001'},nodes:[node('other','사업'),node('finance','재무',[node('separate','별도 주석'),node('notes','연결 주석')])]};
const html='<h1>연결 주석</h1><h2>현금흐름 정보</h2><table><tr><th>항목</th><th>금액</th></tr><tr><td>퇴직급여</td><td>100</td></tr></table><table><tr><th>항목</th><th>금액</th></tr><tr><td>퇴직급여</td><td>90</td></tr></table><h2>차입금</h2><table><tr><td>퇴직급여</td><td>999</td></tr><tr><td>합계</td><td>999</td></tr></table>';
const input={include:['퇴직급여'],exclude:[]};
test('table text keeps text cells and row boundaries but omits amounts and metadata',()=>{
  const result=summary({title:'긴 제목',context:'연결 당기',cells:[[{text:'구분'},{text:'당기'},{text:'전기'}],[{text:'퇴직급여'},{text:'(1,200)'},{text:'-'}],[{text:'주석 4'},{text:'10%'}]]});
  assert.deepEqual(result,{text:'연결 | 당기\n구분 | 당기 | 전기\n퇴직급여\n주석 4'});
});
async function fixture(answer){
  const dom=new JSDOM(html,{url:'https://dart.fss.or.kr/report/viewer.do?rcpNo=20200101000001'}),calls=[],inspections=[];
  const engine=new TableChoice(async(url,signal,choiceRequest)=>{inspections.push(choiceRequest);return Live.choiceInspect(dom.window.document,{source,input,rules,choiceRequest},signal);},async(request,signal)=>{
    calls.push(request);if(answer)return answer(request,calls.length,signal);
    const selected=request.candidates.find(c=>['finance','notes'].includes(c.id))||request.candidates[0];
    return {selectedId:selected.id,probabilities:Object.fromEntries(request.candidates.map(c=>[c.id,.01])),truncated:false};
  },rules);
  try{return {result:await engine.report(source,toc,input,new AbortController().signal),calls,inspections};}finally{dom.window.close();}
}
test('choice visits direct children, then body section, then all filtered tables exactly once',async()=>{
  const {result,calls,inspections}=await fixture();
  assert.equal(result.status,'choice_matched');assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].table.tableIndex,0);
  assert.deepEqual(calls.map(c=>c.stage),['목차','목차','본문 제목','표']);
  assert.deepEqual(calls[0].source,{target:'재무'});
  assert.deepEqual(calls[1].source,{target:'연결 주석',parentPath:['재무']});
  assert.equal(calls[2].source.target,'현금흐름표');assert(!('tocPath' in calls[2].source));
  assert.deepEqual(calls[0].candidates.map(c=>c.id),['other','finance']);assert.deepEqual(calls[1].candidates.map(c=>c.id),['separate','notes']);
  assert.equal(calls.at(-1).candidates.length,2);assert.equal(result.trace[0].probability,.01);assert.deepEqual(inspections.map(r=>r.action),['headings','tables']);
  assert(calls.at(-1).candidates.every(c=>c.description.text.includes('퇴직급여')&&!('headers' in c.description)&&!('title' in c.description)));
  assert(calls.every(c=>!c.candidates.some(candidate=>/해당 없음|적합한 항목 없음/.test(JSON.stringify(candidate)))));
});
test('invalid selection, SDK truncation and model failure do not retry or inspect another branch',async()=>{
  for(const answer of [()=>({selectedId:'missing'}),r=>({selectedId:r.candidates[0].id,truncated:true}),()=>{throw Error('Laya 응답 시간 초과');}]){
    const {result,calls,inspections}=await fixture(answer);assert.equal(result.status,'error');assert.equal(calls.length,1);assert.equal(inspections.length,0);
  }
});
test('empty TOC and empty filtered table candidates fail without an extra choice',async()=>{
  let choices=0;const engine=new TableChoice(async()=>({tables:[],extracted:0}),async request=>{choices++;return {selectedId:request.candidates[0].id,probabilities:{}};},rules);
  const empty=await engine.report(source,{...toc,nodes:[]},input,new AbortController().signal);assert.equal(empty.status,'error');assert.equal(choices,0);
  const singleSource={...source,tocPath:['재무'],sectionPath:[]};
  const result=await engine.report(singleSource,{...toc,nodes:[node('finance','재무')]},input,new AbortController().signal);
  assert.equal(result.status,'error');assert.equal(choices,1);
});
test('bridge accepts low probabilities but rejects invalid IDs, missing probabilities and truncation',()=>{
  const candidates=[{id:'one'}];assert.equal(validateChoice({selectedId:'one',probabilities:{one:0},truncated:false},candidates).selectedId,'one');
  for(const answer of [{selectedId:'two',probabilities:{one:1}},{selectedId:'one',probabilities:{}},{selectedId:'one',probabilities:{one:1},truncated:true}])assert.throws(()=>validateChoice(answer,candidates));
});
test('rule mode never prepares Laya; explicit choice mode prepares before search deadline',async()=>{
  const backend=new TableBackend(process.cwd(),()=>{throw Error('No download');},()=>{},{liveLoad:async()=>({tables:[],extracted:0})});let preparations=0;
  backend.bridge={prepare:async()=>{preparations++;},choose:async request=>({selectedId:request.candidates[0].id,probabilities:{}}),stop(){}};
  const payload={requestId:'test',source:{...source,tocPath:['재무'],sectionPath:[]},toc:{...toc,nodes:[node('finance','재무')]},input};
  try{assert.equal((await backend.search(payload)).mode,'rule');assert.equal(preparations,0);assert.equal((await backend.search({...payload,mode:'laya_choice'})).mode,'laya_choice');assert.equal(preparations,1);await assert.rejects(backend.search({...payload,mode:'bad'}),/검색 방식/);}finally{backend.stop();}
});
test('body choice hierarchy excludes correction and respects selected parent boundaries',async()=>{
  const dom=new JSDOM('<h1>정정사항</h1><h2>현금흐름표</h2>'+html,{url:'https://dart.fss.or.kr/report/viewer.do?rcpNo=20200101000001'});
  try{const metadata=await Live.choiceInspect(dom.window.document,{choiceRequest:{action:'headings'}},new AbortController().signal);assert.equal(metadata.headings.length,1);assert.equal(metadata.headings[0].children.length,2);await assert.rejects(Live.choiceInspect(dom.window.document,{choiceRequest:{action:'tables',parentId:'stale'}},new AbortController().signal),/변경/);}finally{dom.window.close();}
});
test('serial bridge queue skips canceled waiting request and later requests still run',async()=>{
  const bridge=new LayaBridge(process.cwd());bridge.config={requestTimeoutMs:1000,startupTimeoutMs:1000};bridge.start=async()=>{};
  let release;const firstWait=new Promise(resolve=>{release=resolve;}),requests=[];
  bridge.request=async(type,{selection},timeout,signal)=>{requests.push(selection.stage);if(selection.stage==='first')await firstWait;return {selectedId:'one',probabilities:{one:1},truncated:false};};
  const request=stage=>({stage,candidates:[{id:'one',description:'one'}]});const signal=new AbortController();
  const first=bridge.choose(request('first'));const second=bridge.choose(request('second'),signal.signal);const rejected=assert.rejects(second,{name:'AbortError'});const third=bridge.choose(request('third'));signal.abort();release();await first;await rejected;await third;assert.deepEqual(requests,['first','third']);
});
test('UI mode selection defaults to rules and is captured in search callback',()=>{
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only'});try{
    dom.window.eval(require('node:fs').readFileSync('src/renderer/table-ui.js','utf8'));let received;
    const ui=dom.window.TableUI.attach({companyName:'회사',period:'2020'},{hasSource:()=>true,search:value=>{received=value;}});ui.targets(1,false);
    const mode=ui.el.querySelector('[aria-label="검색 방식"]');assert.equal(mode.value,'rule');mode.value='laya_choice';[...ui.el.querySelectorAll('button')].find(b=>b.textContent==='선택한 보고서에서 검색').click();assert.equal(received.mode,'laya_choice');ui.busy(true);assert(mode.disabled);
  }finally{dom.window.close();}
});
test('choice evidence displays both reference and selected heading',()=>{
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only'});try{
    dom.window.eval(require('node:fs').readFileSync('src/renderer/table-ui.js','utf8'));
    const ui=dom.window.TableUI.attach({companyName:'회사',period:'2020'},{hasSource:()=>true});
    ui.result({mode:'laya_choice',status:'error',candidates:[],errors:[],extracted:4,ruleRejected:4,diagnostics:{lowSimilarity:2,invalidTables:2},trace:[{stage:'목차',target:'III. 재무에 관한 사항',selectedTitle:'I. 회사의 개요',candidateCount:15,probability:.178}]});
    assert(ui.el.textContent.includes('기준 III. 재무에 관한 사항 → 선택 I. 회사의 개요'));
    assert(!ui.el.textContent.includes('undefined'));assert(!ui.el.textContent.includes('Laya에서 제외'));assert(ui.el.textContent.includes('표 구조·숨김 검사 2'));
  }finally{dom.window.close();}
});
test('inspection diagnostics explain structural rejections as well as low similarity',async()=>{
  const valid='<table><tr><td>항목</td><td>금액</td></tr><tr><td>다른 항목</td><td>100</td></tr></table>';
  const dom=new JSDOM(`<table><tr><td>${valid}</td></tr></table>${valid}<table><tr><td>레이아웃</td></tr></table>`,{url:'https://dart.fss.or.kr/report/viewer.do?rcpNo=20200101000001'});
  try{
    const result=await Live.search(dom.window.document,{source:{...source,headers:['매출실적'],rowLabels:['수출실적']},input:{include:[],exclude:[]},rules},new AbortController().signal);
    assert.equal(result.extracted,4);assert.equal(result.tables.length,0);assert.equal(result.diagnostics.lowSimilarity,2);assert.equal(result.diagnostics.invalidTables,2);
  }finally{dom.window.close();}
});
