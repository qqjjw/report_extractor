const Rules=require('./table-rules');
const Titles=require('./table-live');
class TableChoice {
  constructor(inspect,choose,rules){this.inspect=inspect;this.choose=choose;this.rules=rules;}
  async report(source,toc,input,signal,progress=()=>{}){
    const trace=[],candidates=[],errors=[];
    const sourcePath=(source.tocPath||[]).filter(Boolean);
    const bodyPath=(source.sectionPath?.length?source.sectionPath:[source.sectionHeading]).flatMap(Titles.titleParts);
    let section=null,scopePath=[],extracted=0,diagnostics={},ruleCandidates=0;
    const active=()=>{if(signal.aborted)throw signal.reason||new Error('검색 취소됨');};
    const select=async(stage,target,items)=>{
      active();if(!items.length)throw new Error(`${stage}: 선택할 후보가 없습니다.`);
      progress({stage:`Laya ${stage} 선택 · 후보 ${items.length}개`,scanned:trace.length,total:trace.length+1,candidates:0,path:section?.path});
      const reference=stage==='표'?{table:summary(source)}:{target,...(section?{parentPath:stage==='본문 제목'&&scopePath.length?scopePath:section.path}:{})};
      const answer=await this.choose({stage,source:reference,candidates:items.map(item=>({id:item.id,description:item.description}))},signal);
      active();const selected=items.find(item=>item.id===answer.selectedId);
      if(!selected||answer.truncated)throw new Error('Laya 선택 ID가 유효하지 않거나 입력이 잘렸습니다.');
      trace.push({stage,target,candidateCount:items.length,selectedId:selected.id,selectedTitle:selected.title,probability:answer.probabilities?.[selected.id],probabilities:answer.probabilities});
      return selected;
    };
    try{
      active();if(!sourcePath.length)throw new Error('기준 표의 저장된 목차 경로가 필요합니다.');
      let nodes=toc.nodes,path=[],depth=0,lastRef=null;
      while(depth<sourcePath.length&&nodes.length){
        const options=nodes.filter(node=>!Titles.isCorrectionTitle(node.title)).map(node=>({...node,description:{title:node.title,path:[...path,node.title]}}));
        const selected=await select('목차',sourcePath[depth],options);
        path=[...path,selected.title];if(selected.sourceRef)lastRef=selected.sourceRef;
        section={nodeId:selected.id,path,sourceRef:lastRef,matchType:'laya_choice',reason:'Laya choice 계층별 선택'};
        nodes=selected.children||[];depth++;
      }
      if(!section?.sourceRef)throw new Error('선택한 목차의 본문 위치 정보가 없습니다.');
      const url=Rules.viewerUrl(section.sourceRef,toc.report.rcpNo);
      const missing=sourcePath.slice(depth);
      const bodyIndex=bodyPath.findLastIndex(part=>Titles.clean(part)===Titles.clean(sourcePath.at(-1)));
      const remaining=[...missing,...(bodyIndex>=0?bodyPath.slice(bodyIndex+1):bodyPath)];
      let parentId=null;
      if(remaining.length){
        const doc=await this.inspect(url,signal,{action:'headings'});active();
        let headings=doc.headings||[];
        // The loaded document may repeat the TOC heading as its root.
        while(headings.length===1&&Titles.clean(headings[0].title)===Titles.clean(section.path.at(-1)))headings=headings[0].children||[];
        for(const target of remaining){
          const selected=await select('본문 제목',target,headings.map(heading=>({...heading,description:{title:heading.title,path:heading.path}})));
          parentId=selected.id;scopePath=selected.path;headings=selected.children||[];
        }
      }
      const loaded=await this.inspect(url,signal,{action:'tables',parentId});active();
      extracted=loaded.extracted||0;diagnostics=loaded.diagnostics||{};
      const options=(loaded.tables||[]).map(table=>{
        const rule=table.ruleResult||Rules.evaluate(source,table,input,this.rules);
        return {id:`table:${table.tableIndex}:${table.fingerprint}`,title:table.title,table:{...table,reportId:toc.report.rcpNo,tocPath:section.path},rule,description:{...summary(table),bodyOrder:table.tableIndex}};
      }).filter(item=>item.rule.passed);
      ruleCandidates=options.length;
      const selected=await select('표','같은 종류의 표. 목적과 구조가 동등하면 위쪽 당기 표 우선',options);
      candidates.push({...selected,status:'choice_matched',ai:{model:'multilingual',choiceProbability:trace.at(-1).probability}});
    }catch(error){if(signal.aborted&&signal.reason?.name!=='TimeoutError')throw error;errors.push({path:section?.path||[],error:error.message});}
    return {mode:'laya_choice',report:toc.report,status:candidates.length?'choice_matched':'error',candidates,selectedCandidateId:candidates[0]?.id||null,errors,trace,sourceTocPath:sourcePath,sourceSectionPath:bodyPath,selectedSection:section,bodySection:scopePath.at(-1)||null,bodySectionPath:scopePath,extracted,ruleCandidates,ruleRejected:Math.max(0,extracted-ruleCandidates),diagnostics,scanned:trace.length,total:trace.length,partial:false};
  }
}
function summary(table){
  const rows=(table.cells||[]).map(row=>row.map(cell=>String(cell.text||'').replace(/\s+/g,' ').trim()).filter(value=>/\p{L}/u.test(value))).filter(row=>row.length);
  const text=rows.length?rows.map(row=>row.join(' | ')).join('\n'):[...(table.headers||[]),...(table.rowLabels||[])].filter(Boolean).join('\n');
  const hints=[...new Set(`${table.title||''} ${table.context||''}`.match(/당기|전기|연결|별도|개별/g)||[])];
  return {text:[hints.join(' | '),text].filter(Boolean).join('\n')};
}
module.exports={TableChoice,summary};
