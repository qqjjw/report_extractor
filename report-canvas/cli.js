// Node 실행 진입점: Electron의 진단 출력과 JSON 응답을 서로 다른 파이프로 분리합니다.
const {spawn}=require('node:child_process'),path=require('node:path'),net=require('node:net'),os=require('node:os'),crypto=require('node:crypto');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
// Windows GUI 실행 파일의 stdin 제약을 피하는 내부 named pipe입니다. 외부 인터페이스는 JSONL stdio입니다.
const address=process.platform==='win32'?'\\\\.\\pipe\\dart-cli-'+crypto.randomUUID():path.join(os.tmpdir(),'dart-cli-'+crypto.randomUUID()+'.sock');
let child,socket;
const server=net.createServer(connection=>{socket=connection;server.close();connection.on('error',()=>{});process.stdin.pipe(connection);connection.pipe(process.stdout);});
server.listen(address,()=>{
 child=spawn(require('electron'),[path.join(__dirname,'cli-worker.js'),address],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(process.stderr);child.stderr.pipe(process.stderr);
 child.on('error',e=>{process.stderr.write(e.message+'\n');server.close();process.exitCode=1;});
 child.on('exit',code=>{server.close();if(socket){process.stdin.unpipe(socket);socket.destroy();}process.stdin.pause();process.exitCode=code??1;});
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(socket)socket.end();else child?.kill();});
