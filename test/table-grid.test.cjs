const {test}=require('node:test'),assert=require('node:assert/strict');
const {tableGrid}=require('../table-grid.cjs');
test('HTML rowspan and colspan preserve source anchors, exact strings and empty cells',()=>{
  const rows=[[{text:'구분',rowSpan:2,colSpan:1},{text:'금액',rowSpan:1,colSpan:2}],
    [{text:'당기',rowSpan:1,colSpan:1},{text:'전기',rowSpan:1,colSpan:1}],
    [{text:' 감가상각비 ',rowSpan:1,colSpan:1},{text:'(1,234)',rowSpan:1,colSpan:1},{text:'',rowSpan:1,colSpan:1}]];
  const grid=tableGrid(rows);assert.equal(grid.width,3);assert.equal(grid.height,3);
  assert.deepEqual(grid.cells.map(c=>[c.r,c.c,c.text]),[[0,0,'구분'],[0,1,'금액'],[1,1,'당기'],[1,2,'전기'],[2,0,' 감가상각비 '],[2,1,'(1,234)'],[2,2,'']]);
});
