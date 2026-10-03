const cheerio = require('cheerio');
const normalize = value => value.replace(/\s+/g, ' ').trim();
function parseReports(html) {
  const $ = cheerio.load(html);
  const reports = new Map();
  $('table.tbList tbody tr').each((_, row) => {
    const cells = $(row).children('td');
    const anchor = cells.eq(2).find('a[href*="/dsaf001/main.do?"]').first();
    if (!anchor.length || cells.length < 5) return;
    let url;
    try { url = new URL(anchor.attr('href'), 'https://dart.fss.or.kr'); } catch { return; }
    const rcpNo = url.searchParams.get('rcpNo');
    if (url.hostname !== 'dart.fss.or.kr' || url.pathname !== '/dsaf001/main.do' || !/^\d{14}$/.test(rcpNo || '')) return;
    const company = cells.eq(1).find('a[href*="openCorpInfo"]').first();
    const report = {
      rcpNo,
      url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}`,
      reportName: normalize(anchor.text()).replace(/\]\s+/g, ']'),
      companyName: normalize(company.text()),
      receivedDate: normalize(cells.eq(4).text())
    };
    if (report.reportName && report.companyName && /^\d{4}\.\d{2}\.\d{2}$/.test(report.receivedDate)) reports.set(rcpNo, report);
  });
  return [...reports.values()];
}
function mergeReports(existing, incoming) {
  const map = new Map(existing.map(report => [report.rcpNo, report]));
  incoming.forEach(report => map.set(report.rcpNo, report));
  return [...map.values()];
}
module.exports = { parseReports, mergeReports };
