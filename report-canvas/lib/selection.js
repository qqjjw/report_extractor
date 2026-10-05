const toc = require('./toc');
// ===== 입력값: 목록 미리보기 한도·선택 갱신 간격 =====
const PREVIEW_ROWS = 3, PREVIEW_COLUMNS = 4, PREVIEW_LENGTH = 80;
const POLL_MS = 250;
const EDIT_POLL_MS = 500;
// DART 목차 전환 직후 초기 스크롤을 짧게 재확인합니다. 상시 감시는 하지 않습니다.
const SHOW_DELAYS_MS = [0, 150, 350, 700];
function reportYear(report) { return Number(report.reportName.match(/\((\d{4})\.\d{2}\)/)?.[1]) || null; }
class SelectionList {
  constructor() { this.items = []; this.counters = new Map(); this.serial = 0; }
  toggle(report, node, url, descriptor, year) {
    if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new Error('보고서 연도를 먼저 지정하세요.');
    const old = this.items.find(i => i.rcpNo === report.rcpNo && i.bodyUrl === url && i.index === descriptor.index);
    if (old) { this.remove(old.id); return null; }
    const group = (this.counters.get(year) || 0) + 1; this.counters.set(year, group);
    // 전문·셀 데이터는 저장하지 않습니다. DOM 위치와 작은 미리보기만 남깁니다.
    const item = { id: String(++this.serial), order: this.serial, rcpNo: report.rcpNo, companyName: report.companyName, reportName: report.reportName, reportUrl: report.url, year, group, node, bodyUrl: url, index: descriptor.index, fingerprint: descriptor.fingerprint, rowCount: descriptor.rowCount, columnCount: descriptor.columnCount, preview: descriptor.preview, error: '' };
    this.items.push(item); return item;
  }
  remove(id) { this.items = this.items.filter(i => i.id !== id); }
  group(id, value) { const item = this.items.find(i => i.id === id); if (!item) return; const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) throw new Error('그룹은 1 이상의 정수로 지정하세요.'); item.group = n; }
  clear() { this.items = []; this.counters.clear(); this.serial = 0; }
  publicItems() { return this.items.map(({ node, ...item }) => ({ ...item, path: node.path.join(' → ') })); }
}
// 이 함수는 원격 본문에서 실행됩니다. Node/IPC 접근 없이 DOM만 다룹니다.
function page(action, args, limits) {
  const key = '__dartCanvasSelection';
  const text = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const leafTables = () => [...document.querySelectorAll('table')].filter(t => !t.querySelector('table'));
  const grid = table => {
    const occupied = [], cells = [], rows = [...table.rows]; let width = 0;
    rows.forEach((row, r) => {
      occupied[r] ||= new Set(); let c = 0;
      for (const cell of row.cells) {
        while (occupied[r].has(c)) c++;
        const rs = cell.getAttribute('rowspan') === '0' ? rows.length-r : Math.min(cell.rowSpan || 1, rows.length-r), cs = cell.colSpan || 1;
        if (c + cs > 16384 || (r + rs)*(c + cs) > 2000000) throw new Error('표 크기가 Excel 또는 선택 한도를 초과합니다.');
        cells.push({ r, c, rs, cs, text: (cell.innerText ?? cell.textContent ?? '').trim(), header: cell.tagName === 'TH' });
        for (let dr = 0; dr < rs; dr++) { occupied[r+dr] ||= new Set(); for (let dc = 0; dc < cs; dc++) occupied[r+dr].add(c+dc); }
        c += cs; width = Math.max(width, c);
      }
    });
    return { rowCount: rows.length, columnCount: width, cells };
  };
  const describe = (table, full = false) => {
    const data = grid(table); let h = 2166136261, length = 0;
    for (const cell of data.cells) { const s = `${cell.r},${cell.c},${cell.rs},${cell.cs}:${cell.text};`; length += s.length; for (let j=0;j<s.length;j++)h=Math.imul(h^s.charCodeAt(j),16777619); }
    const preview = [...table.rows].slice(0,limits.rows).map(row=>[...row.cells].slice(0,limits.columns).map(c=>text(c).slice(0,limits.length)));
    const result = { index: leafTables().indexOf(table), fingerprint: (h>>>0).toString(16)+':'+length, rowCount: data.rowCount, columnCount: data.columnCount, preview };
    if(full)result.cells=data.cells;return result;
  };
  // CLI·내보내기는 표시나 이벤트 감시를 생성하지 않고 표 데이터만 읽습니다.
  if(action==='describe'||action==='read'){
    const table=leafTables()[args.index];if(!table)throw new Error('선택한 표의 위치가 변경되었습니다. 다시 선택하세요.');
    const result=describe(table,action==='read');
    if(action==='read'&&result.fingerprint!==args.fingerprint)throw new Error('선택한 표가 변경되었습니다. 다시 선택하세요.');
    return result;
  }
  let state = window[key];
  if (!state) {
    state = window[key] = { mode: false, queue: [], editors: new Map(), busy: false, revision: 0 };
    // 원본 표 밖의 Shadow DOM에 표시합니다. 표 텍스트·검색·지문에 편집 UI가 섞이지 않습니다.
    const host=document.createElement('div');host.dataset.dartCanvasGroups='';
    host.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483646';
    document.documentElement.append(host);state.layer=host.attachShadow({mode:'open'});
    const editorStyle=document.createElement('style');editorStyle.textContent=':host{all:initial}.group{position:absolute;display:flex;align-items:center;gap:5px;padding:3px 6px;background:#dcfce7;border:1px solid #16a34a;border-radius:4px;color:#14532d;font:12px "Malgun Gothic",sans-serif;pointer-events:auto;white-space:nowrap;box-sizing:border-box}.group[hidden]{display:none}.group input{box-sizing:border-box;width:66px;font:inherit;padding:2px 4px;color:#14532d;background:white;border:1px solid #86b895;border-radius:3px}.group input:disabled{opacity:.6}.error{font-size:11px;color:#b42318;max-width:180px;white-space:normal}';state.layer.append(editorStyle);
    state.position=()=>{for(const editor of state.editors.values()){
      if(!editor.table.isConnected){editor.label.hidden=true;continue;}
      const rect=editor.table.getBoundingClientRect();editor.label.hidden=rect.bottom<0||rect.top>innerHeight||rect.right<0||rect.left>innerWidth;
      editor.label.style.left=Math.max(0,Math.min(rect.left-3,innerWidth-editor.label.offsetWidth))+'px';
      editor.label.style.top=Math.max(0,rect.top-editor.label.offsetHeight-5)+'px';
    }};
    let pending=false;const position=()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;state.position();});};
    window.addEventListener('scroll',position,{passive:true});window.addEventListener('resize',position);
    state.observer=new ResizeObserver(position);
    const style = document.createElement('style');
    style.textContent = 'table.dart-canvas-selected{outline:3px solid #16a34a!important;outline-offset:3px!important}.dart-canvas-selection-hover{outline:2px dashed #16a34a!important;cursor:crosshair!important}';
    (document.head||document.documentElement).append(style);
    document.addEventListener('pointerover', event=>{
      if(!state.mode)return;document.querySelectorAll('.dart-canvas-selection-hover').forEach(t=>t.classList.remove('dart-canvas-selection-hover'));
      const t=event.target.closest?.('table');if(t&&!t.querySelector('table'))t.classList.add('dart-canvas-selection-hover');
    },true);
    document.addEventListener('click', event=>{
      if(!state.mode)return;const t=event.target.closest?.('table');if(!t||t.querySelector('table'))return;
      event.preventDefault();event.stopImmediatePropagation();
      try{const description=describe(t);state.queue.push(description);t.classList.toggle('dart-canvas-selected');}catch(e){state.queue.push({error:e.message});}
    },true);
  }
  const scroll = table => { const root=document.scrollingElement;root.scrollTo({top:Math.max(0,table.getBoundingClientRect().top+root.scrollTop-40),left:root.scrollLeft,behavior:'instant'}); };
  if(action==='mode'){state.mode=!!args.on;if(!state.mode)document.querySelectorAll('.dart-canvas-selection-hover').forEach(t=>t.classList.remove('dart-canvas-selection-hover'));return true;}
  if(action==='poll'){const result=state.queue;state.queue=[];return result;}
  const updateEditors = items => {
    for(const item of items){const editor=state.editors.get(item.id);if(!editor)continue;const changed=editor.item.group!==item.group;editor.item={...item};if(changed||state.busy)editor.pending=null;if(changed||state.busy||state.layer.activeElement!==editor.input)editor.input.value=item.group;editor.input.disabled=state.busy;}
    state.position();
  };
  if(action==='edit'){if(state.revision!==args.revision)for(const editor of state.editors.values())editor.pending=null;state.busy=!!args.busy;state.revision=args.revision;updateEditors(args.items);return true;}
  if(action==='sync'){
    document.querySelectorAll('.dart-canvas-selected').forEach(t=>t.classList.remove('dart-canvas-selected'));
    state.busy=!!args.busy;state.revision=args.revision;
    const tables=leafTables(),errors=[],valid=new Set();for(const item of args.items){const t=tables[item.index];if(!t||describe(t).fingerprint!==item.fingerprint){errors.push(item.id);continue;}t.classList.add('dart-canvas-selected');valid.add(item.id);
      let editor=state.editors.get(item.id);
      if(editor&&editor.table!==t){state.observer.unobserve(editor.table);editor.label.remove();state.editors.delete(item.id);editor=null;}
      if(!editor){
        const label=document.createElement('label');label.className='group';label.append(document.createTextNode('그룹 G'));
        const input=document.createElement('input');input.type='number';input.min='1';input.step='1';input.setAttribute('aria-label','선택 표 그룹 번호');
        const error=document.createElement('span');error.className='error';error.setAttribute('role','status');label.append(input,error);state.layer.append(label);
        editor={label,input,error,table:t,item:{...item}};state.editors.set(item.id,editor);state.observer.observe(t);
        const commit=()=>{
          if(state.busy){input.value=editor.item.group;return;}
          const n=Number(input.value);if(!Number.isSafeInteger(n)||n<1){input.value=editor.item.group;error.textContent='1 이상의 정수를 입력하세요.';state.position();return;}
          if(n===editor.item.group||n===editor.pending)return;error.textContent='';
          editor.pending=n;
          state.queue.push({kind:'group',id:item.id,group:n,fingerprint:editor.item.fingerprint,revision:state.revision});
        };
        input.addEventListener('input',()=>{error.textContent='';});
        input.addEventListener('blur',commit);input.addEventListener('keydown',event=>{
          if(event.key==='Enter'){event.preventDefault();commit();input.blur();}
          if(event.key==='Escape'){event.preventDefault();input.value=editor.item.group;error.textContent='';input.blur();}
        });
        label.addEventListener('pointerdown',event=>event.stopPropagation());label.addEventListener('click',event=>event.stopPropagation());
      }
    }
    for(const [id,editor] of state.editors)if(!valid.has(id)){state.observer.unobserve(editor.table);editor.label.remove();state.editors.delete(id);}
    updateEditors(args.items);return errors;
  }
  if(action==='read'||action==='show'){
    const table=leafTables()[args.index];if(!table)throw new Error('선택한 표의 위치가 변경되었습니다. 다시 선택하세요.');
    const result=describe(table,action==='read');if(result.fingerprint!==args.fingerprint)throw new Error('선택한 표가 변경되었습니다. 다시 선택하세요.');
    if(action==='show'){table.classList.add('dart-canvas-selected');scroll(table);return true;}return result;
  }
  throw new Error('지원하지 않는 선택 작업입니다.');
}
async function run(frame, action, args = {}) {
  try {
    const code='('+page.toString()+')('+JSON.stringify(action)+','+JSON.stringify(args)+','+JSON.stringify({rows:PREVIEW_ROWS,columns:PREVIEW_COLUMNS,length:PREVIEW_LENGTH})+')';
    let result;
    for (const delay of action==='show'?SHOW_DELAYS_MS:[0]) {
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      result=await toc.execute(frame,code);
    }
    return result;
  }
  // Electron의 원격 실행 실패는 문자열로 전달되기도 합니다. 오류 표시를 위해 통일합니다.
  catch (failure) { throw failure instanceof Error ? failure : new Error(String(failure).split('\n')[0].replace(/^Error:\s*/, '')); }
}
module.exports={SelectionList,reportYear,run,POLL_MS,EDIT_POLL_MS};
