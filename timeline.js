// --------------------------------------
// CONFIG & BOOTSTRAP
// --------------------------------------
const canvas = document.getElementById("timelineCanvas");
const ctx = canvas.getContext("2d");

// Remove any heading that says "history timeline" (as before)
(function removeTitle() {
  try {
    const candidates = document.querySelectorAll('h1, h2, .title, #title');
    candidates.forEach(el => {
      if (el && el.textContent && el.textContent.toLowerCase().includes('history timeline')) {
        el.remove();
      }
    });
  } catch {}
})();

let zoom = 1;
const minZoom = 0.2;
const maxZoom = 20;

let events = [];   // loaded from CSV
let rows = [];     // auto packed rows

// Panning state (in px)
let panX = 0;
let isPanning = false;
let panStartClientX = 0;
let panStartPanX = 0;
let firstDraw = true;

// --------------------------------------
// LOAD CSV
// --------------------------------------
fetch("timeline-data.csv")
  .then(res => { if (!res.ok) throw new Error("Failed to fetch timeline-data.csv: " + res.status); return res.text(); })
  .then(text => parseCSV(text))
  .then(data => {
    events = data;
    packRows();
    buildLegend();    // <- show color legend based on Groups present
    draw();
  })
  .catch(err => {
    console.error(err);
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.font = "14px Arial";
    ctx.fillText("Failed to load timeline data.", 10, 30);
  });

// --------------------------------------
// CSV PARSER (as before with small tightenings)
// --------------------------------------
function csvSplit(line) {
  const parts = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  parts.push(cur);
  return parts;
}
function parseTimeString(timeStr) {
  if (!timeStr) return [0,0,0];
  const parts = (timeStr || "").split(":").map(p => parseInt(p, 10));
  const h = isNaN(parts[0]) ? 0 : parts[0];
  const m = isNaN(parts[1]) ? 0 : parts[1];
  const s = isNaN(parts[2]) ? 0 : parts[2];
  return [h,m,s];
}
function toTimestampFromParts(year, month, day, timeStr) {
  if (isNaN(year) || year === null) return NaN;
  const y = parseInt(year, 10);                    // negative => BCE
  const mo = isNaN(parseInt(month,10)) ? 1 : parseInt(month,10);
  const d  = isNaN(parseInt(day,10))   ? 1 : parseInt(day,10);
  const [h,m,s] = parseTimeString(timeStr);
  // JS Date uses astronomical year numbering (y===0 is 1 BCE). We accept y as-is
  // and will format for display with BCE/CE later.
  return Date.UTC(y, Math.max(0, mo - 1), Math.max(1, d), h, m, s);
}
function parseCSV(text) {
  if (!text) return [];
  const rawLines = text.split("\n");
  // keep header and any non-empty lines
  const lines = rawLines.map(l => l.trim()).filter((l, idx) => (l.length > 0) || idx === 0);
  if (lines.length === 0) return [];

  const headerParts = csvSplit(lines[0]).map(h => h.trim());
  const headerMap = {};
  headerParts.forEach((h, idx) => { headerMap[h.toLowerCase()] = idx; });

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]; if (!raw) continue;
    const parts = csvSplit(raw);
    const norm = {};
    Object.keys(headerMap).forEach(k => {
      const idx = headerMap[k];
      const rawVal = (parts[idx] !== undefined ? parts[idx] : "");
      const v = ("" + rawVal).trim().replace(/^"(.*)"$/, "$1");
      norm[k] = v;
    });

    const title = norm.headline || norm.title || norm.name || "";
    const type  = norm.type || "";
    const group = norm.group || "";  // <— we’ll color by this if present
    const media = norm.media || "";
    const textField = norm.text || norm['display date'] || "";

    const year  = parseInt(norm.year, 10);
    const month = norm.month;
    const day   = norm.day;
    const timeStr = norm.time || norm['time'] || "";

    let startTs = toTimestampFromParts(year, month, day, timeStr);

    const endYear = parseInt(norm['end year'], 10);
    let endTs = NaN;
    if (!isNaN(endYear)) {
      const endMonth = norm['end month'];
      const endDay   = norm['end day'];
      const endTimeStr = norm['end time'] || "";
      endTs = toTimestampFromParts(endYear, endMonth, endDay, endTimeStr);
    }

    if (isNaN(startTs)) {
      const singleStart = norm.start || norm['start date'] || norm['display date'];
      if (singleStart) {
        const d = new Date(singleStart);
        if (!isNaN(d)) startTs = d.getTime();
      }
    }
    if (isNaN(startTs)) continue;
    if (isNaN(endTs)) endTs = startTs;
    if (endTs < startTs) { const tmp = startTs; startTs = endTs; endTs = tmp; }

    out.push({ title, start: startTs, end: endTs, type, group, media, text: textField, raw: norm });
  }
  return out;
}

