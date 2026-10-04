const { hasReportTable } = require('./reports');

// ===== 입력값: 검색 버튼을 누를 때 발생하는 실제 요청 주소와 비교 =====
const TARGET_HOST = 'dart.fss.or.kr';
const TARGET_PATH = '/dsab007/detailSearch.ax';

// ===== 처리 로직: 요청 발생 화면은 main.js, HTML 규칙은 reports.js 확인 =====
class Capture {
  constructor(debuggerApi, onReports, onError, parse) {
    this.api = debuggerApi; this.onReports = onReports; this.onError = onError; this.parse = parse;
    this.enabled = false; this.generation = 0; this.pending = new Map();
  }
  setEnabled(value) { this.enabled = value; this.generation++; this.pending.clear(); }
  reset() { this.generation++; this.pending.clear(); }
  async message(method, params) {
    // 1. ON 상태에서 시작한 대상 요청만 추적합니다. 쿼리 문자열은 비교하지 않습니다.
    if (method === 'Network.requestWillBeSent') {
      this.pending.delete(params.requestId);
      let url;
      try { url = new URL(params.request.url); } catch { return; }
      if (this.enabled && url.hostname === TARGET_HOST && url.pathname === TARGET_PATH) {
        this.pending.set(params.requestId, { generation: this.generation, status: null });
      }
      return;
    }
    const entry = this.pending.get(params.requestId);
    if (!entry) return;
    if (method === 'Network.responseReceived') { entry.status = params.response.status; return; }
    if (method === 'Network.loadingFailed') {
      this.pending.delete(params.requestId); this.onError('검색 응답을 받지 못했습니다. 다시 검색하세요.'); return;
    }
    // 2. 수신 완료 후 본문을 읽습니다. Electron/CDP 변경 시 이 이벤트와 명령을 확인합니다.
    if (method !== 'Network.loadingFinished') return;
    this.pending.delete(params.requestId);
    try {
      if (entry.status === null || entry.status < 200 || entry.status >= 300) throw new Error('검색 응답 상태가 올바르지 않습니다.');
      const result = await this.api.sendCommand('Network.getResponseBody', { requestId: params.requestId });
      if (!this.enabled || entry.generation !== this.generation) return;
      const html = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
      // 3. 표 확인과 파싱이 reports.js의 같은 선택자를 사용합니다.
      // 응답이 JSON으로 바뀌면 본문 해석과 파싱 호출을 함께 수정해야 합니다.
      if (!hasReportTable(html)) throw new Error('검색 결과 표를 찾지 못했습니다.');
      this.onReports(this.parse(html));
    } catch (error) {
      if (this.enabled && entry.generation === this.generation) this.onError(`응답 수집 실패: ${error.message}`);
    }
  }
}
module.exports = { Capture };
