const HOME = 'https://dart.fss.or.kr/';
const SEARCH = 'https://dart.fss.or.kr/dsab007/main.do';
const transient = error => [-324, -101, -100, -118].includes(error.errno) || /ERR_(EMPTY_RESPONSE|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_TIMED_OUT)/.test(error.message);
async function connectDart(contents, onProgress, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (contents.isDestroyed()) return false;
    onProgress(attempt === 0 ? 'DART에 연결 중…' : `DART 연결 재시도 중… (${attempt}/2)`);
    try {
      await contents.loadURL(attempt === 2 ? SEARCH : HOME);
      return true;
    } catch (error) {
      lastError = error;
      if (contents.isDestroyed() || error.errno === -3) return false;
      if (!transient(error)) throw error;
      if (attempt < 2) {
        await pause((attempt + 1) * 800);
        await contents.session.closeAllConnections();
      }
    }
  }
  throw lastError;
}
module.exports = { connectDart };
