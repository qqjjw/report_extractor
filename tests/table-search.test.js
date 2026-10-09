const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {TableSearch}=require('../src/tables/table-search');
const Live=require('../src/tables/table-live');
const DOM=require('../src/tables/table-dom');
const rules={...require('../data/table-rules.json'),aiEnabled:false};
const ref={dcmNo:'1',eleId:'1',offset:'0',length:'100',dtd:'dart3.xsd'};
const node=(title,children=[])=>({id:title,title,sourceRef:ref,children});
const toc=nodes=>({report:{rcpNo:'20200101000001'},nodes});
const source={tocPath:['재무에 관한 사항','연결재무제표 주석','현금흐름표'],sectionPath:['현금흐름표'],title:'퇴직급여',context:'연결',headers:[],rowLabels:[]};
async function choose(nodes,selected=source,load=async()=>({tables:[],extracted:0})){
  const calls=[];const engine=new TableSearch(async(...args)=>{calls.push(args);return load(...args);},()=>{throw Error('Laya must stay disabled');},rules);
  const result=await engine.report(selected,toc(nodes),{include:['퇴직급여'],exclude:[]},new AbortController().signal);
  assert(calls.length<=1);return {result,calls};
}
test('stored TOC wins over a different body heading and correction branch',async()=>{
  const nodes=[node('정정사항',[node('현금흐름표')]),node('재무에 관한 사항',[node('별도재무제표 주석',[node('현금흐름표')]),node('연결재무제표 주석',[node('현금흐름표')])]),node('퇴직급여')];
  const {result,calls}=await choose(nodes,{...source,sectionPath:['현금흐름표','퇴직급여']});
  assert.equal(result.selectedSection.matchType,'path');assert.deepEqual(result.selectedSection.path,source.tocPath);assert.equal(result.excludedCorrectionSections,2);assert.deepEqual(calls[0].slice(2),['퇴직급여',['퇴직급여']]);
});
test('numbering and whitespace normalize for full path match',async()=>{
  const {result}=await choose([node('III. 재무에 관한 사항',[node('3. 연결 재무제표 주석',[node('4. 현금 흐름표')])])]);
  assert.equal(result.selectedSection.matchType,'path');
});
test('deepest ancestor supplies missing body path for old reports',async()=>{
  const {result,calls}=await choose([node('재무에 관한 사항',[node('연결재무제표 주석')])],{...source,sectionPath:['현금흐름표','퇴직급여']});
  assert.equal(result.selectedSection.matchType,'ancestor');assert.deepEqual(calls[0].slice(2),['퇴직급여',['현금흐름표','퇴직급여']]);
});
test('same leaf prioritizes matching parent; fuzzy remains last fallback',async()=>{
  const exact=await choose([node('별도재무제표 주석',[node('현금흐름표')]),node('재무에 관한 사항',[node('연결재무제표 주석',[node('현금흐름표')])])],{...source,tocPath:['재무에 관한 사항','연결재무제표 주석','99. 현금흐름표']});
  assert.equal(exact.result.selectedSection.path[1],'연결재무제표 주석');
  const fuzzy=await choose([node('현금흐름 정보')]);assert.equal(fuzzy.result.selectedSection.matchType,'similarity');
});
test('no matching TOC never loads; load failure never expands',async()=>{
  const missing=await choose([node('정정사항'),node('XYZ')]);assert.equal(missing.calls.length,0);assert.equal(missing.result.status,'error');
  const failed=await choose([node('현금흐름표'),node('현금흐름 정보')],source,async()=>{throw Error('보고서 본문 탐색 시간 초과');});
  assert.equal(failed.calls.length,1);assert.match(failed.result.errors[0].error,/시간 초과/);
});
const table=value=>`<table><tr><th>항목</th><th>금액</th></tr><tr><td>퇴직급여</td><td>${value}</td></tr><tr><td>합계</td><td>${value}</td></tr></table>`;
function document(html){return new JSDOM(html,{url:'https://dart.fss.or.kr/report/viewer.do?rcpNo=20200101000001'});}
test('correction headings and before/after comparison tables are excluded',async()=>{
  const dom=document(`<h1>정정사항</h1><h2>현금흐름표</h2>${table(999)}<h1>연결재무제표 주석</h1><h2>현금흐름표</h2>${table(100)}${table(90)}`);
  try{
    const result=await Live.search(dom.window.document,{source,input:{include:['퇴직급여'],exclude:[]},rules,bodySection:'현금흐름표',bodySectionPath:['현금흐름표']},new AbortController().signal);
    assert.equal(result.tables.length,2);assert.equal(result.tables[0].tableIndex,1);assert.equal(result.diagnostics.correctionTables,1);
  }finally{dom.window.close();}
  const comparison=document(`<table><tr><th>정정 전</th><th>정정 후</th></tr><tr><td>${table(999)}</td><td>${table(888)}</td></tr></table>${table(100)}`);
  try{const result=await Live.search(comparison.window.document,{source,input:{include:['퇴직급여'],exclude:[]},rules},new AbortController().signal);assert.equal(result.tables.length,1);}finally{comparison.window.close();}
});
test('single selected TOC uses live rules and picks upper current-period table',async()=>{
  const dom=document(`<h1>현금흐름표</h1>${table(100)}${table(90)}`);
  try{
    const {result,calls}=await choose([node('현금흐름표')],{...source,tocPath:['현금흐름표']},async(url,signal,bodySection,bodySectionPath)=>Live.search(dom.window.document,{source,input:{include:['퇴직급여'],exclude:[]},rules,bodySection,bodySectionPath},signal));
    assert.equal(calls.length,1);assert.equal(result.status,'rule_matched');assert.equal(result.candidates.length,2);assert.equal(result.candidates[0].table.tableIndex,0);
    DOM.highlight(dom.window.document.querySelector('table'));assert.match(dom.window.document.querySelector('table').style.outline,/solid/);
  }finally{dom.window.close();}
});
test('missing body heading and ambiguous correction-only body fail without expansion',async()=>{
  for(const html of [`<h1>다른 제목</h1>${table(100)}`,`<h1>정정사항</h1><h2>현금흐름표</h2>${table(999)}`]){
    const dom=document(html);try{await assert.rejects(Live.search(dom.window.document,{source,input:{include:['퇴직급여'],exclude:[]},rules,bodySection:'현금흐름표'},new AbortController().signal),/구간 제목/);}finally{dom.window.close();}
  }
});
test('pre-aborted search performs no load or AI call',async()=>{
  const controller=new AbortController();controller.abort();const engine=new TableSearch(()=>{throw Error('load called');},()=>{throw Error('AI called');},rules);
  await assert.rejects(engine.report(source,toc([node('현금흐름표')]),{include:[],exclude:[]},controller.signal),{name:'AbortError'});
});
test('older business chapter finds products/services wording variant end to end',async()=>{
  const dom=document(`<h1>II. 사업의 내용</h1><p>2. 주요 제품, 서비스 등</p>${table(100)}<p>3. 원재료 및 생산설비</p>${table(999)}`);
  try{
    const selected={...source,tocPath:['II. 사업의 내용','2. 주요 제품 및 서비스'],sectionPath:['주요 제품 등의 현황']};
    const {result,calls}=await choose([node('II. 사업의 내용')],selected,async(url,signal,bodySection,bodySectionPath)=>Live.search(dom.window.document,{source:selected,input:{include:['퇴직급여'],exclude:[]},rules,bodySection,bodySectionPath},signal));
    assert.equal(calls.length,1);assert.equal(result.status,'rule_matched');assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].table.tableIndex,0);
    assert.equal(result.bodySectionMatch.type,'similarity');assert.equal(result.bodySectionPath.at(-1),'주요 제품, 서비스 등');
  }finally{dom.window.close();}
});
test('exact body heading wins over earlier similar heading',()=>{
  const dom=document('<h2>주요 제품, 서비스 등</h2><h2>주요 제품 및 서비스</h2>');
  try{const areas=Live.ranges(dom.window.document,'주요 제품 및 서비스',rules);assert.equal(areas.length,1);assert.equal(areas[0].matchType,'exact');assert.equal(areas[0].start.textContent,'주요 제품 및 서비스');}finally{dom.window.close();}
});
test('fuzzy headings exclude corrections, enforce ancestors and reject weak matches',()=>{
  const dom=document('<h1>정정사항</h1><h2>주요 제품, 서비스 등</h2><h1>본문</h1><h2>주요 제품, 서비스 등</h2><h2>주요 제품, 서비스 등</h2><h2>주요 원재료</h2>');
  try{const areas=Live.ranges(dom.window.document,'주요 제품 및 서비스',rules);assert.equal(areas.length,1);assert.equal(areas[0].start,dom.window.document.querySelectorAll('h2')[1]);assert.equal(Live.ranges(dom.window.document,['다른 장','주요 제품 및 서비스'],rules).length,0);assert.equal(Live.ranges(dom.window.document,'차입금 상환',rules).length,0);}finally{dom.window.close();}
  const scopes=document('<h1>별도재무제표 주석</h1><h2>현금흐름표</h2>');
  try{assert.equal(Live.ranges(scopes.window.document,['연결재무제표 주석','현금흐름표'],rules).length,0);}finally{scopes.window.close();}
});
