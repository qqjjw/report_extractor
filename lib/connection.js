// ===== 입력값: 접속 주소와 재시도 정책 =====
const HOME = 'https://dart.fss.or.kr/';
const SEARCH = 'https://dart.fss.or.kr/dsab007/main.do';
const MAX_ATTEMPTS = 3; // 첫 접속 1회 + 재시도 2회. 마지막 시도는 검색 화면입니다.
const RETRY_INTERVAL_MS = 800; // 재시도 대기는 800ms, 1600ms로 증가합니다.
const TRANSIENT_ERROR_CODES = [-324, -101, -100, -118];
const TRANSIENT_ERROR_PATTERN = /ERR_(EMPTY_RESPONSE|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_TIMED_OUT)/;

// ===== 처리 로직: 인증·접속 절차가 달라지면 이 부분도 확인 =====
// 인증서 오류는 재시도 대상이 아니며 검증을 우회하지 않습니다.
const transient = error => TRANSIENT_ERROR_CODES.includes(error.errno) || TRANSIENT_ERROR_PATTERN.test(error.message);
async function connectDart(contents, onProgress, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (contents.isDestroyed()) return false;
    onProgress(attempt === 0 ? 'DART에 연결 중…' : `DART 연결 재시도 중… (${attempt}/${MAX_ATTEMPTS - 1})`);
    try {
      await contents.loadURL(attempt === MAX_ATTEMPTS - 1 ? SEARCH : HOME);
      return true;
    } catch (error) {
      lastError = error;
      if (contents.isDestroyed() || error.errno === -3) return false;
      if (!transient(error)) throw error;
      if (attempt < MAX_ATTEMPTS - 1) {
        await pause((attempt + 1) * RETRY_INTERVAL_MS);
        await contents.session.closeAllConnections();
      }
    }
  }
  throw lastError;
}
module.exports = { connectDart };
