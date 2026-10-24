// Runs inside the visible DART viewer frame. Scans locally, returning metadata first.
function tableOperation(operation, args) {
  const norm = value => String(value || '').replace(/\s+/g, '').toLowerCase();
  const tables = [...document.querySelectorAll('table')].filter(t => !t.parentElement.closest('table'));
  const textOf = table => [...table.rows].map(r => [...r.cells].map(c => c.textContent.trim()).join(' | ')).join('\n');
  const contextOf = table => {
    let el = table.previousElementSibling, parts = [];
    for (let i = 0; el && i < 4; i++, el = el.previousElementSibling) {
      if (el.tagName === 'TABLE' && el.rows.length > 5) break;
      parts.unshift((el.innerText || '').slice(-400));
    }
    return parts.join('\n').slice(-800).replace(/\n{3,}/g, '\n');
  };
  if(operation==='clear-source') {
    document.querySelectorAll('[data-dart-source]').forEach(el=>el.removeAttribute('data-dart-source'));
    return true;
  }
  if (operation === 'scan') {
    const terms = args.query.split(/\s+/).filter(Boolean).map(norm);
    return tables.flatMap((table, i) => {
      const text = textOf(table);
      if (!terms.every(t => norm(text).includes(t))) return [];
      return [{ id: `${args.section.id}:table:${i}`, sectionId: args.section.id, sectionTitle: args.section.title, tableIndex: i, chars: text.length, rows: table.rows.length, query: args.query, url: location.href }];
    });
  }
  const table = tables[args.candidate?.tableIndex ?? args.tableIndex];
  if (!table) throw Error('표 위치가 바뀌었습니다. 다시 검색하세요.');
  if(operation==='describe') {
    const sectionId=new URL(location.href).searchParams.get('eleId');
    return {id:sectionId+':table:'+args.tableIndex,sectionId,tableIndex:args.tableIndex,chars:textOf(table).length,rows:table.rows.length,url:location.href};
  }
  if (operation === 'focus' || operation==='source') {
    if(!document.getElementById('dart-table-borders')){
      const style=document.createElement('style');style.id='dart-table-borders';
      style.textContent='table[data-dart-result]{outline:4px solid #e47715!important;outline-offset:2px;box-shadow:inset 0 0 0 3px #e47715!important}table[data-dart-source]{outline:4px solid #2563eb!important;outline-offset:2px;box-shadow:inset 0 0 0 3px #2563eb!important}';
      document.head.append(style);
    }
    document.querySelectorAll('[data-dart-selected]').forEach(el => { el.style.outline = ''; el.style.boxShadow = ''; el.removeAttribute('data-dart-selected'); });
    document.querySelectorAll('[data-dart-row]').forEach(el => { el.style.backgroundColor = ''; el.removeAttribute('data-dart-row'); });
    const attribute=operation==='source'?'data-dart-source':'data-dart-result';
    document.querySelectorAll('['+attribute+']').forEach(el=>el.removeAttribute(attribute));
    table.setAttribute(attribute,'true');
    table.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    window.scrollBy({top:-100,left:0,behavior:'instant'});
    const rect=table.getBoundingClientRect();
    return {visible:rect.bottom>0 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth,top:rect.top,left:rect.left,viewportHeight:innerHeight};
  }
  const rect=table.getBoundingClientRect();
  const appearance = el => {
    const s=getComputedStyle(el);
    let bg=el,fill='';
    while(bg){const color=getComputedStyle(bg).backgroundColor;if(color!=='transparent'&&color!=='rgba(0, 0, 0, 0)'){fill=color;break;}bg=bg.parentElement;}
    return {fill,color:s.color,fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,fontStyle:s.fontStyle,
      textAlign:s.textAlign,verticalAlign:s.verticalAlign,
      borders:Object.fromEntries(['top','right','bottom','left'].map(edge=>[edge,{style:s.getPropertyValue('border-'+edge+'-style'),width:s.getPropertyValue('border-'+edge+'-width'),color:s.getPropertyValue('border-'+edge+'-color')}]))};
  };
  const snapshot = el => ({kind:'table',html:el.outerHTML,rows:[...el.rows].map((r,ri)=>[...r.cells].map(c=>({text:c.innerText.trim(),colSpan:c.colSpan,rowSpan:c.rowSpan||el.rows.length-ri,style:appearance(c),width:c.getBoundingClientRect().width}))),rowHeights:[...el.rows].map(r=>r.getBoundingClientRect().height),width:el.getBoundingClientRect().width});
  const original=snapshot(table),before=[];
  let previous=table.previousElementSibling;
  // Preserve nearby original headings and unit/date tables, without interpreting their units.
  for(let i=0;previous&&i<6;i++,previous=previous.previousElementSibling){
    if(previous.tagName==='TABLE'&&previous.rows.length>3)break;
    const text=previous.innerText.trim();if(text.length>2000)break;
    if(text)before.unshift(previous.tagName==='TABLE'?snapshot(previous):{kind:'text',text,style:appearance(previous),height:previous.getBoundingClientRect().height});
    if(/^\d+\.\s*\S/.test(text))break;
  }
  return { text: textOf(table), context: contextOf(table), rows:original.rows, original:{...original,before}, url: location.href, position:{visible:rect.bottom>0 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth,top:rect.top,left:rect.left,viewportHeight:innerHeight} };
}

