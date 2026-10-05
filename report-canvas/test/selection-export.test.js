const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const ExcelJS=require('exceljs');
const {SelectionList,reportYear,run}=require('../lib/selection');
const {layout,cellValue,writeSelections,META_ROWS}=require('../lib/excel');
const card=(id,year)=>({rcpNo:id,companyName:'삼성전자',reportName:`사업보고서 (${year}.12)`,url:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+id});
const node={id:'x',path:['연결 주석','유형자산'],doc:{rcpNo:'1'}};
const desc=(index,rows=2,cols=2)=>({index,fingerprint:'test'+index,rowCount:rows,columnCount:cols,preview:[['감가상각비','(1,200)']]});
test('연도별 선택 순번·중복 토글·삭제·수동 그룹은 다른 항목을 재번호화하지 않는다',()=>{
 const list=new SelectionList(),a=card('a',2023),b=card('b',2022);
 const one=list.toggle(a,node,'body',desc(0),2023),two=list.toggle(a,node,'body',desc(1),2023),other=list.toggle(b,node,'body',desc(0),2022);
 assert.equal(one.group,1);assert.equal(two.group,2);assert.equal(other.group,1);
 list.group(two.id,1);assert.equal(two.group,1);assert.throws(()=>list.group(two.id,0),/정수/);
 list.toggle(a,node,'body',desc(0),2023);assert.equal(list.items.length,2);
 const next=list.toggle(a,node,'body',desc(2),2023);assert.equal(next.group,3);
 assert.equal(reportYear(a),2023);assert.equal(reportYear({...a,reportName:'기간 없음'}),null);
 assert.ok(!Object.hasOwn(one,'cells'));assert.ok(!Object.hasOwn(one,'html'));assert.equal(list.publicItems()[0].path,'연결 주석 → 유형자산');
 list.clear();assert.equal(list.items.length,0);assert.equal(list.counters.size,0);
});
test('연도 열 블록·같은 그룹 시작 행·중복 연도 세로 쌓기·누락 연도 공간',()=>{
 const items=[{id:'1',order:1,year:2023,group:1,rowCount:2,columnCount:3},{id:'2',order:2,year:2022,group:1,rowCount:8,columnCount:2},{id:'3',order:3,year:2023,group:1,rowCount:4,columnCount:2},{id:'4',order:4,year:2022,group:2,rowCount:1,columnCount:4}];
 const p=layout(items);assert.deepEqual(p.years,[2022,2023]);assert.equal(p.blocks[0].row,p.blocks[1].row);assert.ok(p.blocks[2].row>p.blocks[0].row+2);assert.ok(p.blocks[3].row>p.blocks[2].row+4);assert.ok(p.columns.get(2023).start>p.columns.get(2022).start+3);
 assert.throws(()=>layout([{...items[0],columnCount:16384}]),/한도/);
});
test('숫자 표시 형식·식별번호·대시·수식 모양 원문을 안전하게 보존한다',()=>{
 assert.equal(cellValue('(1,200)').value,-1200);assert.equal(cellValue('1,200.00').numFmt,'#,##0.00;-#,##0.00;#,##0.00');
 for(const s of ['00123','-','1234567890123456','=1+2','10%','감가상각비',''])assert.equal(cellValue(s).value,s);
 assert.equal(cellValue('(0)').numFmt,'0;(0);(0)');
});
test('Electron 문자열 오류도 원문 확인 실패 이유로 표시한다',async()=>{
 await assert.rejects(run({executeJavaScript:async()=>{throw 'Error: 원문 연결 실패\n at page';}},'read'),/원문 연결 실패/);
});
test('생성 중 디스크 쓰기 실패도 중단하고 기존 파일·임시 파일을 보호한다',async()=>{
 const nativeFs=require('node:fs'),{Writable}=require('node:stream'),originalStream=nativeFs.createWriteStream;
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'dart-write-failure-')),file=path.join(folder,'result.xlsx');
 const item={id:'1',order:1,year:2023,group:1,rowCount:1,columnCount:1,companyName:'회사',reportName:'보고서',node,bodyUrl:'https://dart.fss.or.kr/report/viewer.do'};
 await fs.writeFile(file,'기존 파일');
 try{
  nativeFs.createWriteStream=()=>new Writable({write(chunk,encoding,done){done(new Error('디스크 쓰기 실패'));}});
  await assert.rejects(writeSelections([item],file,async()=>{await new Promise(r=>setTimeout(r,40));return {rowCount:1,columnCount:1,cells:[]};}),/디스크 쓰기 실패/);
  assert.equal(await fs.readFile(file,'utf8'),'기존 파일');assert.deepEqual(await fs.readdir(folder),['result.xlsx']);
 }finally{nativeFs.createWriteStream=originalStream;await fs.rm(folder,{recursive:true,force:true});}
});
test('단일 시트에 병합·그룹 배치·원문 링크를 저장하고 실패 시 기존 파일을 보호한다',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'dart-export-')),file=path.join(folder,'result.xlsx');
 const base={companyName:'삼성전자',reportName:'사업보고서',node,bodyUrl:'https://dart.fss.or.kr/report/viewer.do?rcpNo=1',rowCount:2,columnCount:3};
 const items=[{...base,id:'a',year:2023,group:1,order:1},{...base,id:'b',year:2022,group:1,order:2}];
 const data={rowCount:2,columnCount:3,cells:[{r:0,c:0,rs:1,cs:2,text:'감가상각비',header:true},{r:0,c:2,rs:1,cs:1,text:'-',header:false},{r:1,c:0,rs:1,cs:1,text:'(1,200)',header:false},{r:1,c:1,rs:1,cs:1,text:'001',header:false},{r:1,c:2,rs:1,cs:1,text:'=1+2',header:false}]};
 try{
  await writeSelections(items,file,async()=>data);const book=new ExcelJS.Workbook();await book.xlsx.readFile(file);assert.equal(book.worksheets.length,1);const sheet=book.worksheets[0],p=layout(items);
  for(const block of p.blocks){const r=block.row+META_ROWS,c=block.col;assert.equal(sheet.getCell(r,c).value,'감가상각비');assert.equal(sheet.getCell(r,c+1).master.address,sheet.getCell(r,c).address);assert.equal(sheet.getCell(r+1,c).value,-1200);assert.equal(sheet.getCell(r+1,c+1).value,'001');assert.equal(sheet.getCell(r+1,c+2).value,'=1+2');assert.equal(sheet.getCell(block.row+2,c).value.hyperlink,base.bodyUrl);}
  const original=await fs.readFile(file);await assert.rejects(writeSelections(items,file,async()=>{throw new Error('원문 변경');}),/원문 변경/);assert.deepEqual(await fs.readFile(file),original);
  await assert.rejects(writeSelections(items,path.join(folder,'missing','fail.xlsx'),async()=>data));
  await assert.rejects(writeSelections(items,folder,async()=>data));
  await assert.rejects(writeSelections(items,file,async()=>data,()=>{},()=>false),/취소/);
  assert.deepEqual(await fs.readFile(file),original);
  assert.deepEqual(await fs.readdir(folder),['result.xlsx']);
 }finally{await fs.rm(folder,{recursive:true,force:true});}
});
