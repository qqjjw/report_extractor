const $ = id => document.getElementById(id);
function render(state) {
  $('reconnect').disabled = state.connecting;
  $('reconnect').textContent = state.connecting ? 'DART 연결 중…' : 'DART 다시 연결';
  $('toggle').textContent = `보고서 추출 ${state.enabled ? 'ON' : 'OFF'}`;
  $('toggle').classList.toggle('active', state.enabled);
  $('toggle').setAttribute('aria-pressed', String(state.enabled));
  $('count').textContent = state.reports.length;
  $('notice').textContent = state.notice;
  $('error').textContent = state.error; $('error').hidden = !state.error;
  $('file').textContent = state.file;
  $('list').replaceChildren();
  if (!state.reports.length) {
    const empty = document.createElement('p'); empty.className = 'empty';
    empty.textContent = '아직 수집된 보고서가 없습니다. 보고서 추출을 켜고 DART에서 검색하세요.'; $('list').append(empty);
  }
  state.reports.forEach(report => {
    const card = document.createElement('article'); card.className = 'report';
    const meta = document.createElement('div'); meta.className = 'meta';
    const company = document.createElement('span'); company.textContent = report.companyName;
    const date = document.createElement('span'); date.textContent = report.receivedDate; meta.append(company, date);
    const title = document.createElement('p'); title.className = 'title'; title.textContent = report.reportName;
    const actions = document.createElement('div'); actions.className = 'actions';
    const link = document.createElement('button'); link.className = 'link'; link.textContent = '보고서 링크 열기'; link.title = report.url;
    link.onclick = () => window.collector.open(report.rcpNo).catch(showError);
    const remove = document.createElement('button'); remove.className = 'delete'; remove.textContent = '삭제';
    remove.onclick = () => window.collector.remove(report.rcpNo).then(render).catch(showError);
    actions.append(link, remove); card.append(meta, title, actions); $('list').append(card);
  });
}
function showError(error) { $('error').hidden = false; $('error').textContent = error.message; }
$('toggle').onclick = () => window.collector.toggle().then(render).catch(showError);
$('reconnect').onclick = () => window.collector.reconnect().then(render).catch(showError);
$('clear').onclick = () => window.collector.clear().then(render).catch(showError);
window.collector.onState(render);
window.collector.state().then(render).catch(showError);
