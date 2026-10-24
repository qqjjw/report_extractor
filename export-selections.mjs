// Optional AI-side exporter; Electron itself needs no spreadsheet package.
// Pass selected cells in memory to the bundled Python writer. No inspection sidecars.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const projectRequire=createRequire(import.meta.url);
const {tableGrid}=projectRequire('./table-grid.cjs'),{sourceFormat}=projectRequire('./excel-source-format.cjs');
const {port,token}=JSON.parse(await fs.readFile('.local/bridge.json','utf8'));
async function api(action,args={}){
  const response=await fetch(`http://127.0.0.1:${port}/command`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action,args}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw Error(data.error);return data;
}
const argv=process.argv.slice(2),groupAt=argv.indexOf('--group'),filter=groupAt<0?null:argv[groupAt+1];
const items=[];
for(const item of await api('selection-list'))if(!filter||filter.split(',').includes(item.group))items.push(await api('selection-read',{key:item.key}));
if(!items.length)throw Error('선택 목록이 비어 있습니다.');
if(items.some(i=>!i.evidence.original))throw Error('원문 서식이 없는 기존 선택 항목은 selection-refresh로 갱신하세요.');
const output=path.resolve(argv[0]||'outputs/선택한_표.xlsx');
try{await fs.access(output);throw Error('기존 파일은 덮어쓰지 않습니다. 새 Excel 파일명을 지정하세요.');}catch(error){if(error.code!=='ENOENT')throw error;}
await fs.mkdir(path.dirname(output),{recursive:true});
const cells=[];
const rowHeights=new Map(),columnWidths=new Map();
const reserveHeight=(row,points)=>rowHeights.set(row,Math.max(rowHeights.get(row)||0,points));
function writeText(row,col,text,width,style,height){
  reserveHeight(row,Math.max(15,(height||24)*0.75));
  cells.push({row,col,text,rs:1,cs:width,format:style?sourceFormat(style):{}});
}
function writeTable(source,row,col,key,role){
  const grid=tableGrid(source.rows);
  source.rowHeights.forEach((h,r)=>reserveHeight(row+r,Math.max(12,h*0.75)));
  const widths=Array(grid.width).fill(null);
  for(const c of grid.cells)if(c.cs===1&&c.width>0)widths[c.c]=Math.max(widths[c.c]||0,c.width);
  if(role==='selected')for(let c=0;c<grid.width;c++)columnWidths.set(col+c,Math.max(columnWidths.get(col+c)||0,widths[c]||source.width/grid.width));
  for(const c of grid.cells){
    cells.push({row:row+c.r,col:col+c.c,text:c.text,rs:c.rs,cs:c.cs,format:sourceFormat(c.style)});
  }
  return grid;
}
const groups=[...new Set(items.map(i=>i.group))];let band=0;
for(const group of groups){
  const sorted=items.filter(i=>i.group===group).sort((a,b)=>a.reportName.localeCompare(b.reportName));
  const preHeight=i=>i.evidence.original.before.reduce((n,b)=>n+(b.kind==='table'?tableGrid(b.rows).height:1),0);
  const maxBefore=Math.max(...sorted.map(preHeight));let col=0,maxHeight=0;
  for(const item of sorted){
    const original=item.evidence.original,grid=tableGrid(original.rows);
    const width=Math.max(grid.width,...original.before.filter(b=>b.kind==='table').map(b=>tableGrid(b.rows).width));
    // Only report identity and source URL are metadata; subsequent content comes from the DOM.
    writeText(band,col,item.companyName+' · '+item.reportName,width,null,24);
    writeText(band+1,col,item.evidence.url,width,null,48);
    let row=band+3;
    for(const block of original.before){
      if(block.kind==='table'){const shape=writeTable(block,row,col,item.key,'before');row+=shape.height;}
      else {writeText(row,col,block.text,width,block.style,block.height);row++;}
    }
    const start=band+3+maxBefore;
    writeTable(original,start,col,item.key,'selected');
    maxHeight=Math.max(maxHeight,grid.height);col+=width+2;
  }
  band+=3+maxBefore+maxHeight+3;
}
const python=process.env.DART_PYTHON||path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python',process.platform==='win32'?'python.exe':'bin/python3');
const result=spawnSync(python,[fileURLToPath(new URL('./write_excel.py',import.meta.url)),output],{
  input:JSON.stringify({cells,rowHeights:[...rowHeights],columnWidths:[...columnWidths]}),encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024
});
if(result.error)throw Error('Excel 저장용 Python을 실행할 수 없습니다. 제공된 런타임 또는 DART_PYTHON을 확인하세요.');
if(result.status!==0)throw Error('Excel 저장 실패: '+result.stdout.trim());
console.log(JSON.stringify({output,sheets:1,tables:items.length,sourceCells:cells.length,groups}));