// --------------------------------------
// ROW PACKING
// --------------------------------------
function packRows() {
  rows = [];
  events.forEach(ev => {
    let placed = false;
    for (let r of rows) {
      if (!rowOverlap(r, ev)) { r.push(ev); placed = true; break; }
    }
    if (!placed) rows.push([ev]);
  });
}
function rowOverlap(row, ev) {
  return row.some(e => !(ev.end < e.start || ev.start > e.end));
}

// --------------------------------------
// PAN/ZOOM HELPERS
// --------------------------------------
function clampPanForSize(W) {
  const contentWidth = W * zoom;
  const margin = 80;
  if (contentWidth <= W) return (W - contentWidth) / 2;
  const leftLimit = W - contentWidth - margin;
  const rightLimit = margin;
  return Math.max(leftLimit, Math.min(rightLimit, panX));
}
function clampPan() { panX = clampPanForSize(canvas.width); }

// --------------------------------------
// FORMAT HELPERS (BCE/CE & labels)
// --------------------------------------
function formatYearHuman(y) {
  if (y < 0) return `${Math.abs(y)} BCE`;   // -4026 => "4026 BCE"
  if (y > 0) return `${y}`;                 // 33 => "33"
  return "";                                 // no year 0
}
function formatDateHuman(ts) {
  const d = new Date(ts);
  let y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const yTxt = (y < 0) ? `${Math.abs(y)} BCE` : `${y}`;
  return `${yTxt}${(m && day) ? `-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}` : ""}`;
}

// --------------------------------------
// COLORS BY GROUP/TYPE (extensible)
// Keys match CSV's Group values first, then Type.  (See your CSV.)  ⇣
// --------------------------------------
const COLOR_MAP = {
  // Groups seen in your data (sample)
  "events":            "#1f77b4",
  "persons":           "#2ca02c",
  "covenants":         "#8c564b",
  "time periods":      "#9467bd",
  "bible writing":     "#d62728",
  "world powers":      "#ff7f0e",
  "prophets":          "#17becf",
  "judges":            "#bcbd22",
  "kings of israel":   "#e377c2",
  "kings of judah":    "#7f7f7f",
  "jesus":             "#9c27b0",
  "king of the north": "#795548",
  "king of the south": "#607d8b",
  "paul's journeys":   "#00acc1",
  "bible copy/translation":"#009688",
  "modern day history of jw":"#ff6f00",

  // fallback by type
  "person": "#2ca02c",
  "era":    "#dc3545",
  "":       "#007BFF" // default
};
function colorFor(ev) {
  const g = (ev.group || "").toLowerCase().trim();
  const t = (ev.type  || "").toLowerCase().trim();
  return COLOR_MAP[g] || COLOR_MAP[t] || COLOR_MAP[""];
}

