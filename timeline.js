(function(){
/* timeline.js - Full offline timeline rendering
   - Loads timeline-data.csv (must be in same folder)
   - Parses CSV, handles BCE (negative years), spans vs single-year events
   - Auto-packs rows to avoid overlaps (labels considered)
   - Adaptive tick step (shows 10-yr when zoomed enough)
   - Click on event to open detail popup (simple)
*/

const CSV_PATH = "timeline-data.csv";
const NOTICE_ID = "timeline-notice";

function showNotice(msg){ 
  let n = document.getElementById(NOTICE_ID);
  if(!n){ n = document.createElement('div'); n.id=NOTICE_ID; n.style.cssText='position:fixed;left:8px;right:8px;bottom:8px;padding:8px;background:#ffe; border:1px solid #cca; z-index:9999; font-family:Arial,Helvetica,sans-serif;'; document.body.appendChild(n); }
  n.innerText = msg;
  n.style.display = msg? 'block':'none';
}

// --- CSV utilities ---
function fetchCSV(path){
  return fetch(path).then(r=>{ if(!r.ok) throw new Error('Fetch failed: '+r.status); return r.text(); });
}

function parseCSV(text){
  // basic RFC4180-like parser
  const rows = [];
  let cur = '';
  let inQuotes = false;
  let row = [];
  for (let i=0;i<text.length;i++){
    const ch = text[i];
    const nxt = text[i+1]||'';
    if (ch === '"'){
      if (inQuotes && nxt === '"'){ cur += '"'; i++; continue; }
      inQuotes = !inQuotes; continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')){
      if (ch === '\r' && nxt === '\n'){ continue; }
      row.push(cur); rows.push(row); row=[]; cur=''; continue;
    }
    if (!inQuotes && ch === ','){ row.push(cur); cur=''; continue; }
    cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function normalizeHeaders(headers){ return headers.map(h=> (h||'').replace(/\uFEFF/g,'').trim()); }

function toEvents(rows){
  const headers = normalizeHeaders(rows[0]||[]);
  const data = rows.slice(1).filter(r=>r.length>1);
  const list = [];
  data.forEach(r=>{
    const obj = {};
    for (let i=0;i<headers.length;i++){ obj[headers[i]] = r[i] || ''; }
    const get = k => (obj[k]||'').trim();
    const year = get('Year') || get('Start Year') || get('StartYear') || '';
    const month = get('Month') || '';
    const day = get('Day') || '';
    const end_year = get('End Year') || get('EndYear') || '';
    const end_month = get('End Month') || '';
    const end_day = get('End Day') || '';
    const headline = get('Headline') || get('Title') || get('Text') || '';
    const text = get('Text') || '';
    const typ = get('Type') || get('Category') || '';
    function parse_int(v){
      if (!v) return null;
      v = v.toString().trim();
      v = v.replace(/,/g,'');
      const parts = v.split(/\s+/);
      if (parts.length>1){
        const n = parseInt(parts[0],10);
        if (!isNaN(n)){
          if (parts.slice(1).some(p=>/B/i.test(p))) return -Math.abs(n);
          return n;
        }
      }
      const n = parseFloat(v);
      if (!isNaN(n)) return Math.round(n);
      const s = v.replace(/[^0-9\-]/g,'');
      if (s==='') return null;
      const nn = parseInt(s,10);
      return isNaN(nn)?null:nn;
    }
    const sy = parse_int(year);
    if (sy==null) return;
    const emy = parse_int(end_year);
    const m = month?parseInt(month,10)||1:1;
    const d = day?parseInt(day,10)||1:1;
    const em = end_month?parseInt(end_month,10):null;
    const ed = end_day?parseInt(end_day,10):null;
    function decimal_year(y,m,d){
      const sign = y<=0?-1:1;
      const ay = Math.abs(y);
      const frac = ((m-1)/12.0)+((d-1)/365.0);
      return sign*(ay+frac);
    }
    const sdec = decimal_year(sy,m,d);
    let edec = null;
    if (emy!=null){
      const em2 = em||12; const ed2 = ed||31;
      edec = decimal_year(emy, em2, ed2);
    }
    list.push({title: headline||'(no title)', text: text, type: typ||'event', start: sdec, end: edec});
  });
  return list;
}

// --- Rendering ---
function render(events){
  const vis = document.getElementById('vis') || document.body;
  let canvas = document.getElementById('canvas');
  let scale = document.getElementById('scale');
  if (!canvas){ canvas = document.createElement('div'); canvas.id='canvas'; canvas.style.position='relative'; canvas.style.height='300px'; canvas.style.width='100%'; vis.appendChild(canvas); }
  if (!scale){ scale = document.createElement('div'); scale.id='scale'; scale.style.position='relative'; scale.style.height='80px'; vis.appendChild(scale); }
  canvas.innerHTML=''; scale.innerHTML='';
  // compute bounds
  let min = Infinity, max = -Infinity;
  events.forEach(e=>{ min = Math.min(min, e.start); if (e.end!=null) max = Math.max(max, e.end); else max = Math.max(max, e.start); });
  if (!isFinite(min) || !isFinite(max)){ canvas.innerText='No events to display'; return; }
  const span = max - min || 1;
  // width and pxPerYear
  const minWidth = 1200, maxWidth = 40000;
  let width = Math.round(span * 6);
  width = Math.max(minWidth, Math.min(maxWidth, width));
  const pxPerYear = width / span;
  canvas.style.width = width + 'px'; scale.style.width = width + 'px'; canvas.style.minHeight = '220px'; scale.style.minHeight='80px';
  // helper el
  function el(tag, cls){ const d=document.createElement(tag); if(cls) d.className=cls; return d; }
  // items with pixel positions & visual ends
  const items = events.map((e,i)=>{
    const s = (e.start - min) * pxPerYear;
    const isSpan = e.end!=null && Math.abs(e.end - e.start) > 0.5;
    const epx = isSpan ? (e.end - min) * pxPerYear : s;
    const label = e.title || '';
    const labelW = Math.min(520, 8 * label.length + 28);
    const visualEnd = isSpan ? epx + labelW : epx + labelW + 24;
    return {idx:i, s:s, e:epx, visualEnd:visualEnd, isSpan:isSpan, data:e, labelW:labelW};
  });
  items.sort((a,b)=> a.s - b.s || ((b.visualEnd - b.s) - (a.visualEnd - a.s)));
  // packing rows strictly: place into first row where s > lastVisualEnd + gap
  const rows = [];
  const gap = 6;
  items.forEach(it=>{
    let r = 0;
    while (true){
      if (rows[r] === undefined){ rows[r] = -1; break; }
      if (it.s > rows[r] + gap) break;
      r++;
    }
    it.row = r;
    rows[r] = it.visualEnd;
  });
  // render items
  items.forEach(it=>{
    const d = it.data;
    const top = 8 + it.row * 36;
    if (it.isSpan){
      const left = Math.round(it.s);
      const right = Math.round(it.e);
      const w = Math.max(6, right - left);
      const bar = el('div','bar');
      bar.style.position='absolute'; bar.style.left = left + 'px'; bar.style.top = (top+6) + 'px';
      bar.style.width = w + 'px'; bar.style.height = '18px'; bar.style.borderRadius='6px';
      bar.style.background = d.type && d.type.toLowerCase().includes('person') ? '#4ade80' : (d.type && d.type.toLowerCase().includes('era') ? '#f87171' : '#60a5fa');
      bar.title = (d.title||'') + (d.text ? '\n' + d.text : '');
      canvas.appendChild(bar);
      const label = el('div','event ' + (d.type? d.type.toLowerCase(): 'event'));
      label.style.position='absolute'; label.style.left = left + 'px'; label.style.top = top + 'px';
      label.style.padding='4px 8px'; label.style.borderRadius='4px'; label.style.whiteSpace='nowrap'; label.style.fontSize='12px';
      label.style.boxShadow='0 1px 2px rgba(0,0,0,0.05)';
      label.style.background = d.type && d.type.toLowerCase().includes('person') ? '#4ade80' : (d.type && d.type.toLowerCase().includes('era') ? '#f87171' : '#60a5fa');
      label.style.color = d.type && d.type.toLowerCase().includes('person') ? '#033' : '#fff';
      label.innerText = d.title || '(no title)';
      label.onclick = ()=> showDetail(d);
      canvas.appendChild(label);
    } else {
      const x = Math.round(it.s);
      const mark = el('div','line-mark');
      mark.style.position='absolute'; mark.style.left = x + 'px'; mark.style.top = (top+6) + 'px'; mark.style.height = '36px';
      mark.style.width='2px'; mark.style.background='#222';
      canvas.appendChild(mark);
      const label = el('div','event ' + (d.type? d.type.toLowerCase(): 'event'));
      label.style.position='absolute'; label.style.left = (x + 6) + 'px'; label.style.top = top + 'px';
      label.style.padding='4px 8px'; label.style.borderRadius='4px'; label.style.whiteSpace='nowrap'; label.style.fontSize='12px';
      label.style.boxShadow='0 1px 2px rgba(0,0,0,0.05)';
      label.style.background = d.type && d.type.toLowerCase().includes('person') ? '#4ade80' : (d.type && d.type.toLowerCase().includes('era') ? '#f87171' : '#60a5fa');
      label.style.color = d.type && d.type.toLowerCase().includes('person') ? '#033' : '#fff';
      label.innerText = d.title || '(no title)';
      label.onclick = ()=> showDetail(d);
      canvas.appendChild(label);
    }
  });
  // adaptive ticks: choose step so labels not too dense
  function chooseStep(span, pxPerYear){
    if (pxPerYear * 10 >= 40) return 10;
    const desiredPx = 80;
    const years = desiredPx / pxPerYear;
    const steps = [1,2,5,10,20,50,100,200,500,1000,2000,5000];
    for (let s of steps) if (s >= years) return s;
    return steps[steps.length-1];
  }
  const step = chooseStep(span, pxPerYear);
  for (let y = Math.ceil(min/step)*step; y <= max; y += step){
    const x = Math.round((y - min) * pxPerYear);
    const tick = el('div','tick'); tick.style.position='absolute'; tick.style.left = x + 'px'; tick.style.bottom='0px'; tick.style.width='1px'; tick.style.height='12px'; tick.style.background='#333';
    scale.appendChild(tick);
    const lbl = el('div','tick-label'); lbl.style.position='absolute'; lbl.style.left = x + 'px'; lbl.style.bottom='14px'; lbl.style.transform='translateX(-50%)'; lbl.style.fontSize='11px';
    lbl.innerText = y < 0 ? Math.abs(Math.round(y)) + ' BCE' : Math.round(y);
    scale.appendChild(lbl);
  }
  // adjust canvas height based on number of rows
  const totalRows = rows.length;
  canvas.style.height = Math.max(220, totalRows * 36 + 40) + 'px';
}

// detail popup
function showDetail(d){
  const w = window.open("", "_blank", "width=400,height=300,scrollbars=yes");
  w.document.write("<html><head><title>"+(d.title||'')+"</title></head><body><h3>"+(d.title||'')+"</h3><pre>"+(d.text||'')+"</pre></body></html>");
  w.document.close();
}

// Bootstrap: try fetch CSV and render; if fetch fails, show message with options
fetchCSV(CSV_PATH).then(text=>{
  try{
    const rows = parseCSV(text);
    if (!rows || !rows.length) throw new Error('Empty CSV');
    const events = toEvents(rows);
    if (!events.length) showNotice('No events parsed from CSV');
    render(events);
  } catch(err){
    console.error('Parse error', err);
    showNotice('Error parsing CSV: '+err.message);
  }
}).catch(err=>{
  console.error('Fetch failed', err);
  // show helpful instructions for local usage
  showNotice('Could not load timeline-data.csv directly. On Android some browsers block local file fetch.\\nOptions:\\n• Use Firefox for Android to open the HTML file in the same folder.\\n• Run a simple local web server app and open via http://localhost:8080/ \\n• Or upload the site to GitHub Pages (recommended).');
});

})();