const cheerio = require('cheerio');
// 입력값: 이 실험은 유형자산 주석에 한정합니다. 번호·금액·파일 연도는 매칭 근거가 아닙니다.
const TOPIC = '유형자산';
const DEPRECIATION = /^감가상각(?:비)?(?:[,，].*)?$/;
const text = s => String(s || '').replace(/\s+/g, ' ').trim();
const norm = s => text(s).replace(/[\s,，:：()（）]/g, '');
function heading(value) {
  const m = text(value).match(/^(\d+(?:\.\d+)*)(?:\.\s*|\s+)(.+)$/);
  return m ? { number: m[1], depth: m[1].split('.').length, title: m[2].replace(/\s*\(연결\)\s*$/, '').replace(/[:：]\s*$/, '').trim() } : null;
}
function signature(value) {
  const s = norm(value).replace(/^[-–]/, '');
  if (/감가상각(?:비)?$/.test(s) || s.startsWith('감가상각비유형자산')) return '감가상각';
  if (/^기초/.test(s)) return '기초';
  if (/^기말/.test(s)) return '기말';
  if (/취득|자본적지출/.test(s)) return '취득';
  if (/처분|폐기/.test(s)) return '처분';
  if (/손상/.test(s)) return '손상';
  return s;
}
function analyze(html, label) {
  const $ = cheerio.load(html), elements = $('body *').toArray(), order = new Map(elements.map((e,i)=>[e,i]));
  const headings = $('p,h1,h2,h3,h4,h5,h6').toArray().filter(e=>!$(e).closest('table').length).map(e=>({element:e,position:order.get(e),...heading($(e).text())})).filter(h=>h.title);
  const ranges = headings.filter(h=>norm(h.title)===TOPIC).map(h=>({start:h.position,end:headings.find(n=>n.position>h.position&&n.depth<=h.depth)?.position??elements.length,title:$(h.element).text(),boundary:headings.find(n=>n.position>h.position&&n.depth<=h.depth)?.title||'제공된 본문 끝'}));
  const contextNodes=elements.filter(e=>(e.name==='p'&&!$(e).closest('table').length)||(e.name==='table'&&$(e).hasClass('nb'))).map(e=>({position:order.get(e),text:text($(e).text())})).filter(e=>e.text);
  const candidates = [], rejected = [];
  $('table').each((index,element)=>{
    $(element).attr('id','lab-table-'+index);
    if ($(element).find('table').length || !text($(element).text())) return;
    const range=ranges.find(r=>order.get(element)>r.start&&order.get(element)<r.end);
    const cells=$(element).find('th,td').toArray(), hits=cells.filter(c=>DEPRECIATION.test(text($(c).text()).replace(/^[-–]\s*/,'')));
    const tableText=text($(element).text()), expenses=/매출원가/.test(tableText)&&/판매비/.test(tableText);
    if (!range) {if(hits.length)rejected.push({id:index,reason:'유형자산 주석 밖',preview:tableText.slice(0,100)});return;}
    // 안내용 nb 표와 표 밖 문단만 문맥에 포함합니다. 앞 데이터 표의 숫자는 복사하지 않습니다.
    const context=contextNodes.filter(e=>e.position>range.start&&e.position<order.get(element)).slice(-5).map(e=>e.text).join(' ').slice(-1500);
    const captionMatch=expenses&&/계정과목별.*상각/.test(context);
    if(!hits.length&&!captionMatch)return;
    const header=text($(element).find('thead').text()), periods=[...context.matchAll(/당기|전기/g)].map(m=>m[0]);
    const period=/당기/.test(header)&&/전기/.test(header)?'당기·전기':periods.at(-1)||'미확인';
    const rows=$(element).find('tr').toArray().map(tr=>$(tr).children('td,th').toArray().map(c=>text($(c).text())));
    const labels=rows.map(r=>r[0]).filter(Boolean), rowKeys=[...new Set(labels.map(signature))];
    const rights=!expenses&&(/계약의\s*해지/.test(tableText)||/사용권/.test(header)), role=expenses?'계정과목별 비용표':rowKeys.includes('기초')&&rowKeys.includes('기말')?'변동표':'기타 감가상각 표';
    if(expenses)rowKeys.push('매출원가','판매비와관리비');
    const matchingRows=hits.length?hits.map(c=>{const tr=$(c).closest('tr');tr.addClass('lab-hit-row');return tr.children('td,th').toArray().map(cell=>text($(cell).text()));}):rows.filter(r=>/매출원가|판매비|^계$/.test(r[0]));
    if(captionMatch)$(element).find('tbody tr').addClass('lab-hit-row');
    $(element).addClass('lab-candidate');
    candidates.push({id:index,label,section:text(range.title),boundary:range.boundary,period,unit:context.match(/단위\s*[:：]\s*([^)]*)/)?.[1]?.trim()||'미확인',scope:rights?'사용권자산（구조 단서）':'유형자산',role,context,rows:matchingRows,rowKeys,columns:[...new Set($(element).find('th').toArray().map(c=>norm($(c).text())).filter(Boolean))],preview:tableText.slice(0,150),evidence:hits.length?'감가상각 행·셀 직접 발견':'표 앞의 계정과목별 상각 설명 + 비용 항목'});
  });
  // 로컬 원문 표는 유지하고 외부 리소스·스크립트는 사용하지 않습니다.
  $('script,link,iframe,object,embed,base').remove();
  $('*').each((_,e)=>{for(const key of Object.keys(e.attribs||{}))if(/^on/i.test(key))$(e).removeAttr(key);});
  $('head').append('<meta charset="utf-8"><style>body{font:14px Arial,"Malgun Gothic",sans-serif;padding:16px}table{border-collapse:collapse;margin:12px 0;max-width:none}td,th{border:1px solid #bbb;padding:5px}table.nb td{border:0}.lab-candidate{outline:3px solid #16a34a;outline-offset:2px}.lab-hit-row td,.lab-hit-row th{background:#dcfce7!important}.lab-selected{outline:5px solid #d97706!important}p{line-height:1.5}</style>');
  return {label,ranges:ranges.map(({start,end,title,boundary})=>({start,end,title:text(title),boundary})),tableCount:$('table').length,candidates,rejected,html:$.html()};
}
function compare(a,b) {
  const shared=a.rowKeys.filter(k=>b.rowKeys.includes(k)), columns=a.columns.filter(k=>b.columns.includes(k));
  if (a.period!==b.period && a.period!=='미확인' && b.period!=='미확인' && b.period!=='당기·전기') return null;
  if(a.scope!==b.scope||a.role!==b.role)return null;
  const score=shared.length*4+columns.length*2+(a.role===b.role?8:0)+(a.period===b.period&&a.period!=='미확인'?12:0);
  return {score,reasons:[`공통 행 항목 ${shared.length}개`,...shared,a.role,b.period==='당기·전기'?'두 기간이 한 표에 병합됨':a.period],shared,columns};
}
function match(left,right) {
  const possibilities=left.candidates.flatMap(a=>right.candidates.map(b=>({left:a.id,right:b.id,evidence:compare(a,b)})).filter(p=>p.evidence));
  possibilities.sort((a,b)=>b.evidence.score-a.evidence.score||a.left-b.left||a.right-b.right);
  const usedLeft=new Set(),usedRight=new Set(),pairs=[];
  const matchedRight=new Set();
  for(const p of possibilities){const a=left.candidates.find(c=>c.id===p.left),b=right.candidates.find(c=>c.id===p.right),rightKey=b.period==='당기·전기'?p.right+':'+a.period:String(p.right);if(!usedLeft.has(p.left)&&!usedRight.has(rightKey)){pairs.push(p);usedLeft.add(p.left);usedRight.add(rightKey);matchedRight.add(p.right);}}
  return {pairs,unmatchedLeft:left.candidates.filter(c=>!usedLeft.has(c.id)).map(c=>c.id),unmatchedRight:right.candidates.filter(c=>!matchedRight.has(c.id)).map(c=>c.id)};
}
module.exports={analyze,match,compare,heading,signature};
