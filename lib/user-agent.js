// ===== 입력값: 요청에서 제거할 제품명 =====
// 실제 앱 이름이 포함된 요청에서 DART가 ERR_EMPTY_RESPONSE를 반환한 사례가 있습니다.
// 앱 이름을 바꿀 경우 이 목록도 확인합니다. Chromium 버전은 고정하지 않습니다.
const REMOVED_PRODUCTS = ['Electron', 'dart-report-collector'];

// ===== 처리 로직: 실제 플랫폼·Chromium 버전은 유지 =====
function browserUserAgent(userAgent) {
  const names = REMOVED_PRODUCTS.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return userAgent.replace(new RegExp(`\\s(?:${names})/\\S+`, 'gi'), '');
}
module.exports = { browserUserAgent };
