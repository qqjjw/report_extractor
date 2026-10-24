const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
test('Excel writer saves only the requested file and refuses overwrites',()=>{
  const scratch=path.join(__dirname,'../.local');fs.mkdirSync(scratch,{recursive:true});
  const dir=fs.mkdtempSync(path.join(scratch,'writer-test-')),file=path.join(dir,'synthetic.xlsx');
  const python=process.env.DART_PYTHON||path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python',process.platform==='win32'?'python.exe':'bin/python3');
  const data={cells:[{row:0,col:0,text:'원문',rs:1,cs:2,format:{fill:'#DCDCDC'}},{row:1,col:0,text:'(1,234)',format:{}},{row:1,col:1,text:'=문자열',format:{}}]};
  const run=()=>spawnSync(python,['-B',path.join(__dirname,'../write_excel.py'),file],{input:JSON.stringify(data),encoding:'utf8',windowsHide:true});
  try{
    const first=run();assert.equal(first.status,0,first.stderr||first.stdout);assert.deepEqual(fs.readdirSync(dir),['synthetic.xlsx']);
    const size=fs.statSync(file).size;assert.ok(size>0);
    const second=run();assert.equal(second.status,1);assert.equal(JSON.parse(second.stdout).reason,'file_exists');assert.equal(fs.statSync(file).size,size);
  }finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);}
});
