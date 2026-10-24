// Domain-independent control flow. The profile owns document access and validation.
async function retrieve({ profile, target, query, indexQuery, k = 5, emit = () => {} }) {
  if (!query.trim() || !Number.isInteger(k) || k < 1 || k > 5) throw Error('검색어와 K(1~5)를 확인하세요.');
  const event = (step, detail) => emit({ target, step, ...detail });
  event(1, { action: '목표 확인', query, indexQuery, k });
  let indexes = await profile.indexes(target, indexQuery);
  event(2, { action: 'INDEX 검색', count: indexes.length });
  if (!indexes.length) return { status: 'refine_index', count: 0, candidates: [] };
  if (indexes.length > k) return { status: 'refine_index', count: indexes.length, candidates: [] };
  let candidates = [];
  for (const index of indexes) {
    event(3, { action: '목차 이동', location: index.id, title: index.title });
    await profile.open(target, index.id);
    candidates.push(...await profile.scan(target, index, query));
  }
  // No candidate body is returned or embedded before this gate.
  event(4, { action: '후보 개수 확인', count: candidates.length, k });
  if (!candidates.length) return { status: 'retry_query', count: 0, candidates: [] };
  if (candidates.length > k) return { status: 'refine_query', count: candidates.length, candidates: [] };
  if (candidates.some(c => c.chars > profile.maxChunkChars) || candidates.reduce((s, c) => s + c.chars, 0) > profile.maxBatchChars) {
    return { status: 'refine_chunk', count: candidates.length, candidates };
  }
  let selected = candidates[0];
  if (candidates.length > 1) {
    if (!profile.embed) return { status: 'needs_embedding', count: candidates.length, candidates };
    event(5, { action: '선별 후보만 임베딩', count: candidates.length });
    const texts = [];
    for (const candidate of candidates) texts.push((await profile.read(target, candidate)).text);
    const scores = await profile.embed(query, texts);
    candidates = candidates.map((c, i) => ({ ...c, score: scores[i] })).sort((a, b) => b.score - a.score);
    selected = candidates[0];
  } else event(5, { action: '단일 후보 · 임베딩 생략', count: 1 });
  event(6, { action: '원문 근거 확인 대기', location: selected.id });
  await profile.focus(target, selected);
  const evidence = await profile.read(target, selected);
  return { status: 'evidence_ready', count: candidates.length, candidates, selected: selected.id, evidence };
}
module.exports = { retrieve };
