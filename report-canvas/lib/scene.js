const fs = require('node:fs/promises');
// ===== 입력값: 카드 크기·가로 간격·배율·보고서명 기간 형식 =====
const DEFAULT_SIZE = { width: 1000, height: 800 };
const MIN_SIZE = { width: 480, height: 360 };
const GAP = 24;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const PERIOD_PATTERN = /\((\d{4})\.(0[1-9]|1[0-2])\)/;
const ALLOWED_HOST = 'dart.fss.or.kr';

// ===== 처리 로직: 원본 JSON은 읽기만 합니다 =====
function validateReports(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.reports)) throw new Error('version: 1과 reports 배열이 필요합니다.');
  const seen = new Set();
  return data.reports.filter((report, index) => {
    if (!report || !/^\d{14}$/.test(report.rcpNo) || !['url', 'reportName', 'companyName', 'receivedDate'].every(key => typeof report[key] === 'string')) throw new Error(`${index + 1}번째 보고서의 형식이 잘못되었습니다.`);
    let url;
    try { url = new URL(report.url); } catch { throw new Error(`${index + 1}번째 보고서 URL이 잘못되었습니다.`); }
    if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST || url.username || url.password || url.port) throw new Error(`${index + 1}번째 보고서는 DART HTTPS 주소여야 합니다.`);
    if (seen.has(report.rcpNo)) return false;
    seen.add(report.rcpNo); return true;
  }).map(report => ({ rcpNo: report.rcpNo, url: report.url, reportName: report.reportName, companyName: report.companyName, receivedDate: report.receivedDate }));
}
async function readReports(file) {
  try { return validateReports(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch (error) { throw new Error(error.code === 'ENOENT' ? `보고서 파일이 없습니다: ${file}` : `보고서 파일을 읽지 못했습니다: ${error.message}`); }
}
function createScene(reports) {
  const scene = { cards: reports.map((report, sourceIndex) => ({ ...report, sourceIndex, x: 0, y: 0, ...DEFAULT_SIZE, status: '대기 중', error: '' })), pan: { x: GAP, y: GAP }, zoom: 1 };
  arrange(scene); return scene;
}
function period(report) {
  const match = report.reportName.match(PERIOD_PATTERN);
  return match ? Number(match[1]) * 12 + Number(match[2]) : null;
}
function arrange(scene, direction) {
  if (direction === 'asc' || direction === 'desc') scene.cards.sort((a, b) => {
    const first = period(a), second = period(b);
    if (first === null || second === null) return first === second ? a.sourceIndex - b.sourceIndex : first === null ? 1 : -1;
    return (direction === 'asc' ? first - second : second - first) || a.sourceIndex - b.sourceIndex;
  });
  let x = 0;
  scene.cards.forEach(card => { card.x = x; card.y = 0; x += card.width + GAP; });
  scene.pan = { x: GAP, y: GAP };
}
function resize(card, width, height) {
  card.width = Math.max(MIN_SIZE.width, Math.round(width));
  card.height = Math.max(MIN_SIZE.height, Math.round(height));
}
function applySize(scene, card) { scene.cards.forEach(other => resize(other, card.width, card.height)); }
function zoomTo(scene, value) { scene.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100)); }
module.exports = { readReports, validateReports, createScene, arrange, resize, applySize, zoomTo, period };
