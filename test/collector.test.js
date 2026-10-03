const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { parseReports, mergeReports } = require('../lib/reports');
const { ReportStore } = require('../lib/store');
const { Capture } = require('../lib/capture');
const examples = [
  ['20260323000924','2025.12','2026.03.23',false],
  ['20250321001734','2024.12','2025.03.21',false],
  ['20240329002735','2023.12','2024.03.29',true],
  ['20230321000862','2022.12','2023.03.21',false],
  ['20220816001433','2021.12','2022.08.16',true],
  ['20210323000600','2020.12','2021.03.23',false],
  ['20200330002548','2019.12','2020.03.30',false],
  ['20190814001347','2018.12','2019.08.14',true],
  ['20180402004139','2017.12','2018.04.02',false],
  ['20170331004238','2016.12','2017.03.31',false]
];
function html(rows = examples) {
  return `<table class="tbList"><tbody>${rows.map(([id,year,date,corrected],i) => `<tr><td>${i+1}</td><td><span>유</span><a href="javascript:openCorpInfoNew('00170558')"> 코웨이 </a><a href="https://cowayir.co.kr">IR</a></td><td><a href="/dsaf001/main.do?rcpNo=${id}">${corrected?'<span>[기재정정]</span>':''}사업보고서 \n (${year})</a><img alt="XBRL"></td><td>코웨이</td><td>${date}</td><td>연</td></tr>`).join('')}</tbody></table>`;
}
test('Coway example: all ten records and exact metadata', () => {
  const reports = parseReports(html());
  assert.equal(reports.length, 10);
  examples.forEach(([rcpNo, year, receivedDate, corrected], index) => assert.deepEqual(reports[index], {
    rcpNo, url:`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}`,
    reportName:`${corrected?'[기재정정]':''}사업보고서 (${year})`, companyName:'코웨이', receivedDate
  }));
  assert.deepEqual(parseReports(html([])), []);
});
test('accumulate pages, update duplicate and collect deleted report again', () => {
  const first = parseReports(html(examples.slice(0,5)));
  const second = parseReports(html(examples.slice(4)));
  let result = mergeReports(first, second);
  assert.equal(result.length, 10);
  result = mergeReports(result, [{...first[0], reportName:'수정 이름'}]);
  assert.equal(result[0].reportName, '수정 이름');
  result = result.filter(r => r.rcpNo !== first[0].rcpNo);
  assert.equal(mergeReports(result, first).length, 10);
});
test('serialized save, restore, empty state and corrupt-file preservation', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'dart-test-'));
  t.after(() => fs.rm(directory,{recursive:true,force:true}));
  const file = path.join(directory,'data','reports.json');
  const store = new ReportStore(file);
  assert.deepEqual(await store.load(), []);
  const reports = parseReports(html());
  await Promise.all([store.save(reports), store.save(reports.slice(0,3))]);
  assert.deepEqual(await new ReportStore(file).load(), reports.slice(0,3));
  await store.save([]);
  assert.deepEqual(await new ReportStore(file).load(), []);
  await fs.writeFile(file,'broken json');
  const broken = new ReportStore(file);
  await assert.rejects(broken.load());
  await assert.rejects(broken.save(reports));
  assert.equal(await fs.readFile(file,'utf8'),'broken json');
});
test('write failures are reported and a later save can recover', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'dart-test-'));
  t.after(() => fs.rm(directory,{recursive:true,force:true}));
  const parent = path.join(directory,'blocked');
  await fs.writeFile(parent,'not a directory');
  const store = new ReportStore(path.join(parent,'reports.json'));
  await assert.rejects(store.save([]));
  await fs.unlink(parent);
  await store.save([]);
  assert.deepEqual(await store.load(), []);
});
test('capture toggle, request start, cancelled generation, empty and failed response', async () => {
  let resolveBody, calls = 0;
  const batches=[], errors=[];
  const api = { sendCommand: async () => { calls++; return { body:html() }; } };
  const capture = new Capture(api, r => batches.push(r), e => errors.push(e), parseReports);
  const request = id => capture.message('Network.requestWillBeSent',{requestId:id,request:{url:'https://dart.fss.or.kr/dsab007/detailSearch.ax?x=1'}});
  const response = id => capture.message('Network.responseReceived',{requestId:id,response:{status:200}});
  const finish = id => capture.message('Network.loadingFinished',{requestId:id});
  await request('off'); capture.setEnabled(true); await response('off'); await finish('off');
  assert.equal(calls,0);
  await request('ok'); await response('ok'); await finish('ok'); assert.equal(batches[0].length,10);
  api.sendCommand = () => new Promise(resolve => { resolveBody=resolve; });
  await request('pending'); await response('pending'); const pending=finish('pending');
  capture.setEnabled(false); capture.setEnabled(true); resolveBody({body:html()}); await pending;
  assert.equal(batches.length,1);
  api.sendCommand=async()=>({body:html([])});
  await request('empty'); await response('empty'); await finish('empty'); assert.deepEqual(batches[1],[]);
  api.sendCommand=async()=>{throw new Error('missing body');};
  await request('fail'); await response('fail'); await finish('fail');
  assert.equal(errors.length,1); assert.equal(batches.length,2);
  api.sendCommand=async()=>({body:'access denied'});
  await request('invalid'); await response('invalid'); await finish('invalid'); assert.equal(errors.length,2);
});
