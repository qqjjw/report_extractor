(function(root){
  const Rules=typeof module!=='undefined'?require('./table-rules'):root.TableRules;
  const DOM=typeof module!=='undefined'?require('./table-dom'):root.TableDOM;
  const prefix=/^\s*(?:(?:\d+(?:\.\d+)*|[IVXⅠ-Ⅹ]+|[가-힣])[.)．]\s*|[（(]\d+[)）]\s*)/i;
  function titleParts(value){
    // Strip annotations only. Numbers within the actual title (e.g. IFRS 16) remain.
    const text=String(value||'').normalize('NFKC')
      .replace(/\[[^\]]*(?:\d{4}\s*년|\d{4}[./-]\d{1,2}[./-]\d{1,2}|현재|기준일|단위)[^\]]*\]/g,' ')
      .replace(/\(\s*단위\s*[:：]?[^)]*\)/g,' ')
      .replace(/\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일\s*(?:현재|기준)?/g,' ');
    return text.split(/(?=\(\d+\)\s*[^\s])/).map(part=>DOM.text(part.replace(prefix,''))).filter(Boolean);
  }
  const key=value=>Rules.normalize(value).replace(/[,，]/g,'');
  const clean=value=>key(titleParts(value).at(-1)||'');
  function isCorrectionTitle(value){
    return /^(?:\[?(?:기재)?정정\]?(?:사항|내용|내역|전|후|전후|대비표|신고|신고서|사유|항목)|정정)$/.test(clean(value).replace(/[\s:：()[\]<>·ㆍ-]/g,''));
  }
  function headingRecords(doc,targets=[]){
    const records=[],stack=[];
    for(const el of doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,td,div,span')){
      if(el.closest('[hidden],[aria-hidden="true"]')||el.style.display==='none')continue;
      let hidden=false;for(let parent=el;parent;parent=parent.parentElement){if(parent.style.display==='none'||parent.style.visibility==='hidden'){hidden=true;break;}}if(hidden)continue;
      const raw=DOM.text(el.textContent);
      if(!raw||raw.length>300||el.querySelector('table,h1,h2,h3,h4,h5,h6,p,div'))continue;
      if(el.tagName==='SPAN'&&el.closest('p,h1,h2,h3,h4,h5,h6,td'))continue;
      if(el.tagName==='TD'&&el.parentElement.cells.length>1)continue;
      const parts=titleParts(raw);if(!parts.length)continue;
      const numbered=prefix.test(raw),isTag=/^h[1-6]$/i.test(el.tagName);
      if(!isTag&&!numbered&&!isCorrectionTitle(raw)&&!el.querySelector('b,strong')&&!/bold|[6-9]00/.test(el.style.fontWeight)&&!parts.some(part=>targets.includes(key(part))))continue;
      for(let i=0;i<parts.length;i++){
        const level=i>0||/^\s*\(\d+\)/.test(raw)?8:isTag?Number(el.tagName[1]):7;
        while(stack.length&&stack.at(-1).level>=level)stack.pop();
        const record={el,raw,title:parts[i],level,path:[...stack.map(parent=>parent.title),parts[i]]};
        records.push(record);stack.push(record);
      }
    }
    return records;
  }
  const before=(a,b)=>Boolean(a.compareDocumentPosition(b)&4);
  function correctionAreas(doc){
    const list=headingRecords(doc);
    const areas=list.flatMap((start,i)=>{
      if(!isCorrectionTitle(start.title)||start.el.closest('table'))return [];
      // A correction block ends only at a structural peer/ancestor, not a
      // repeated subheading inside its before/after comparison.
      const end=list.slice(i+1).find(next=>next.level<=start.level&&!isCorrectionTitle(next.title)&&
        (/^H[1-6]$/.test(next.el.tagName)||/^\s*[IVXⅠ-Ⅹ]+[.)．]/.test(next.raw)));
      return [{start:start.el,end:end?.el||null}];
    });
    const labels=new Map();
    for(const cell of doc.querySelectorAll('th,td')){
      if(cell.textContent.length>30)continue;
      const label=clean(cell.textContent);
      if(label!=='정정전'&&label!=='정정후')continue;
      const table=cell.closest('table');if(!table)continue;
      if(!labels.has(table))labels.set(table,new Set());labels.get(table).add(label);
    }
    areas.tables=new Set([...labels].filter(([,values])=>values.size===2).map(([table])=>table));
    return areas;
  }
  function inCorrection(el,areas){
    if(areas.some(area=>(area.start===el||before(area.start,el))&&(!area.end||before(el,area.end))))return true;
    for(let table=el.closest('table');table;table=table.parentElement?.closest('table')){
      if(areas.tables.has(table))return true;
    }
    return false;
  }
  function ranges(doc,title,rules={}){
    const wantedTitles=(Array.isArray(title)?title:[title]).flatMap(titleParts);
    const wanted=wantedTitles.map(key);
    const target=wanted.at(-1),list=headingRecords(doc,wanted),corrections=correctionAreas(doc);
    const eligible=list.map((start,i)=>({start,i})).filter(({start})=>!inCorrection(start.el,corrections));
    const makeRange=({start,i},matchType,similarity)=>{
      const end=list.slice(i+1).find(next=>next.level<=start.level)||null;
      return {start:start.el,end:end?.el||null,path:start.path,matchType,similarity};
    };
    const exact=eligible.filter(({start})=>{
      if(key(start.title)!==target)return false;
      const path=start.path.map(key);
      return wanted.length<=path.length&&wanted.every((part,j)=>part===path[path.length-wanted.length+j]);
    });
    if(exact.length)return exact.map(item=>makeRange(item,'exact',1));
    // Compare heading text only. Every requested ancestor must also match;
    // sharing a single word must not open an unrelated chapter.
    const fuzzy=eligible.flatMap(item=>{
      const path=item.start.path;if(wanted.length>path.length)return [];
      const suffix=path.slice(-wanted.length);
      const sourceScope=Rules.scope({context:wantedTitles.join(' '),title:''});
      const targetScope=Rules.scope({context:suffix.join(' '),title:''});
      if(sourceScope!=='미상'&&targetScope!=='미상'&&sourceScope!==targetScope)return [];
      const scores=wantedTitles.map((part,j)=>key(part)===key(suffix[j])?1:Rules.similarity(part,suffix[j],rules).score);
      if(!scores.length||scores.some(score=>score<.5))return [];
      return [{...item,similarity:scores.reduce((a,b)=>a+b,0)/scores.length}];
    }).sort((a,b)=>b.similarity-a.similarity||a.i-b.i);
    return fuzzy.length?[makeRange(fuzzy[0],'similarity',fuzzy[0].similarity)]:[];
  }
  function sectionInfo(doc,table){
    const preceding=headingRecords(doc).filter(heading=>before(heading.el,table)&&!table.contains(heading.el));
    const last=preceding.at(-1),primary=preceding.filter(heading=>heading.level!==8).at(-1);
    return {raw:last?.raw||null,path:last?.path||[],heading:primary?.title||last?.title||null};
  }
  function sectionFor(doc,table){
    return sectionInfo(doc,table).heading;
  }
  async function search(doc,payload,signal){
    const all=[...doc.querySelectorAll('table')],wanted=payload.bodySection;
    const wantedPath=payload.bodySectionPath?.length?payload.bodySectionPath:wanted;
    const areas=payload.choiceArea?[payload.choiceArea]:wanted?ranges(doc,wantedPath,payload.rules):[],corrections=correctionAreas(doc);
    if(wanted&&!areas.length)throw new Error(`본문에서 '${wanted}' 구간 제목을 찾지 못했습니다.`);
    const include=[...(payload.rules.include||[]),...(payload.input.include||[])].map(Rules.normalize);
    const exclude=[...(payload.rules.exclude||[]),...(payload.input.exclude||[])].map(Rules.normalize);
    const tables=[],diagnostics={missingKeywords:0,excludedKeywords:0,scopeConflict:0,lowSimilarity:0,correctionTables:0,invalidTables:0};let inSection=0;
    for(let i=0;i<all.length;i++){
      if(signal?.aborted)throw new Error('검색 취소됨');
      const table=all[i];
      if(inCorrection(table,corrections)){diagnostics.correctionTables++;continue;}
      if((wanted||payload.choiceArea)&&!areas.some(area=>before(area.start,table)&&(!area.end||before(table,area.end))))continue;
      inSection++;
      const value=Rules.normalize(table.textContent);
      if(!include.every(k=>value.includes(k)))diagnostics.missingKeywords++;
      if(exclude.some(k=>value.includes(k)))diagnostics.excludedKeywords++;
      if(include.every(k=>value.includes(k))&&!exclude.some(k=>value.includes(k))){
        const dto=DOM.summarize(table,doc.URL,i);
        if(dto){dto.ruleResult=Rules.evaluate(payload.source,dto,payload.input,payload.rules);if(dto.ruleResult.passed)tables.push(dto);else{if(dto.ruleResult.scopeConflict)diagnostics.scopeConflict++;if(!include.length&&dto.ruleResult.score<payload.rules.minimumRuleScore)diagnostics.lowSimilarity++;}}
        else diagnostics.invalidTables++;
      }
      if(i%40===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(!inSection&&diagnostics.correctionTables&&!wanted)throw new Error('정정 내역만 확인되어 실제 본문 검색 구간을 구분하지 못했습니다.');
    return {tables,extracted:inSection,scope:wanted||null,scopePath:areas[0]?.path||[],scopeMatch:areas[0]?{type:areas[0].matchType,similarity:areas[0].similarity}:null,diagnostics};
  }
  async function choiceInspect(doc,payload,signal){
    if(signal?.aborted)throw new Error('검색 취소됨');
    const corrections=correctionAreas(doc),records=headingRecords(doc),roots=[],stack=[],areas=new Map();
    for(let i=0;i<records.length;i++){
      const record=records[i];
      if(inCorrection(record.el,corrections)||isCorrectionTitle(record.title))continue;
      while(stack.length&&stack.at(-1).level>=record.level)stack.pop();
      const id=`heading:${i}:${DOM.fingerprint(record.raw)}`;
      const node={id,title:record.title,path:[...stack.map(item=>item.title),record.title],children:[]};
      (stack.at(-1)?.node.children||roots).push(node);
      const end=records.slice(i+1).find(next=>next.level<=record.level&&next.el!==record.el);
      areas.set(id,{start:record.el,end:end?.el||null,path:node.path});
      stack.push({...record,node});
    }
    if(payload.choiceRequest.action==='headings')return {headings:roots,tables:[]};
    if(payload.choiceRequest.action!=='tables')throw new Error('지원하지 않는 본문 탐색입니다.');
    const id=payload.choiceRequest.parentId,area=id?areas.get(id):null;
    if(id&&!area)throw new Error('선택한 본문 제목이 변경되었습니다. 새 검색을 시작하세요.');
    return search(doc,{...payload,bodySection:null,bodySectionPath:[],choiceArea:area},signal);
  }
  const api={search,choiceInspect,ranges,sectionFor,sectionInfo,titleParts,clean,isCorrectionTitle};if(typeof module!=='undefined')module.exports=api;else root.TableLive=api;
})(globalThis);
