class Capture {
  constructor(debuggerApi, onReports, onError, parse) {
    this.api = debuggerApi; this.onReports = onReports; this.onError = onError; this.parse = parse;
    this.enabled = false; this.generation = 0; this.pending = new Map();
  }
  setEnabled(value) { this.enabled = value; this.generation++; this.pending.clear(); }
  reset() { this.generation++; this.pending.clear(); }
  async message(method, params) {
    if (method === 'Network.requestWillBeSent') {
      this.pending.delete(params.requestId);
      let url;
      try { url = new URL(params.request.url); } catch { return; }
      if (this.enabled && url.hostname === 'dart.fss.or.kr' && url.pathname === '/dsab007/detailSearch.ax') {
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
    if (method !== 'Network.loadingFinished') return;
    this.pending.delete(params.requestId);
    try {
      if (entry.status === null || entry.status < 200 || entry.status >= 300) throw new Error('검색 응답 상태가 올바르지 않습니다.');
      const result = await this.api.sendCommand('Network.getResponseBody', { requestId: params.requestId });
      if (!this.enabled || entry.generation !== this.generation) return;
      const html = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
      if (!/class\s*=\s*["'][^"']*\btbList\b/i.test(html)) throw new Error('검색 결과 표를 찾지 못했습니다.');
      this.onReports(this.parse(html));
    } catch (error) {
      if (this.enabled && entry.generation === this.generation) this.onError(`응답 수집 실패: ${error.message}`);
    }
  }
}
module.exports = { Capture };
