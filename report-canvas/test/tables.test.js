const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compact, terms, validateOptions, route } = require('../lib/tables');
const node = (id, title, parents = []) => ({ id, title, path: [...parents, title] });
test('표 검색 문구는 기준 표 안에서 선택하고 공백과 중복을 정리한다', () => {
  assert.deepEqual(terms('기초\n기말,기초'), ['기초', '기말']);
  assert.deepEqual(validateOptions({text:'감가상각비 기초 유형자산'}, '유형자산', '감가 상각비\n기초').keywords, ['감가 상각비','기초']);
  assert.throws(() => validateOptions({text:'기초'}, '유형자산', '기말'), /기준 표/);
  assert.throws(() => validateOptions({text:'기초'}, '유형자산', ''), /필수/);
  assert.equal(compact('2-1. 연결 재무상태표'), '연결재무상태표');
});
test('세부 목차가 없으면 정확한 상위 목차로 이동하며 비슷한 제목은 사용하지 않는다', () => {
  const reference = {node:node('s','10. 유형자산 (연결)',['III. 재무에 관한 사항','3. 연결재무제표 주석'])};
  const parent = node('p','3. 연결재무제표 주석',['III. 재무에 관한 사항']);
  assert.equal(route(reference,[node('x','유형자산 관련 사항'),parent]).id,'p');
  assert.throws(() => route(reference,[node('x','유형자산 관련 사항')]), /대응하는 목차/);
});
test('동일 제목은 상위 경로로 구분하며 모호하면 자동 이동하지 않는다', () => {
  const reference={node:node('s','10. 유형자산',['연결재무제표 주석'])};
  const linked=node('a','11. 유형자산',['연결재무제표 주석']),separate=node('b','9. 유형자산',['재무제표 주석']);
  assert.equal(route(reference,[separate,linked]).id,'a');
  assert.throws(()=>route(reference,[linked,node('c','12. 유형자산',['연결재무제표 주석'])]),/여러 개/);
});
