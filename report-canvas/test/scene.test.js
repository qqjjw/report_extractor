const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {validateReports,readReports,createScene,arrange,resize,applySize,zoomTo}=require('../lib/scene');
const report=(id,name)=>({rcpNo:String(id).padStart(14,'0'),url:`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${String(id).padStart(14,'0')}`,reportName:name,companyName:'테스트 회사',receivedDate:'2026.01.01'});
test('existing collector JSON contract, deduplication and unsafe URL rejection',()=>{
 const one=report(1,'사업보고서 (2025.12)');
 assert.equal(validateReports({version:1,reports:[one,one]}).length,1);
 assert.throws(()=>validateReports({version:2,reports:[]}));
 assert.throws(()=>validateReports({version:1,reports:[{...one,url:'file:///C:/secret'}]}));
 assert.throws(()=>validateReports({version:1,reports:[{...one,url:'https://dart.fss.or.kr.evil.test/'}]}));
});
test('horizontal layout, period order with stable ties and missing period last',()=>{
 const scene=createScene([report(1,'정정 사업보고서 (2024.12)'),report(2,'사업보고서 (2025.12)'),report(3,'기타'),report(4,'분기보고서 (2024.12)')]);
 assert.deepEqual(scene.cards.map(c=>c.x),[0,1084,2168,3252]);
 assert.ok(scene.cards.every(c=>c.y===0));
 arrange(scene,'asc');assert.deepEqual(scene.cards.map(c=>c.rcpNo),[1,4,2,3].map(id=>String(id).padStart(14,'0')));
 arrange(scene,'desc');assert.deepEqual(scene.cards.map(c=>c.rcpNo),[2,1,4,3].map(id=>String(id).padStart(14,'0')));
 scene.cards[0].x=-500;scene.cards[0].y=20;arrange(scene);assert.equal(scene.cards[0].x,0);assert.equal(scene.pan.x,24);
});
test('resize minimum, apply size retains positions, align respects changed widths, zoom limits',()=>{
 const scene=createScene([report(1,'a'),report(2,'b')]);
 resize(scene.cards[0],100,100);assert.equal(scene.cards[0].width,480);assert.equal(scene.cards[0].height,360);
 resize(scene.cards[0],1200,700);const x=scene.cards[1].x;applySize(scene,scene.cards[0]);assert.equal(scene.cards[1].width,1200);assert.equal(scene.cards[1].x,x);
 arrange(scene);assert.equal(scene.cards[1].x,1224);
 zoomTo(scene,0);assert.equal(scene.zoom,.25);zoomTo(scene,10);assert.equal(scene.zoom,1.5);
});
test('read refresh sees additions/deletions and does not write or destroy existing scene on bad input',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-test-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const file=path.join(folder,'reports.json');await assert.rejects(readReports(file),/파일이 없습니다/);
 const first={version:1,reports:[report(1,'one')]};await fs.writeFile(file,JSON.stringify(first));
 const scene=createScene(await readReports(file));const before=await fs.readFile(file,'utf8');await readReports(file);assert.equal(await fs.readFile(file,'utf8'),before);
 await fs.writeFile(file,JSON.stringify({version:1,reports:[report(2,'two'),report(3,'three')]}));assert.equal((await readReports(file)).length,2);
 await fs.writeFile(file,'broken');await assert.rejects(readReports(file));assert.equal(scene.cards[0].reportName,'one');
});

const {reportBounds,scrollRange,centerOn,preserveCenter}=require('../lib/scene');
test('negative bounds, zoom, expanding scroll range and center preservation',()=>{
 const scene=createScene([report(1,'a'),report(2,'b')]);scene.cards[0].x=-2000;scene.cards[0].y=-900;resize(scene.cards[1],1500,1200);zoomTo(scene,.5);
 const view={width:900,height:600};assert.equal(reportBounds(scene).minX,-1000);
 const range=scrollRange(scene,view);assert.ok(range.minX<=-1900);assert.ok(range.minY<=-1050);
 centerOn(scene,scene.cards[0],view);assert.equal(scene.pan.x+(scene.cards[0].x+scene.cards[0].width/2)*scene.zoom,450);
 const next=scrollRange(scene,view,range);assert.ok(next.minX<=range.minX);assert.ok(next.maxX>=range.maxX);
 const center={x:(view.width/2-scene.pan.x)/scene.zoom,y:(view.height/2-scene.pan.y)/scene.zoom};
 const after={width:600,height:450};preserveCenter(scene,view,after);
 assert.equal((after.width/2-scene.pan.x)/scene.zoom,center.x);assert.equal((after.height/2-scene.pan.y)/scene.zoom,center.y);
 const offset=-scene.pan.x-next.minX;assert.equal(-(next.minX+offset),scene.pan.x);
 const empty=createScene([]),emptyRange=scrollRange(empty,view);assert.equal(emptyRange.maxX-emptyRange.minX,view.width);
});

test('fixed scrollbar bounds stop at both ends; drag expands only beyond boundaries',()=>{
 const {scrollTo}=require('../lib/scene');const scene=createScene([report(1,'a')]),view={width:900,height:600};
 assert.equal(scene.cards[0].width,1060);assert.equal(scene.cards[0].height,1400);
 let range=scrollRange(scene,view),initial={...range};
 for(let i=0;i<100;i++){scrollTo(scene,view,range,1e9,1e9);range=scrollRange(scene,view,range,'fixed');assert.deepEqual(range,initial);scrollTo(scene,view,range,-1e9,-1e9);assert.deepEqual(scrollRange(scene,view,range,'fixed'),initial);}
 scene.pan={x:-5000,y:3000};range=scrollRange(scene,view,range,'view');assert.equal(range.maxX,5900);assert.equal(range.minY,-3000);
 for(let i=0;i<100;i++)assert.deepEqual(scrollRange(scene,view,range,'view'),range);
 scene.cards[0].x=-10000;const grown=scrollRange(scene,view,range,'content');assert.equal(grown.minX,-10900);
});
