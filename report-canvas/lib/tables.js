const toc = require('./toc');
// ===== 입력값: 본문 주소·선택 갱신 간격·표와 제목 읽기 한도 =====
const BODY_HOST = 'dart.fss.or.kr', BODY_PATH = '/report/viewer.do';
const BODY_FRAME_SELECTOR = '#ifrm';
const PICK_INTERVAL_MS = 250;
const LIMITS = { text: 200000, cells: 120, heading: 120, keywords: 20, keywordLength: 200 };
const SELECTORS = { tables: 'table', cells: 'th,td', headings: 'p,h1,h2,h3,h4,h5,h6' };
// 목차 이동 직후 DART의 레이아웃·초기 스크롤 처리가 끝날 때까지 짧게 재확인합니다.
// 후보 표시 때만 실행하며 상시 감시하지 않습니다.
const SHOW_DELAYS_MS = [0, 150, 350, 700];
function compact(value) { return toc.normalize(value).replace(/\s+/g, ''); }
function terms(value) { return [...new Set(String(value || '').split(/\n|,/).map(s => s.trim()).filter(Boolean))]; }
function validateOptions(reference, section, keywords) {
  const required = terms(keywords);
  if (!required.length) throw new Error('기준 표에서 필수 검색 문구를 선택하거나 입력하세요.');
  if (required.length > LIMITS.keywords || required.some(s => s.length > LIMITS.keywordLength)) throw new Error(`검색 문구는 ${LIMITS.keywords}개 이하, 각 ${LIMITS.keywordLength}자 이하로 지정하세요.`);
  const text = reference.text.replace(/\s+/g, '').toLowerCase();
  if (required.some(s => !text.includes(s.replace(/\s+/g, '').toLowerCase()))) throw new Error('필수 검색 문구는 기준 표에 포함된 문구만 사용할 수 있습니다.');
  return { section: String(section || '').trim().slice(0, 120), keywords: required };
}
// 정확한 목차 제목을 아래에서 위로 찾습니다. 공통 단어만으로 다른 주석을 열지 않습니다.
function route(reference, nodes) {
  for (const title of [...reference.node.path].reverse()) {
    const matches = nodes.filter(n => compact(n.title) === compact(title));
    if (!matches.length) continue;
    const ancestors = reference.node.path.map(compact);
    const ranked = matches.map(n => ({ node: n, score: n.path.slice(0, -1).map(compact).filter(s => ancestors.includes(s)).length })).sort((a, b) => b.score - a.score);
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) throw new Error('같은 이름의 목차가 여러 개입니다. 대상에서 올바른 구간을 직접 연 뒤 현재 구간 검색을 사용하세요.');
    return ranked[0].node;
  }
  throw new Error('대응하는 목차를 찾지 못했습니다. 대상에서 구간을 직접 열어 현재 구간 검색을 사용하세요.');
}
// DOM 함수는 DART 본문 안에서만 실행됩니다. Node 기능이나 IPC를 노출하지 않습니다.
function dom(action, args, limits, selectors) {
  const KEY = '__dartCanvasTableSearch';
  // 연결/별도 구분은 먼저 목차 경로에서 결정합니다. 구간 제목 끝의 표기 차이만 허용합니다.
  const norm = s => String(s || '').replace(/\s*\((?:연결|별도)\)\s*$/, '').replace(/^\s*(?:[IVXLCDM]+|\d+(?:-\d+)*|[가-힣])\s*[.．、)\]]\s*/i, '').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, '').toLowerCase();
  const textOf = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16) + ':' + s.length; };
  const allTables = () => [...document.querySelectorAll(selectors.tables)].filter(t => !t.querySelector(selectors.tables));
  const headings = () => [...document.querySelectorAll(selectors.headings)].filter(e => {
    const text = textOf(e);
    if (!text || text.length > limits.heading || e.closest(selectors.tables)) return false;
    return /^h[1-6]$/i.test(e.tagName) || /^\s*(?:\d+(?:-\d+)*\.|[IVXLCDM]+\.)\s*\S/.test(text) || parseInt(getComputedStyle(e).fontWeight) >= 600 || !!e.querySelector('b,strong');
  });
  const level = e => { const s = textOf(e); if (/^h[1-6]$/i.test(e.tagName)) return Number(e.tagName[1]); if (/^[IVXLCDM]+\./i.test(s)) return 0; if (/^\d+\./.test(s)) return 1; if (/^\d+-\d+\./.test(s)) return 2; return 3; };
  const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  let state = window[KEY];
  if(!state&&action==='find'&&args.quiet)state={mode:false};
  if (!state) {
    state = window[KEY] = { picked: null, mode: false };
    const style = document.createElement('style');
    style.textContent = '.dart-canvas-candidate{outline:3px solid #2684cf!important;outline-offset:2px!important}.dart-canvas-reference{outline:3px solid #9333ea!important;outline-offset:2px!important}.dart-canvas-hover{outline:2px dashed #9333ea!important;cursor:crosshair!important}';
    (document.head || document.documentElement).append(style);
    state.style = style;
    state.over = e => { if (!state.mode) return; const table = e.target.closest?.(selectors.tables); document.querySelectorAll('.dart-canvas-hover').forEach(t => t.classList.remove('dart-canvas-hover')); if (table && !table.querySelector(selectors.tables)) table.classList.add('dart-canvas-hover'); };
    state.click = e => {
      if (!state.mode) return;
      const table = e.target.closest?.(selectors.tables); if (!table || table.querySelector(selectors.tables)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const text = textOf(table); if (text.length > limits.text) { state.picked = { error: '선택한 표가 너무 큽니다. 더 작은 표를 선택하세요.' }; return; }
      const previous = headings().filter(h => before(h, table)).at(-1);
      const cells = [...new Set([...table.querySelectorAll(selectors.cells)].map(textOf).filter(s => s.length >= 2 && s.length <= 100 && /[\p{L}]/u.test(s)))].slice(0, limits.cells);
      state.picked = { index: allTables().indexOf(table), fingerprint: hash(text), text, cells, suggestedSection: previous ? textOf(previous) : '' };
      state.mode = false;
      document.querySelectorAll('.dart-canvas-hover,.dart-canvas-reference').forEach(t => t.classList.remove('dart-canvas-hover','dart-canvas-reference'));
      table.classList.add('dart-canvas-reference');
    };
    document.addEventListener('pointerover', state.over, true); document.addEventListener('click', state.click, true);
  }
  const clear = () => document.querySelectorAll('.dart-canvas-candidate,.dart-canvas-reference,.dart-canvas-hover').forEach(t => t.classList.remove('dart-canvas-candidate','dart-canvas-reference','dart-canvas-hover'));
  if (action === 'start') { clear(); state.mode = true; state.picked = null; return true; }
  if (action === 'poll') { const result = state.picked; state.picked = null; return result; }
  if (action === 'stop') { state.mode = false; document.querySelectorAll('.dart-canvas-hover').forEach(t => t.classList.remove('dart-canvas-hover')); return true; }
  if (action === 'clear') { clear(); state.mode = false; return true; }
  if (action === 'find') {
    clear(); state.mode = false;
    let ranges = null;
    if (args.section && !args.broad) {
      const hs = headings(), starts = hs.filter(h => norm(textOf(h)) === norm(args.section));
      if (starts.length > 1) throw new Error('세부 구간 제목이 반복됩니다. 구간명을 수정하거나 현재 구간 전체 검색을 명시적으로 선택하세요.');
      if (starts.length === 1) {
        const start = starts[0], next = hs.find(h => before(start,h) && level(h) <= level(start));
        if (!next && !args.sectionIsDocument) throw new Error('세부 구간의 끝을 확인하지 못했습니다. 현재 구간 전체 검색 여부를 직접 결정하세요.');
        ranges = { start, next };
      } else if (!args.sectionIsDocument) throw new Error('세부 구간 제목을 찾지 못했습니다. 구간명을 수정하거나 현재 구간 전체 검색을 선택하세요.');
    }
    const keywords = args.keywords.map(s => s.replace(/\s+/g, '').toLowerCase());
    const candidates = allTables().map((table,index) => ({ table,index })).filter(({table}) => !ranges || (before(ranges.start,table) && (!ranges.next || before(table,ranges.next)))).filter(({table}) => { const s=textOf(table).replace(/\s+/g,'').toLowerCase(); return keywords.every(k=>s.includes(k)); }).map(({table,index}) => ({ index,fingerprint:hash(textOf(table)),preview:textOf(table).slice(0,180) }));
    return candidates;
  }
  if (action === 'show' || action === 'verify') {
    const table = allTables()[args.index];
    if (!table || hash(textOf(table)) !== args.fingerprint) throw new Error('본문 표가 변경되었습니다. 다시 검색하세요.');
    if (action === 'show') {
      clear(); state.mode=false; table.classList.add(args.reference?'dart-canvas-reference':'dart-canvas-candidate');
      // 본문 문서만 이동합니다. scrollIntoView의 상위 iframe·목차 이동은 피합니다.
      const scrolling = document.scrollingElement;
      if (!scrolling) throw new Error('본문 스크롤 영역을 찾지 못했습니다.');
      const top = Math.max(0, table.getBoundingClientRect().top + scrolling.scrollTop - 6);
      scrolling.scrollTo({ top, left: scrolling.scrollLeft, behavior: 'instant' });
    }
    return true;
  }
  throw new Error('지원하지 않는 표 작업입니다.');
}
async function bodyFrame(contents) {
  const src = await toc.execute(contents.mainFrame, 'document.querySelector('+JSON.stringify(BODY_FRAME_SELECTOR)+')?.src');
  const frames = contents.mainFrame.framesInSubtree.filter(f => { try { const u = new URL(f.url); return u.hostname === BODY_HOST && u.pathname === BODY_PATH && f.url === src; } catch { return false; } });
  if (frames.length !== 1 || !await toc.execute(frames[0], "document.readyState==='complete'")) throw new Error('본문 프레임이 아직 준비되지 않았습니다.');
  return frames[0];
}
async function run(frame, action, args = {}) {
  const code = '(' + dom.toString() + ')(' + JSON.stringify(action) + ',' + JSON.stringify(args) + ',' + JSON.stringify(LIMITS) + ',' + JSON.stringify(SELECTORS) + ')';
  // 화면 밖의 본문 타이머는 Chromium이 늦출 수 있으므로 재확인 간격은 메인에서 관리합니다.
  for (const delay of action === 'show' ? SHOW_DELAYS_MS : [0]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (frame.isDestroyed?.()) throw new Error('본문이 변경되었습니다. 다시 검색하세요.');
    const result = await toc.execute(frame, code);
    if (action !== 'show') return result;
  }
  return true;
}
module.exports = { compact, terms, validateOptions, route, bodyFrame, run, PICK_INTERVAL_MS };
