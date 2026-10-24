const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLayout, reconcile, apply, parseReports, sortReports, arrange } = require('../canvas.cjs');
const reports = [1,2,3,4].map(i => ({rcpNo:String(i),url:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+i}));
function board() { const layout=createLayout(); reconcile(layout,[],reports); return layout; }
test('all JSON entries have independent windows in one horizontal row', () => {
  const l=board(); assert.equal(Object.keys(l.windows).length,4); assert.equal(l.windows['4'].y,0); assert.equal(l.windows['4'].x,3528); assert.equal(l.windows['1'].width,1152); assert.equal(l.windows['1'].height,1520);
});
test('canvas zoom preserves the logical location under the mouse', () => {
  const l=board(), c=l.canvas, anchor={x:c.x+177/c.zoom,y:c.y+311/c.zoom};
  apply(l,'canvas-zoom',{ratio:1.4,anchorX:177,anchorY:311});
  assert.ok(Math.abs(anchor.x-c.x-177/c.zoom)<1e-8); assert.ok(Math.abs(anchor.y-c.y-311/c.zoom)<1e-8);
});
test('world expands in all directions without changing camera coordinates', () => {
  const l=board(); apply(l,'canvas-pan',{x:-30000,y:50000});
  assert.equal(l.canvas.x,-30000); assert.equal(l.canvas.y,50000); assert.ok(l.canvas.minX < -30000); assert.ok(l.canvas.maxY>50000);
  apply(l,'window-move',{x:90000,y:-80000},'1'); assert.ok(l.canvas.maxX>90000); assert.ok(l.canvas.minY < -80000);
});
test('site zoom stays independent and never changes canvas geometry', () => {
  const l=board(), before=structuredClone(l.canvas); apply(l,'site-zoom',{ratio:1.7},'1');
  assert.equal(l.windows['1'].zoom,1.7); assert.equal(l.windows['2'].zoom,1); assert.deepEqual(l.canvas,before);
});
test('JSON reconciliation preserves state by ID across reordering and handles removal/addition/URL change', () => {
  const l=board(); apply(l,'window-move',{x:500,y:600},'2'); apply(l,'site-zoom',{ratio:1.8},'2');
  reconcile(l,reports,[reports[1],{...reports[0],url:reports[0].url+'&changed=1'},reports[3],{...reports[2],rcpNo:'5'}]);
  assert.equal(l.windows['2'].x,500); assert.equal(l.windows['2'].zoom,1.8); assert.equal(l.windows['1'].zoom,1); assert.equal(l.windows['3'],undefined); assert.ok(l.windows['5']);
});
test('focus reveals an off-screen report and brings even the initially active card forward', () => {
  const l=board(); apply(l,'window-move',{x:20000,y:20000},'1'); apply(l,'window-focus',{},'1');
  assert.equal(l.windows['1'].z,l.order); assert.equal(l.canvas.x,19976); assert.equal(l.canvas.y,19976);
});
test('invalid JSON, duplicate IDs, and non-DART sources are rejected before reconciliation', () => {
  assert.throws(()=>parseReports('{')); assert.throws(()=>parseReports(JSON.stringify({reports:[reports[0],reports[0]]})));
  assert.throws(()=>parseReports(JSON.stringify({reports:[{rcpNo:'1',url:'https://example.com'}]})));
});
test('date sort rearranges the horizontal row while preserving size and site zoom', () => {
  const l=board(); l.windows['2'].zoom=1.6; l.windows['2'].width=1200;
  const dated=reports.map((r,i)=>({...r,receivedDate:'202'+i+'.03.10'}));
  const desc=sortReports(dated,'desc'); assert.equal(desc[0].rcpNo,'4'); arrange(l,desc);
  assert.equal(l.windows['4'].x,0); assert.equal(l.windows['2'].zoom,1.6); assert.equal(l.windows['2'].width,1200);
  assert.deepEqual(sortReports(dated,'asc').map(r=>r.rcpNo),['1','2','3','4']);
});
test('panels can be resized and collapsed independently of report layout',()=>{
  const l=board();apply(l,'panel-resize',{side:'left',width:410});apply(l,'panel-toggle',{side:'right',collapsed:'true'});
  assert.equal(l.panels.left.width,410);assert.equal(l.panels.right.collapsed,true);assert.equal(l.panels.left.collapsed,false);assert.equal(l.windows['1'].width,1152);
  apply(l,'panel-toggle',{side:'right',collapsed:'false'});assert.equal(l.panels.right.collapsed,false);
});
