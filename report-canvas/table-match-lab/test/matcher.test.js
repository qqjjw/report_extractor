const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {analyze,match,compare}=require('../matcher');
const read=year=>fs.readFileSync(path.join(__dirname,'..','..',year+'.html'),'utf8');
const source=read('2023'),target=read('2022'),left=analyze(source,'2023.html'),right=analyze(target,'2022.html');
test('세부 본문과 전체 주석에서 같은 주제를 찾고 다른 주석을 제외한다',()=>{
 assert.equal(left.candidates.length,6);assert.equal(right.candidates.length,5);
 assert.ok(right.rejected.length>0);
 assert.ok(right.candidates.every(c=>c.section==='10. 유형자산:'));
 assert.ok(right.ranges.some(r=>r.title==='2.9 유형자산')); // 회계정책 구간에 감가상각 데이터 표는 없음
 assert.equal(right.ranges.find(r=>r.title==='10. 유형자산:').boundary,'무형자산');
});
test('표 역할·기간을 구분하고 한 표에 두 기간이 있는 비용표도 대응한다',()=>{
 const result=match(left,right);assert.equal(result.pairs.length,6);assert.equal(result.unmatchedLeft.length,0);assert.equal(result.unmatchedRight.length,0);
 for(const p of result.pairs){const a=left.candidates.find(c=>c.id===p.left),b=right.candidates.find(c=>c.id===p.right);assert.equal(a.role,b.role);assert.equal(a.scope,b.scope);assert.ok(a.period===b.period||b.period==='당기·전기');}
 const expense=right.candidates.find(c=>c.role==='계정과목별 비용표');assert.equal(expense.period,'당기·전기');assert.match(expense.evidence,/설명/);
 assert.equal(result.pairs.filter(p=>p.right===expense.id).length,2);
 assert.equal(compare(left.candidates[0],{...right.candidates[0],period:'전기'}),null);
});
test('행의 표현 차이를 흡수하되 누계액을 감가상각비로 취급하지 않는다',()=>{
 const doc=analyze('<p>10. 유형자산</p><p>당기</p><table><tr><td>감가상각누계액</td><td>100</td></tr></table><table><tr><td>감가상각비</td><td>20</td></tr></table><p>11. 무형자산</p><table><tr><td>감가상각비</td><td>30</td></tr></table>','fixture');
 assert.equal(doc.candidates.length,1);assert.equal(doc.rejected.length,1);
 assert.ok(left.candidates[0].rowKeys.includes('감가상각'));assert.ok(right.candidates[0].rowKeys.includes('감가상각'));
 assert.equal(read('2023'),source);assert.equal(read('2022'),target);
});
