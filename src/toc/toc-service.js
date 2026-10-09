(function (root) {
  const model = typeof module !== 'undefined' ? require('./toc-model') : root.TocModel;
  class TocSession {
    constructor(report, read, onChange, isCurrent, options = {}) {
      this.toc = model.create(report);
      this.read = read; this.onChange = onChange; this.isCurrent = isCurrent;
      this.timeout = options.timeout ?? 10000; this.interval = options.interval ?? 500;
      this.sequence = 0; this.cancelled = false; this.controller = null;
    }
    invalidate() {
      this.sequence++; this.controller?.abort(); this.controller = null;
    }
    dispose() { this.cancelled = true; this.invalidate(); }
    reset(error = null) {
      if (this.cancelled || !this.isCurrent()) return;
      this.invalidate(); this.toc.status = error ? 'error' : 'loading';
      this.toc.error = error; this.toc.nodes = []; this.toc.extractedAt = null; this.onChange(this.toc);
    }
    async run() {
      if (this.cancelled || !this.isCurrent()) return;
      this.invalidate();
      const sequence = this.sequence, controller = new AbortController();
      this.controller = controller;
      const active = () => !this.cancelled && sequence === this.sequence && this.isCurrent();
      this.toc.status = 'loading'; this.toc.error = null; this.toc.nodes = []; this.toc.extractedAt = null;
      this.onChange(this.toc);
      const deadline = Date.now() + this.timeout;
      let error = '목차 추출 시간이 초과되었습니다.';
      while (active() && Date.now() < deadline) {
        let timer, abort;
        try {
          const remaining = deadline - Date.now();
          const result = await Promise.race([
            Promise.resolve().then(() => this.read()),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('목차 추출 시간이 초과되었습니다.')), remaining);
              abort = () => reject(new Error('취소됨'));
              controller.signal.addEventListener('abort', abort, { once: true });
            })
          ]);
          if (!active()) return;
          if (result?.state === 'error') throw new Error(result.error);
          if (result?.state === 'ready' || result?.state === 'empty') {
            if (result.reportId !== this.toc.report.rcpNo) throw new Error('현재 페이지의 접수번호가 보고서와 다릅니다.');
            const nodes = model.normalize(this.toc.report.rcpNo, result.nodes);
            if ((result.state === 'ready') !== (nodes.length > 0)) throw new Error('목차 추출 결과가 올바르지 않습니다.');
            this.toc.nodes = nodes; this.toc.status = nodes.length ? 'ready' : 'empty';
            this.toc.extractedAt = new Date().toISOString(); this.toc.error = null;
            this.onChange(this.toc); return;
          }
          error = result?.error || error;
        } catch (e) { error = e.message; }
        finally { clearTimeout(timer); if (abort) controller.signal.removeEventListener('abort', abort); }
        if (!active()) return;
        await new Promise(resolve => {
          const done = () => { clearTimeout(wait); controller.signal.removeEventListener('abort', done); resolve(); };
          const wait = setTimeout(done, Math.min(this.interval, Math.max(0, deadline - Date.now())));
          controller.signal.addEventListener('abort', done, { once: true });
        });
      }
      if (active()) { this.toc.status = 'error'; this.toc.error = error; this.onChange(this.toc); }
    }
  }
  if (typeof module !== 'undefined') module.exports = TocSession; else root.TocSession = TocSession;
})(globalThis);
