const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
// 원격 본문과 같은 Chromium DOM에서 검사합니다. Windows 앱 대상이며 서버 환경은 건너뜁니다.
test('표 밖 그룹 UI: OFF 편집·중복 이벤트·검증·잠금·원문 보존·제거', {skip:process.platform!=='win32',timeout:20000},async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dart-group-ui-')),script=path.join(directory,'check.cjs');
 const source=`const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),selection=require(${JSON.stringify(path.resolve(__dirname,'../lib/selection.js'))});
 app.whenReady().then(async()=>{try{
 const win=new BrowserWindow({show:false,width:700,height:600});await win.loadURL('data:text/html,'+encodeURIComponent('<body><h2>유형자산</h2><table><tr><th>감가상각비</th><td>(1,200)</td></tr></table></body>'));
 const frame=win.webContents.mainFrame;const described=await selection.run(frame,'describe',{index:0});assert.equal(described.cells,undefined);assert.ok((await selection.run(frame,'read',described)).cells.length);assert.equal(await frame.executeJavaScript('document.querySelector("[data-dart-canvas-groups]")'),null);
 await selection.run(frame,'mode',{on:true});await frame.executeJavaScript('document.querySelector("table").click()');const [descriptor]=await selection.run(frame,'poll');
 const item={...descriptor,id:'one',group:1};await selection.run(frame,'sync',{items:[item],busy:false,revision:1});await selection.run(frame,'mode',{on:false});const before=await selection.run(frame,'read',item);
 const edit=async(value,key='Enter')=>frame.executeJavaScript('('+((value,key)=>{const root=document.querySelector('[data-dart-canvas-groups]').shadowRoot,input=root.querySelector('input');input.value=value;input.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));input.dispatchEvent(new FocusEvent('blur'));return {value:input.value,error:root.querySelector('.error').textContent};}).toString()+')('+JSON.stringify(value)+','+JSON.stringify(key)+')');
 await edit('4');let events=await selection.run(frame,'poll');assert.equal(events.length,1);assert.equal(events[0].kind,'group');assert.equal(events[0].group,4);assert.equal(events[0].revision,1);
 item.group=4;await selection.run(frame,'edit',{items:[item],busy:false,revision:2});assert.equal(await frame.executeJavaScript('document.querySelector("[data-dart-canvas-groups]").shadowRoot.querySelector("input").value'),'4');
 await edit('9','Escape');assert.deepEqual(await selection.run(frame,'poll'),[]);
 for(const value of ['','0','-3','1.5']){const result=await edit(value);assert.equal(result.value,'4');assert.match(result.error,/정수/);}assert.deepEqual(await selection.run(frame,'poll'),[]);
 await frame.executeJavaScript('const i=document.querySelector("[data-dart-canvas-groups]").shadowRoot.querySelector("input");i.value=5;i.dispatchEvent(new FocusEvent("blur"))');assert.equal((await selection.run(frame,'poll'))[0].group,5);
 await selection.run(frame,'edit',{items:[item],busy:true,revision:3});assert.equal(await frame.executeJavaScript('document.querySelector("[data-dart-canvas-groups]").shadowRoot.querySelector("input").disabled'),true);await edit('7');assert.deepEqual(await selection.run(frame,'poll'),[]);
 const after=await selection.run(frame,'read',item);assert.equal(after.fingerprint,before.fingerprint);assert.deepEqual(after.cells,before.cells);assert.equal(await frame.executeJavaScript('document.querySelector("table").querySelector("input")'),null);
 await frame.executeJavaScript('document.querySelector("table").style.marginTop="1000px"');await selection.run(frame,'edit',{items:[item],busy:false,revision:4});assert.equal(await frame.executeJavaScript('getComputedStyle(document.querySelector("[data-dart-canvas-groups]").shadowRoot.querySelector(".group")).display'),'none');
 await selection.run(frame,'sync',{items:[],busy:false,revision:4});assert.equal(await frame.executeJavaScript('document.querySelector("[data-dart-canvas-groups]").shadowRoot.querySelectorAll(".group").length'),0);
 console.log('INLINE_GROUP_UI_PASS');win.destroy();app.quit();}catch(e){console.error(e);app.exit(1);}});`;
 try{await fs.writeFile(script,source);const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const {stdout}=await promisify(execFile)(require('electron'),[script],{timeout:18000,windowsHide:true,env});assert.match(stdout,/INLINE_GROUP_UI_PASS/);}
 finally{await fs.rm(directory,{recursive:true,force:true});}
});
