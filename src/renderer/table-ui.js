(function (root) {
  const labels={rule_matched:'규칙 일치 · Laya 비활성',matched:'AI 판정 일치',uncertain:'불확실 · 규칙 후보',unverified:'AI 미검증 · 규칙 후보',rejected:'AI 불일치',not_found:'유사 표 없음',error:'검색 실패',searching:'검색 중'};
  const periods={current:'당기',previous:'전기',mixed:'당기·전기 혼합',unknown:'판단 정보 부족'};
  function attach(report,callbacks) {
    const el=document.createElement('section');el.className='table-evidence';el.setAttribute('aria-label',`${report.companyName} ${report.period} 표 검색과 판정 근거`);
    const controls=document.createElement('div');controls.className='table-controls';
    const button=(name,callback)=>{const b=document.createElement('button');b.textContent=name;b.onclick=callback;return b;};
    const mode=button('표 선택',()=>callbacks.mode(mode));mode.setAttribute('aria-pressed','false');
    const search=button('선택한 보고서에서 검색',()=>callbacks.search({include:split(include.value),exclude:split(exclude.value)}));search.disabled=true;
    const cancel=button('검색 취소',callbacks.cancel);cancel.disabled=true;
    const include=document.createElement('input'),exclude=document.createElement('input');
    include.placeholder='필수 키워드 · 쉼표로 구분';exclude.placeholder='제외 키워드 · 쉼표로 구분';
    const incLabel=document.createElement('label'),excLabel=document.createElement('label');
    incLabel.append('포함 ',include);excLabel.append('제외 ',exclude);
    controls.append(mode,incLabel,excLabel,search,cancel);el.append(controls);
    const info=document.createElement('p');info.className='table-info';info.textContent='표 선택을 누른 뒤 본문의 표를 클릭하세요. 검색 결과와 판정 근거가 여기에 표시됩니다.';el.append(info);
    const status=document.createElement('p');status.className='table-status';status.setAttribute('role','status');el.append(status);
    const content=document.createElement('div');content.className='table-results';el.append(content);
    let working=false,targetCount=null,targetsLocked=false;
    const targetInfo=document.createElement('p');targetInfo.className='table-target-info';el.insertBefore(targetInfo,status);
    function availability(){search.disabled=working||targetsLocked||!callbacks.hasSource()||targetCount===0;mode.disabled=working||targetsLocked;for(const b of content.querySelectorAll('button,select'))b.disabled=working||targetsLocked;}
    function split(value){return [...new Set(value.split(/[,\n]/).map(v=>v.trim()).filter(Boolean))];}
    function line(parent,value){const p=document.createElement('p');p.textContent=value;parent.append(p);}
    return {
      el,
      selection(table){info.textContent=`선택 표: ${table.title} · ${table.rowCount}행 × ${table.columnCount}열 · 목차: ${(table.tocPath||[]).join(' > ')||'확인 불가'}`;availability();mode.textContent='표 선택';mode.setAttribute('aria-pressed','false');},
      mode(enabled){mode.textContent=enabled?'선택 취소':'표 선택';mode.setAttribute('aria-pressed',String(enabled));},
      busy(value){working=value;cancel.disabled=!value;availability();},
      targets(count,locked){targetCount=count;targetsLocked=locked;targetInfo.textContent=callbacks.hasSource()?(count?`검색 대상 ${count}개 선택됨`:'좌측 목록에서 검색 대상 보고서를 선택하세요.'):'';availability();},
      status(message){status.textContent=message;},
      reset(){content.replaceChildren();status.textContent='';search.disabled=true;cancel.disabled=true;mode.disabled=false;info.textContent='표 선택을 누른 뒤 본문의 표를 클릭하세요.';this.mode(false);},
      result(result){
        content.replaceChildren();status.textContent=labels[result.status]||result.status;
        if(result.selectedSection)line(content,`선택 목차: ${result.selectedSection.path.join(' > ')} · 이 구간만 1회 검색`);
        if(result.sourceTocPath?.length)line(content,`기준 목차: ${result.sourceTocPath.join(' > ')}`);
        if(result.selectedSection?.reason)line(content,`목차 선택 근거: ${result.selectedSection.reason}`);
        if(result.excludedCorrectionSections)line(content,`정정 내역 목차 제외: ${result.excludedCorrectionSections}개`);
        if(result.diagnostics?.correctionTables)line(content,`정정 내역 표 제외: ${result.diagnostics.correctionTables}개`);
        if(result.sourceSectionPath?.length)line(content,`기준 표 제목 경로: ${result.sourceSectionPath.join(' > ')}`);
        if(result.bodySection)line(content,`본문 내부 검색 구간: ${result.bodySectionPath?.length?result.bodySectionPath.join(' > '):result.bodySection}`);
        if(result.bodySectionMatch?.type==='similarity')line(content,`본문 제목 유사 일치: ${(result.bodySectionMatch.similarity*100).toFixed(0)}% · 가장 유사한 구간 1개 검색`);
        const list=document.createElement('select');list.setAttribute('aria-label','검색된 표 후보');list.disabled=!cancel.disabled;
        for(const candidate of result.candidates||[]){const option=document.createElement('option');option.value=candidate.id;option.textContent=`${candidate.table.tocPath.at(-1)} · 상단부터 ${candidate.table.tableIndex+1}번째 · ${labels[candidate.status]}`;list.append(option);}
        const evidence=document.createElement('div');
        function show(candidate){
          evidence.replaceChildren();if(!candidate)return;
          line(evidence,`목차: ${candidate.table.tocPath.join(' > ')} · 일치도 ${(candidate.table.tocSimilarity*100).toFixed(0)}%`);
          line(evidence,`공통 키워드: ${candidate.rule.commonKeywords.join(', ')||'없음'} · 규칙 유사도 ${(candidate.rule.score*100).toFixed(0)}%`);
          line(evidence,`필수 키워드 통과 · 제외 키워드 없음 · 비교 범위: ${candidate.rule.sourceScope} → ${candidate.rule.targetScope}`);
          if(candidate.ai?.error)line(evidence,`Laya 미검증: ${candidate.ai.error}`);
          else if(candidate.ai){line(evidence,`Laya: 같은 유형 ${(candidate.ai.sameProbability*100).toFixed(1)}% · 범위 충돌 ${(candidate.ai.scopeConflictProbability*100).toFixed(1)}% · ${periods[candidate.ai.period]} · ${candidate.ai.model}`);
            if(candidate.ai.truncated)line(evidence,'긴 입력의 일부 항목이 생략되어 확정 결과로 처리하지 않았습니다.');}
          line(evidence,`동일 판정·목차 구간에서 상단 표 우선 · 후보 ${result.candidates.length}개`);
        }
        if(list.options.length){list.value=result.selectedCandidateId;list.onchange=()=>{const candidate=result.candidates.find(c=>c.id===list.value);show(candidate);callbacks.show(candidate);};content.append(list,evidence);show(result.candidates.find(c=>c.id===list.value));}
        if(result.partial)line(content,`일부 구간만 검색됨: ${result.scanned}/${result.total} · 실패 ${result.errors.length}개`);
        for(const error of result.errors||[])line(content,`${(error.path||[]).join(' > ')}: ${error.error}`);
        if(result.rejected)line(content,`Laya가 다른 유형으로 제외한 후보: ${result.rejected}개`);
        if(result.extracted!==undefined)line(content,`추출한 표 ${result.extracted}개 · 규칙에서 제외 ${result.ruleRejected}개 · Laya에서 제외 ${result.rejected}개`);
        if(result.diagnostics && result.ruleRejected)line(content,`규칙 제외 사유: 필수 키워드 누락 ${result.diagnostics.missingKeywords} · 제외 키워드 ${result.diagnostics.excludedKeywords} · 범위 충돌 ${result.diagnostics.scopeConflict} · 유사도 부족 ${result.diagnostics.lowSimilarity} (사유 중복 가능)`);
        if(result.status==='error'||result.partial||result.status==='not_found')content.append(button('이 보고서 재시도',callbacks.retry));
      }
    };
  }
  root.TableUI={attach};
})(globalThis);
