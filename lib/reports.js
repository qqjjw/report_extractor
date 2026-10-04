const cheerio = require('cheerio');

// ===== 입력값: DART의 실제 검색 응답 HTML과 비교하여 수정 =====
// 표 클래스·행 구조가 바뀌면 이 선택자를 확인합니다. 열 번호는 0부터 시작합니다.
const TABLE_SELECTOR = 'table.tbList';
const ROW_SELECTOR = 'tbody tr';
const CELL_SELECTOR = 'td';
const COLUMNS = { company: 1, report: 2, receivedDate: 4 };
const REPORT_LINK_SELECTOR = 'a[href*="/dsaf001/main.do?"]';
const COMPANY_LINK_SELECTOR = 'a[href*="openCorpInfo"]';
// 뷰어 주소가 바뀌면 링크 선택자와 lib/store.js의 기존 저장 URL 호환성도 확인합니다.
const REPORT_BASE_URL = 'https://dart.fss.or.kr';
const REPORT_PATH = '/dsaf001/main.do';
const RECEIPT_QUERY = 'rcpNo';
const RECEIPT_PATTERN = /^\d{14}$/;
const DATE_PATTERN = /^\d{4}\.\d{2}\.\d{2}$/;

// ===== 처리 로직: HTML→JSON 전환, 링크 속성 변경 등은 이 아래를 수정 =====
const normalize = value => value.replace(/\s+/g, ' ').trim();
function hasReportTable(html) {
  return cheerio.load(html)(TABLE_SELECTOR).length > 0;
}
function buildReportUrl(rcpNo) {
  return `${REPORT_BASE_URL}${REPORT_PATH}?${RECEIPT_QUERY}=${encodeURIComponent(rcpNo)}`;
}
function parseReports(html) {
  const $ = cheerio.load(html);
  const reports = new Map();
  $(TABLE_SELECTOR).find(ROW_SELECTOR).each((_, row) => {
    const cells = $(row).children(CELL_SELECTOR);
    const anchor = cells.eq(COLUMNS.report).find(REPORT_LINK_SELECTOR).first();
    if (!anchor.length || cells.length <= Math.max(...Object.values(COLUMNS))) return;
    let url;
    try { url = new URL(anchor.attr('href'), REPORT_BASE_URL); } catch { return; }
    const rcpNo = url.searchParams.get(RECEIPT_QUERY);
    if (url.hostname !== new URL(REPORT_BASE_URL).hostname || url.pathname !== REPORT_PATH || !RECEIPT_PATTERN.test(rcpNo || '')) return;
    const company = cells.eq(COLUMNS.company).find(COMPANY_LINK_SELECTOR).first();
    const report = {
      rcpNo,
      url: buildReportUrl(rcpNo),
      reportName: normalize(anchor.text()).replace(/\]\s+/g, ']'),
      companyName: normalize(company.text()),
      receivedDate: normalize(cells.eq(COLUMNS.receivedDate).text())
    };
    if (report.reportName && report.companyName && DATE_PATTERN.test(report.receivedDate)) reports.set(rcpNo, report);
  });
  return [...reports.values()];
}
// 접수번호 대신 다른 식별자를 사용하게 되면 저장 형식과 중복 판정도 확인합니다.
function mergeReports(existing, incoming) {
  const map = new Map(existing.map(report => [report.rcpNo, report]));
  incoming.forEach(report => map.set(report.rcpNo, report));
  return [...map.values()];
}
module.exports = { parseReports, mergeReports, hasReportTable, buildReportUrl };
