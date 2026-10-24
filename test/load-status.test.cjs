const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {attachLoadTracker}=require('../load-status.cjs');
const tick=()=>new Promise(r=>setImmediate(r));
function setup(){
  const wc=new EventEmitter();wc.isLoading=()=>true;wc.isDestroyed=()=>false;wc.probe={ready:false};wc.executeJavaScript=async()=>wc.probe;
  let status;attachLoadTracker(wc,{onChange:s=>status=s});return {wc,get:()=>status};
}
test('iframe network failure is not overwritten as success on did-stop-loading',async()=>{
  const {wc,get}=setup();wc.emit('did-fail-load',{},-106,'ERR_INTERNET_DISCONNECTED','https://dart.fss.or.kr/report/viewer.do',false);
  wc.emit('did-stop-loading');await tick();assert.equal(get().loaded,false);assert.equal(get().error.code,-106);assert.equal(get().error.isMainFrame,false);
});
test('successful iframe retry clears the error only after content is confirmed',async()=>{
  const {wc,get}=setup();wc.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED','url',false);
  wc.emit('did-start-loading');assert.equal(get().loaded,false);assert.equal(get().error.code,-105);
  wc.probe={ready:true};wc.emit('did-frame-finish-load');await tick();assert.equal(get().loaded,true);assert.equal(get().error,null);
});
test('navigation cancellation is not a user-facing error',()=>{
  const {wc,get}=setup();wc.emit('did-start-loading');wc.emit('did-fail-load',{},-3,'ERR_ABORTED','url',false);assert.equal(get().error,null);
});
test('late completion of an old navigation cannot mark a newer navigation loaded',async()=>{
  const {wc,get}=setup();let finish;wc.executeJavaScript=()=>new Promise(r=>finish=r);
  wc.emit('did-stop-loading');wc.emit('did-start-loading');finish({ready:true});await tick();assert.equal(get().loaded,false);
});
