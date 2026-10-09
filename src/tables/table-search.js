const Rules=require('./table-rules');
const Titles=require('./table-live');
const {bounded}=require('../shared/async-task');
class SearchCancelled extends Error {constructor(){super('검색 취소됨');this.name='AbortError';}}
class TableSearch {
  constructor(load,_unused,rules){this.load=load;this.rules=rules;}
  async report(source,toc,input,signal,progress=()=>{}){
    const active=()=>{if(signal.aborted)throw new SearchCancelled();};active();
    const sourcePath=(source.tocPath?.length?source.tocPath:[source.context,source.title]).filter(Boolean);
    const sourceBodyPath=(source.sectionPath?.length?source.sectionPath:[source.sectionHeading]).flatMap(Titles.titleParts);
    const leaf=sourcePath.at(-1)||source.title;
    const allSections=Rules.sections(toc.nodes);
    const title=Titles.clean;
    const commonPrefix=path=>{let count=0;while(count<Math.min(path.length,sourcePath.length)&&title(path[count])===title(sourcePath[count]))count++;return count;};
    const eligible=allSections.map((section,order)=>({...section,order,prefix:commonPrefix(section.path)})).filter(section=>!section.path.some(Titles.isCorrectionTitle));
    let sections=eligible.map(section=>{
      const titleScore=Rules.similarity(leaf,section.path.at(-1),this.rules).score;
      const pathScore=Rules.similarity(sourcePath.join(' '),section.path.join(' '),this.rules).score;
      return {...section,similarity:titleScore*.8+pathScore*.2,matchType:'similarity',reason:'제목 80%·전체 목차 경로 20% 유사도'};
    }).filter(section=>section.similarity>0).sort((a,b)=>b.similarity-a.similarity||b.prefix-a.prefix||b.path.length-a.path.length||a.order-b.order);
    const full=eligible.filter(s=>s.path.length===sourcePath.length&&s.prefix===sourcePath.length);
    const exact=eligible.filter(s=>title(s.path.at(-1))===title(leaf));
    if(full.length)sections=full.map(s=>({...s,similarity:1,matchType:'path',reason:'정규화한 전체 목차 경로 일치'}));
    else if(exact.length)sections=exact.sort((a,b)=>b.prefix-a.prefix||b.path.length-a.path.length||a.order-b.order).map(s=>({...s,similarity:1,matchType:'title',reason:'마지막 목차 제목 일치·상위 경로 우선'}));
    else{
      const ancestors=eligible.filter(s=>s.prefix===s.path.length&&s.prefix>0);
      if(ancestors.length)sections=ancestors.sort((a,b)=>b.path.length-a.path.length||a.order-b.order).map(s=>({...s,similarity:1,matchType:'ancestor',reason:'하위 목차 없음·가장 깊은 상위 목차 일치'}));
    }
    // Stored TOC only: choose once, never crawl other chapters after a miss.
    const section=sections[0],errors=[],candidates=[];
    let scanned=0,extracted=0,ruleRejected=0,rejected=0,timedOut=false,ruleCandidates=0,bodySection=null,bodySectionPath=[],bodySectionMatch=null;
    const diagnostics={missingKeywords:0,excludedKeywords:0,scopeConflict:0,lowSimilarity:0};
    const update=stage=>progress({stage,path:section?.path,scanned,total:section?1:0,candidates:candidates.length,extracted,ruleRejected,rejected});
    const result=()=>({report:toc.report,status:candidates.length?candidates[0].status:errors.length?'error':'not_found',candidates,
      selectedCandidateId:candidates[0]?.id||null,errors,scanned,total:section?1:0,availableSections:allSections.length,
      sourceTocPath:sourcePath,excludedCorrectionSections:allSections.length-eligible.length,
      selectedSection:section?{path:section.path,nodeId:section.nodeId,similarity:section.similarity,matchType:section.matchType,reason:section.reason}:null,
      rejected,extracted,ruleRejected,ruleCandidates,diagnostics,bodySection,bodySectionPath,bodySectionMatch,sourceSectionPath:sourceBodyPath,timedOut,partial:errors.length>0});
    if(!section){errors.push({error:'저장된 목차에서 관련 목차를 찾지 못했습니다. 다른 목차로 검색을 확장하지 않습니다.'});return result();}
    try{
      update('열린 보고서 본문·규칙 후보 탐색');
      const url=Rules.viewerUrl(section.sourceRef,toc.report.rcpNo);
      const missingTocPath=section.matchType==='ancestor'?sourcePath.slice(section.path.length):[];
      const chapterIndex=sourceBodyPath.findLastIndex(part=>title(part)===title(section.path.at(-1)));
      let wantedPath=sourceBodyPath.length?sourceBodyPath.slice(chapterIndex+1):[];
      if(missingTocPath.length){
        const last=sourceBodyPath.findLastIndex(part=>title(part)===title(missingTocPath.at(-1)));
        wantedPath=[...missingTocPath,...(last>=0?sourceBodyPath.slice(last+1):[])];
      }
      const loaded=await bounded(()=>this.load(url,signal,wantedPath.at(-1)||null,wantedPath),45000,signal,'보고서 본문 탐색 시간 초과');active();
      const tables=Array.isArray(loaded)?loaded:loaded.tables;extracted=loaded.extracted??tables.length;
      bodySection=loaded.scope||null;bodySectionPath=loaded.scopePath||[];bodySectionMatch=loaded.scopeMatch||null;ruleRejected=extracted-tables.length;Object.assign(diagnostics,loaded.diagnostics||{});
      const passed=[];
      for(const raw of tables){
        const table={...raw,reportId:toc.report.rcpNo,tocPath:section.path,sectionOrder:section.order,tocSimilarity:section.similarity};
        const rule=table.ruleResult||Rules.evaluate(source,table,input,this.rules);
        if(rule.passed)passed.push({table,rule});
        else{ruleRejected++;if(rule.missing.length)diagnostics.missingKeywords++;if(rule.excluded.length)diagnostics.excludedKeywords++;if(rule.scopeConflict)diagnostics.scopeConflict++;if(rule.score<this.rules.minimumRuleScore)diagnostics.lowSimilarity++;}
      }
      ruleCandidates=passed.length;
      for(const candidate of passed)candidates.push({...candidate,ai:null,status:'rule_matched',id:`${toc.report.rcpNo}:${section.order}:${candidate.table.tableIndex}:${candidate.table.fingerprint}`});
      scanned=1;
      if(signal.aborted){if(signal.reason?.name==='TimeoutError')timedOut=true;else active();}
    }catch(error){
      if(signal.aborted && signal.reason?.name!=='TimeoutError')throw new SearchCancelled();
      timedOut=signal.reason?.name==='TimeoutError';errors.push({path:section.path,error:timedOut?signal.reason.message:error.message});
    }
    const rank={rule_matched:0,matched:0,uncertain:1,unverified:1};
    candidates.sort((a,b)=>rank[a.status]-rank[b.status]||a.table.tableIndex-b.table.tableIndex);
    update('선택 목차 검색 완료');return result();
  }
}
module.exports={TableSearch,SearchCancelled};