// --------------------------------------
// LEGEND (optional, based on present groups)
// --------------------------------------
function buildLegend() {
  const host = document.getElementById("legend");
  if (!host) return;
  const groups = new Map();
  events.forEach(ev => {
    const key = (ev.group || ev.type || "").trim();
    if (!key) return;
    const k = key.toLowerCase();
    groups.set(key, COLOR_MAP[k] || COLOR_MAP[""]);
  });
  host.innerHTML = "";
  [...groups.entries()].forEach(([label, color]) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span class="swatch" style="background:${color}"></span><span>${label}</span>`;
    host.appendChild(chip);
  });
}

// --------------------------------------
// DRAW
// --------------------------------------
function draw() {
  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const topPadding = 8;            // top margin
  const labelAreaHeight = 28;      // top scale area
  const timelineY = topPadding + labelAreaHeight; // main line
  const rowHeight = 40;

  if (!events || events.length === 0) {
    ctx.fillStyle = "#000"; ctx.font = "14px Arial";
    ctx.fillText("No events", 10, timelineY + 20);
    return;
  }

  let minTs = Math.min(...events.map(e => e.start));
  let maxTs = Math.max(...events.map(e => e.end));
  if (!isFinite(minTs) || !isFinite(maxTs)) {
    ctx.fillStyle = "#000"; ctx.font = "14px Arial";
    ctx.fillText("Invalid event dates", 10, 30);
    return;
  }
  if (minTs === maxTs) { minTs -= 24*3600*1000; maxTs += 24*3600*1000; }

  const span  = (maxTs - minTs) || 1;
  const scale = (W * zoom) / span;

  if (firstDraw) {
    const contentWidth = W * zoom;
    panX = (contentWidth <= W) ? (W - contentWidth) / 2 : 0;
    firstDraw = false;
  }
  panX = clampPanForSize(W);

  const xOfTs = (ts) => (ts - minTs) * scale + panX;

  // ----- Main timeline line
  ctx.strokeStyle = "#222"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, timelineY); ctx.lineTo(W, timelineY); ctx.stroke();

  // ----- Top dynamic year labels (skip 0, show "BCE")
  const msPerYear = 365.2425 * 24 * 3600 * 1000;
  const approxPxPerYear = scale * msPerYear;

  let stepYears;
  if (approxPxPerYear <   2) stepYears = 200;
  else if (approxPxPerYear <  6) stepYears = 100;
  else if (approxPxPerYear < 14) stepYears = 50;
  else if (approxPxPerYear < 30) stepYears = 20;
  else if (approxPxPerYear < 60) stepYears = 10;
  else if (approxPxPerYear <100) stepYears = 5;
  else if (approxPxPerYear <200) stepYears = 2;
  else stepYears = 1;

  const minYear = new Date(minTs).getUTCFullYear();
  const maxYear = new Date(maxTs).getUTCFullYear();
  const startLabel = Math.floor(minYear / stepYears) * stepYears;

  ctx.font = "12px Arial"; ctx.textBaseline = "middle";
  const minLabelGap = 6;
  let lastLabelRight = -Infinity;

  for (let y = startLabel; y <= maxYear; y += stepYears) {
    if (y === 0) continue; // no year 0
    const ts = Date.UTC(y, 0, 1);
    const x  = xOfTs(ts);
    if (x < -120 || x > W + 120) continue;

    const text = formatYearHuman(y); // BCE/CE label
    if (!text) continue;

    const textW = ctx.measureText(text).width;
    const pillW = textW + 10;
    const pillH = 20;
    const pillX = x - pillW/2;
    const pillY = topPadding;
    const pillLeft  = Math.max(4, pillX);
    const pillRight = pillLeft + pillW;

    if (pillLeft <= lastLabelRight + minLabelGap) continue;

    // pill
    ctx.fillStyle = '#ffffffee';
    ctx.strokeStyle = '#00000022';
    roundRect(ctx, pillLeft, pillY, pillW, pillH, 6, true, false);
    ctx.fillStyle = '#000';
    ctx.fillText(text, pillLeft + 5, pillY + pillH/2);
    lastLabelRight = pillRight;

    // tick down to timeline
    ctx.strokeStyle = '#00000033';
    ctx.beginPath(); ctx.moveTo(x, pillY + pillH); ctx.lineTo(x, timelineY - 4); ctx.stroke();
  }

  // ----- Rows & events
  rows.forEach((row, i) => {
    const yTop = timelineY + 18 + i * rowHeight;   // row's top
    row.forEach(ev => {
      const x1 = xOfTs(ev.start);
      const x2 = xOfTs(ev.end);
      const left  = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const rawWidth = right - left;

      const color = colorFor(ev);
      const stickX = (rawWidth < 10) ? x1 : left; // point events: at date; ranges: at start

      // 1) Dotted stick from main timeline down to this row
      ctx.save();
      ctx.setLineDash([3, 4]);  // dotted
      ctx.strokeStyle = color + "AA";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(stickX, timelineY);
      ctx.lineTo(stickX, yTop + 10); // to flag center
      ctx.stroke();
      ctx.restore();

      // 2) Duration bar (if any span)
      if (rawWidth >= 10) {
        ctx.fillStyle = color;
        ctx.fillRect(left, yTop + 18, Math.max(6, rawWidth), 6);
      } else {
        // tiny dot for instant events
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(stickX, yTop + 18 + 3, 4, 0, Math.PI*2);
        ctx.fill();
      }

      // 3) Flag with full headline (wrapped)
      const labelTitle   = ev.title || "";
      const labelDateTxt =
        (ev.raw && ev.raw['display date']) ? ev.raw['display date'] : formatDateHuman(ev.start);

      // Compose title (bold) + optional small date line
      const lines = wrapText(ctx, labelTitle, 320, "bold 12px Arial")
                     .concat(wrapText(ctx, labelDateTxt, 320, "11px Arial"));
      const paddingX = 8, paddingY = 6, lineGap = 2;
      const lineHeights = lines.map(l => l.font.startsWith("bold") ? 13 : 12);
      const textW = Math.min(360, Math.max(...lines.map(l => ctx.measureText(l.text).width)));
      const pillW = Math.max(120, textW + paddingX * 2);
      const pillH = paddingY*2 + lineHeights.reduce((a,b)=>a+b,0) + (lines.length-1)*lineGap;

      let pillX = stickX + 10;                      // place to the right of the stick
      if (pillX + pillW > W - 8) pillX = stickX - 10 - pillW; // flip to left if near edge
      if (pillX < 4) pillX = 4;
      const pillY = yTop; // flag top

      ctx.fillStyle = "#ffffffdd";
      ctx.strokeStyle = "#00000022";
      ctx.lineWidth = 1;
      roundRect(ctx, pillX, pillY, pillW, pillH, 8, true, false);

      // text lines
      let ty = pillY + paddingY + (lineHeights[0] - 2);
      lines.forEach((ln, idx) => {
        ctx.font = ln.font;
        ctx.fillStyle = idx === 0 ? "#000" : "#333";
        ctx.fillText(ln.text, pillX + paddingX, ty);
        ty += lineHeights[idx] + lineGap;
      });
    });
  });
}

// Rounded rect helper
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  if (typeof r === 'undefined') r = 5;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// Wrap text into multiple lines (returns [{text, font}, ...])
function wrapText(ctx, text, maxWidth, font = "12px Arial") {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  ctx.font = font;

  words.forEach((w, idx) => {
    const test = line ? (line + " " + w) : w;
    const width = ctx.measureText(test).width;
    if (width > maxWidth && line) {
      lines.push({ text: line, font });
      line = w;
    } else {
      line = test;
    }
  });
  if (line) lines.push({ text: line, font });
  return lines;
}

// --------------------------------------
// PANNING & ZOOM (unchanged behavior)
// --------------------------------------
function onPointerDown(clientX) {
  isPanning = true; panStartClientX = clientX; panStartPanX = panX;
  canvas.style.cursor = 'grabbing';
}
function onPointerMove(clientX) {
  if (!isPanning) return;
  const dx = clientX - panStartClientX;
  panX = panStartPanX + dx;
  clampPan();
  draw();
}
function onPointerUp() { isPanning = false; canvas.style.cursor = 'grab'; }

canvas.style.cursor = 'grab';
canvas.addEventListener('mousedown', e => { e.preventDefault(); onPointerDown(e.clientX); });
window.addEventListener('mousemove', e => { onPointerMove(e.clientX); });
window.addEventListener('mouseup',    () => { onPointerUp(); });

canvas.addEventListener('touchstart', e => {
  if (!e.touches || e.touches.length===0) return;
  onPointerDown(e.touches[0].clientX);
});
canvas.addEventListener('touchmove', e => {
  if (!e.touches || e.touches.length===0) return;
  onPointerMove(e.touches[0].clientX);
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend',   () => { onPointerUp(); });
canvas.addEventListener('touchcancel',() => { onPointerUp(); });

document.getElementById('zoomIn').onclick = () => {
  const oldZoom = zoom;
  const newZoom = Math.min(maxZoom, zoom * 1.3);
  if (newZoom === oldZoom) return;

  const W = canvas.width || canvas.clientWidth;
  let minTs = events.length ? Math.min(...events.map(e=>e.start)) : 0;
  let maxTs = events.length ? Math.max(...events.map(e=>e.end))   : 1;
  if (minTs===maxTs){ minTs -= 24*3600*1000; maxTs += 24*3600*1000; }
  const span = (maxTs - minTs) || 1;

  const oldScale = (W*oldZoom)/span;
  const newScale = (W*newZoom)/span;

  // Keep content under cursor proportionally in place
  panX = panX * (newScale/oldScale);
  zoom = newZoom; clampPan(); draw();
};
document.getElementById('zoomOut').onclick = () => {
  const oldZoom = zoom;
  const newZoom = Math.max(minZoom, zoom / 1.3);
  if (newZoom === oldZoom) return;

  const W = canvas.width || canvas.clientWidth;
  let minTs = events.length ? Math.min(...events.map(e=>e.start)) : 0;
  let maxTs = events.length ? Math.max(...events.map(e=>e.end))   : 1;
  if (minTs===maxTs){ minTs -= 24*3600*1000; maxTs += 24*3600*1000; }
  const span = (maxTs - minTs) || 1;

  const oldScale = (W*oldZoom)/span;
  const newScale = (W*newZoom)/span;

  panX = panX * (newScale/oldScale);
  zoom = newZoom; clampPan(); draw();
};
