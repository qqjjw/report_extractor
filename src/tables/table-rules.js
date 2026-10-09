(function (root) {
  const api = {
    normalize(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ''); },
    tokens(value, rules) {
      let text = String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').replace(/\d[\d.,%()\-/]*/g, ' ');
      for (const [from, to] of Object.entries(rules.synonyms || {})) text = text.split(api.normalize(from)).join(api.normalize(to));
      const ignore = new Set(rules.ignoreTokens || []);
      // Keep Korean words separated before also using character bigrams for compound labels.
      const words = text.match(/[\p{L}]+/gu) || [];
      const result = new Set();
      for (const word of words) if (!ignore.has(word) && word.length > 1) {
        result.add(word);
        if (word.length > 2) for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i,i+2));
      }
      return result;
    },
    similarity(a, b, rules) {
      const left = api.tokens(a, rules), right = api.tokens(b, rules);
      const common = [...left].filter(t => right.has(t));
      return { score: common.length / Math.max(1, new Set([...left,...right]).size), common };
    },
    scope(table) {
      const value = `${table.context} ${table.title}`;
      const last=[...value.matchAll(/연결|별도|개별/g)].at(-1)?.[0];
      if (last==='연결') return '연결';
      if (last) return '별도';
      return '미상';
    },
    evaluate(source, candidate, input, rules) {
      const full = api.normalize([candidate.title,...candidate.cells.flat().map(c=>c.text)].join(' '));
      const include = [...new Set([...(rules.include || []),...(input.include || [])])];
      const exclude = [...new Set([...(rules.exclude || []),...(input.exclude || [])])];
      const missing = include.filter(k=>!full.includes(api.normalize(k)));
      const excluded = exclude.filter(k=>full.includes(api.normalize(k)));
      const labels = t => [...t.headers,...t.rowLabels].join(' ');
      const similarity = api.similarity(labels(source), labels(candidate), rules);
      const sourceScope = api.scope(source), targetScope = api.scope(candidate);
      const scopeConflict = sourceScope !== '미상' && targetScope !== '미상' && sourceScope !== targetScope;
      return { passed: !missing.length && !excluded.length && !scopeConflict && (include.length>0 || similarity.score >= rules.minimumRuleScore),
        missing, excluded, scopeConflict, sourceScope, targetScope, score: similarity.score, commonKeywords: similarity.common.filter(k=>k.length>1).slice(0,20) };
    },
    sections(nodes, prefix = []) {
      return nodes.flatMap(node => {
        const path = [...prefix,node.title];
        const children = api.sections(node.children, path);
        return [...(node.sourceRef ? [{nodeId:node.id,path,sourceRef:node.sourceRef}] : []),...children];
      });
    },
    viewerUrl(ref, reportId) {
      const keys = ['dcmNo','eleId','offset','length','dtd'];
      if (!ref || keys.some(k=>ref[k] == null) || (ref.rcpNo && ref.rcpNo !== reportId)) throw new Error('목차 본문 위치 정보가 부족하거나 접수번호가 다릅니다.');
      const url = new URL('https://dart.fss.or.kr/report/viewer.do');
      url.searchParams.set('rcpNo',reportId); for (const key of keys) url.searchParams.set(key,String(ref[key]));
      return url.href;
    },
    sameDocument(a,b) {
      try { const x=new URL(a),y=new URL(b); return x.origin===y.origin && x.pathname===y.pathname && ['rcpNo','dcmNo','eleId','offset','length','dtd'].every(k=>x.searchParams.get(k)===y.searchParams.get(k)); } catch {return false;}
    },
    decision(rule, ai, threshold) {
      if (!rule.passed) return 'excluded';
      if (!ai || ai.error) return 'unverified';
      if (ai.sameProbability <= 1-threshold || ai.scopeConflictProbability >= threshold) return 'rejected';
      if (!ai.truncated && ai.sameProbability >= threshold && ai.scopeConflictProbability <= 1-threshold) return 'matched';
      return 'uncertain';
    }
  };
  if (typeof module !== 'undefined') module.exports = api; else root.TableRules = api;
})(globalThis);
