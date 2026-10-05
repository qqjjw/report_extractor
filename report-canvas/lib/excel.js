const ExcelJS = require('exceljs');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
// ===== 입력값: 한 시트의 메타데이터 행·그룹/연도 간격 =====
const META_ROWS = 3, TABLE_GAP = 2, YEAR_GAP = 2;
const MAX_ROWS = 1048576, MAX_COLUMNS = 16384;
function cellValue(text) {
  const s=String(text??'').trim(),negative=/^\([\d,]+(?:\.\d+)?\)$/.test(s),raw=negative?s.slice(1,-1):s;
  // 선행 0·긴 식별번호·퍼센트·대시·수식처럼 보이는 문자열은 원문 그대로 둡니다.
  if(!/^-?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)||raw.replace(/\D/g,'').length>15)return {value:String(text??'')};
  const number=Number(raw.replace(/,/g,''))*(negative?-1:1);if(!Number.isFinite(number))return {value:String(text??'')};
  const decimals=raw.split('.')[1]?.length||0,zeros=decimals?'.'+'0'.repeat(decimals):'',base=(raw.includes(',')?'#,##0':'0')+zeros;
  return {value:number,numFmt:negative?`${base};(${base});(${base})`:`${base};-${base};${base}`};
}
function layout(items) {
  const years=[...new Set(items.map(i=>i.year))].sort((a,b)=>a-b),groups=[...new Set(items.map(i=>i.group))].sort((a,b)=>a-b),columns=new Map();let column=2;
  for(const year of years){const width=Math.max(2,...items.filter(i=>i.year===year).map(i=>i.columnCount));columns.set(year,{start:column,width});column+=width+YEAR_GAP;}
  let row=3;const blocks=[];
  for(const group of groups){const starts=new Map(years.map(y=>[y,row]));for(const item of items.filter(i=>i.group===group).sort((a,b)=>a.order-b.order)){const top=starts.get(item.year);blocks.push({item,row:top,col:columns.get(item.year).start});starts.set(item.year,top+META_ROWS+item.rowCount+TABLE_GAP);}row=Math.max(...starts.values(),row)+1;}
  if(column-YEAR_GAP-1>MAX_COLUMNS||row>MAX_ROWS)throw new Error('선택 목록이 Excel 한 시트의 행·열 한도를 초과합니다.');
  return {years,groups,columns,blocks,lastRow:row};
}
async function writeSelections(items, destination, readTable, onProgress = ()=>{}, isCurrent = ()=>true, options = {}) {
  if(!items.length)throw new Error('선택한 표가 없습니다.');
  const plan=layout(items),temporary=path.join(path.dirname(destination),'.'+path.basename(destination)+'.'+crypto.randomUUID()+'.tmp');
  let workbook,writeFailure,rejectWrite;
  const writeError=new Promise((_,reject)=>{rejectWrite=reject;});writeError.catch(()=>{});
  try{
    // 저장 위치의 쓰기 가능 여부는 스트림 생성 전에 확인합니다.
    const handle=await fs.open(temporary,'wx');await handle.close();
    workbook=new ExcelJS.stream.xlsx.WorkbookWriter({filename:temporary,useStyles:true,useSharedStrings:false});
    // 디스크 부족 등 생성 도중 발생한 스트림 오류도 앱을 종료시키지 않고 저장 실패로 처리합니다.
    const failed=e=>{writeFailure=e;rejectWrite(e);};workbook.stream.on('error',failed);workbook.zip.on('error',failed);
    const sheet=workbook.addWorksheet('선택 표',{views:[{state:'frozen',xSplit:1,ySplit:2}]});
    sheet.getCell('A1').value='선택한 원본 표 · 개별 항목 재배열/단위 환산 없음';
    for(const year of plan.years){const {start,width}=plan.columns.get(year);sheet.mergeCells(2,start,2,start+width-1);sheet.getCell(2,start).value=year+'년 보고서';sheet.getCell(2,start).font={bold:true};for(let c=start;c<start+width;c++)sheet.getColumn(c).width=18;}
    sheet.getColumn(1).width=10;sheet.getRow(1).commit();sheet.getRow(2).commit();
    let done=0;
    // 그룹 하나씩만 셀 데이터를 유지하고 쓴 행은 스트리밍으로 해제합니다.
    for(const group of plan.groups){
      if(writeFailure)throw writeFailure;
      if(!isCurrent())throw new Error('앱 상태가 변경되어 저장을 취소했습니다.');
      const blocks=plan.blocks.filter(b=>b.item.group===group),minRow=Math.min(...blocks.map(b=>b.row));sheet.getCell(minRow,1).value='G'+group;
      let end=minRow;
      for(const block of blocks){const item=block.item;let data;try{data=await readTable(item);}catch(failure){const e=failure instanceof Error?failure:new Error(String(failure));e.selectionId=item.id;throw e;}
        if(writeFailure)throw writeFailure;
        if(!isCurrent())throw new Error('앱 상태가 변경되어 저장을 취소했습니다.');
        if(data.rowCount!==item.rowCount||data.columnCount!==item.columnCount)throw Object.assign(new Error('선택한 표의 크기가 변경되었습니다.'),{selectionId:item.id});
        const {row,col}=block,width=Math.max(2,item.columnCount);
        const metadata=[`G${group} · ${item.companyName} · ${item.reportName}`,item.node.path.join(' → '),'원문 보기'];
        metadata.forEach((value,index)=>{sheet.mergeCells(row+index,col,row+index,col+width-1);const cell=sheet.getCell(row+index,col);cell.value=index===2?{text:value,hyperlink:item.bodyUrl}:value;cell.font={bold:index===0,color:{argb:index===2?'FF2563EB':'FF183149'}};cell.alignment={wrapText:true};sheet.getRow(row+index).height=index===1?30:22;});
        for(const source of data.cells){const r=row+META_ROWS+source.r,c=col+source.c,cell=sheet.getCell(r,c),value=cellValue(source.text);cell.value=value.value;if(value.numFmt)cell.numFmt=value.numFmt;cell.alignment={vertical:'top',wrapText:true};cell.font={bold:source.header};cell.border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}};if(source.rs>1||source.cs>1)sheet.mergeCells(r,c,r+source.rs-1,c+source.cs-1);}
        end=Math.max(end,row+META_ROWS+item.rowCount+TABLE_GAP-1);data=null;onProgress(++done,items.length);
      }
      for(let r=minRow;r<=end;r++)sheet.getRow(r).commit();
    }
    if(writeFailure)throw writeFailure;
    await Promise.race([workbook.commit(),writeError]);if(!isCurrent())throw new Error('앱이 종료되어 저장을 취소했습니다.');
    if(options.overwrite===false){await fs.link(temporary,destination);await fs.rm(temporary);}else await fs.rename(temporary,destination);return destination;
  }catch(e){
    workbook?.zip.abort();
    const stream=workbook?.stream;
    if(stream&&!stream.closed){await new Promise(resolve=>{stream.once('close',resolve);stream.once('error',()=>{});stream.destroy();});}
    await fs.rm(temporary,{force:true}).catch(()=>{});throw e;
  }
}
module.exports={cellValue,layout,writeSelections,META_ROWS};
