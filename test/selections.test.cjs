const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSelections}=require('../selections.cjs');
const report={rcpNo:'1',url:'https://example.com/1',reportName:'2025'};
const evidence={text:'원문',rows:[[{text:'10',colSpan:1,rowSpan:1}]],position:{visible:true}};
test('independent selections survive later searches; metadata omits source bodies',()=>{
  const selections=createSelections();
  const a=selections.add(report,{id:'7:table:1'},evidence,'주식 수');
  const b=selections.add(report,{id:'120:table:14'},evidence,'직원 수');
  evidence.rows[0][0].text='changed';
  assert.equal(selections.list().length,2);
  assert.equal(selections.list()[0].evidence,undefined);
  assert.equal(selections.get(a).evidence.rows[0][0].text,'10');
  selections.add(report,{id:'7:table:1'},evidence,'주식 수');
  assert.equal(selections.list().length,2);
  selections.remove(b);assert.equal(selections.list().length,1);
  selections.retain([{...report,url:'https://example.com/new'}]);assert.equal(selections.list().length,0);
});
test('reject missing groups and invisible tables',()=>{
  const s=createSelections();
  assert.throws(()=>s.add(report,{id:'a'},evidence,''),/종류/);
  assert.throws(()=>s.add(report,{id:'a'},{...evidence,position:{visible:false}},'직원 수'),/화면/);
});