function createDartProfile(views, emit) {
  const vectors = new Map();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const contents = target => views[target].webContents;
  async function viewer(target) {
    const frame = contents(target).mainFrame.frames.find(f => f.url.includes('/report/viewer.do'));
    if (!frame) throw Error('DART 본문을 아직 읽을 수 없습니다. 보고서 로딩 후 다시 검색하세요.');
    return frame;
  }
  async function operation(target, op, args) {
    return (await viewer(target)).executeJavaScript(`(${tableOperation.toString()})(${JSON.stringify(op)},${JSON.stringify(args)})`);
  }
  const profile = {
    maxChunkChars: 16000,
    maxBatchChars: 24000,
    async describe(target,tableIndex) {
      if(!Number.isInteger(tableIndex)||tableIndex<0)throw Error('유효한 표 번호가 필요합니다.');
      const meta=await operation(target,'describe',{tableIndex});
      const index=(await profile.indexes(target,'')).find(n=>n.id===meta.sectionId);
      return {...meta,sectionTitle:index?.title||'선택한 본문'};
    },
    async clearSource(target) {try{return await operation(target,'clear-source',{});}catch{return false;}},
    async indexes(target, query = '') {
      const all = await contents(target).executeJavaScript(`(() => {
        const tree = typeof $j === 'undefined' ? null : $j('#listTree').jstree(true);
        return tree ? tree.get_json('#', {flat:true}).map(n => ({id:String(n.id), title:n.text})) : [];
      })()`);
      const terms = query.replace(/\s+/g, '').toLowerCase();
      return all.filter(n => n.title.replace(/\s+/g, '').toLowerCase().includes(terms));
    },
    async open(target, id) {
      await contents(target).executeJavaScript(`(() => {
        const tree = $j('#listTree').jstree(true);
        tree.deselect_all(); tree.select_node(${JSON.stringify(String(id))});
        document.getElementById(${JSON.stringify(`${id}_anchor`)})?.scrollIntoView({block:'center'});
      })()`);
      for (let i = 0; i < 100; i++) {
        const ready = await contents(target).executeJavaScript(`(() => {
          const f = document.getElementById('ifrm');
          try { const actual=new URL(f.contentWindow.location.href),expected=new URL(f.src); return f.contentDocument?.readyState === 'complete' && f.contentDocument.body?.textContent.length > 0 && ['rcpNo','dcmNo','eleId','offset'].every(k=>actual.searchParams.get(k)===expected.searchParams.get(k)); } catch { return false; }
        })()`);
        if (ready) { await pause(400); return; }
        await pause(150);
      }
      throw Error('DART 본문 로딩이 지연되고 있습니다. 다시 검색하세요.');
    },
    async scan(target, section, query) { return operation(target, 'scan', { section, query }); },
    async ensure(target, candidate) {
      const current = (await viewer(target)).url;
      if (current !== candidate.url) await profile.open(target, candidate.sectionId);
    },
    async read(target, candidate) {
      await profile.ensure(target, candidate);
      const evidence = await operation(target, 'read', { candidate });
      evidence.sectionTitle = candidate.sectionTitle;
      return evidence;
    },
    async focus(target, candidate, role='result') {
      await profile.ensure(target, candidate);
      const position=await operation(target, role==='source'?'source':'focus', { candidate });
      if(!position.visible)throw Error('표가 화면 안으로 이동하지 못했습니다. 다시 선택하세요.');
      return position;
    }
  };
  if (process.env.EMBEDDING_URL) profile.embed = async (query, texts) => {
    const input = [query, ...texts];
    const key = JSON.stringify([process.env.EMBEDDING_URL, process.env.EMBEDDING_MODEL, input]);
    let data = vectors.get(key);
    if (!data) {
      const response = await fetch(process.env.EMBEDDING_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.EMBEDDING_API_KEY ? { Authorization: `Bearer ${process.env.EMBEDDING_API_KEY}` } : {}) },
        body: JSON.stringify({ input, ...(process.env.EMBEDDING_MODEL ? { model: process.env.EMBEDDING_MODEL } : {}) }), signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw Error(`임베딩 서버 응답: ${response.status}`);
      data = (await response.json()).data.sort((a, b) => a.index - b.index).map(d => d.embedding);
      if (data.length !== input.length || data.some(v => !Array.isArray(v) || !v.length || v.length !== data[0].length || v.some(x => !Number.isFinite(x)))) throw Error('임베딩 응답 형식을 확인하세요.');
      vectors.set(key, data);
    }
    const cosine = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b) || 1);
    return data.slice(1).map(v => cosine(data[0], v));
  };
  return profile;
}
module.exports = { createDartProfile, tableOperation };
