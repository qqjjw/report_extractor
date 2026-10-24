const { test } = require('node:test');
const assert = require('node:assert/strict');
const { retrieve } = require('../core.cjs');
function setup(count, overrides = {}) {
  const calls = [];
  const candidates = Array.from({ length: count }, (_, i) => ({ id: String(i), chars: 100 }));
  const profile = {
    maxChunkChars: 1000, maxBatchChars: 3000,
    indexes: async () => [{ id: 's', title: 'section' }], open: async () => calls.push('open'),
    scan: async () => candidates, focus: async () => calls.push('focus'),
    read: async (_, candidate) => { calls.push(`read:${candidate.id}`); return { text: candidate.id }; },
    ...overrides
  };
  return { profile, calls };
}
const search = profile => retrieve({ profile, target: 0, query: 'term', indexQuery: 'section', k: 2 });
test('too many candidates: do not read or embed bodies', async () => {
  const { profile, calls } = setup(3, { embed: async () => { throw Error('must not embed'); } });
  assert.equal((await search(profile)).status, 'refine_query');
  assert.deepEqual(calls, ['open']);
});
test('one candidate: skip embedding and show original evidence', async () => {
  const { profile } = setup(1, { embed: async () => { throw Error('must skip'); } });
  assert.equal((await search(profile)).status, 'evidence_ready');
});
test('multiple candidates: embed only selected texts and query, never finalize from similarity', async () => {
  const { profile } = setup(2, { embed: async (query, texts) => { assert.equal(query, 'term'); assert.deepEqual(texts, ['0', '1']); return [0.1, 0.9]; } });
  const result = await search(profile);
  assert.equal(result.selected, '1'); assert.equal(result.status, 'evidence_ready');
});
test('embedding not configured: return metadata without reading bodies', async () => {
  const { profile, calls } = setup(2);
  assert.equal((await search(profile)).status, 'needs_embedding'); assert.deepEqual(calls, ['open']);
});
test('no candidates: request another query', async () => {
  const { profile } = setup(0); assert.equal((await search(profile)).status, 'retry_query');
});
test('index overflow prevents document navigation', async () => {
  const { profile, calls } = setup(1, { indexes: async () => [{}, {}, {}] });
  assert.equal((await search(profile)).status, 'refine_index'); assert.deepEqual(calls, []);
});
test('oversized table prevents body reads and embedding', async () => {
  const { profile, calls } = setup(1, { maxChunkChars: 50 });
  assert.equal((await search(profile)).status, 'refine_chunk'); assert.deepEqual(calls, ['open']);
});
