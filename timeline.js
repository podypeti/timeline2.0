// ============================================================
// History Timeline — BCE/CE, dotted sticks + flags, details panel,
// WOL scripture links, and legend filter chips
// ============================================================

// --- Wol.jw.org locale ---
// English: 'en/lp-e'  |  Hungarian: 'hu/lp-h'  |  German: 'de/lp-d'  |  Spanish: 'es/lp-s'
const WOL_LANG_SEGMENT = 'en/lp-e';
const WOL_SEARCH_BASE = `https://wol.jw.org/${WOL_LANG_SEGMENT}/s/r1/?q=`;

// --------------------------------------
// Bootstrapping
// --------------------------------------
const canvas = document.getElementById("timelineCanvas");
const ctx = canvas.getContext("2d");

// Remove any heading that says "history timeline" (defensive)
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

let allEvents = [];
let visibleEvents = [];
let rows = [];

let panX = 0;
let isPanning = false;
let panStartClientX = 0;
let panStartPanX = 0;
let firstDraw = true;

let hitRegions = [];          // [{x,y,w,h, ev, kind}]
let suppressNextClick = false;

// --------------------------------------
// Load CSV
// --------------------------------------
fetch("timeline-data.csv")
  .then(res => { if (!res.ok) throw new Error("Failed to fetch timeline-data.csv: " + res.status); return res.text(); })
  .then(text => parseCSV(text))
  .then(data => {
    allEvents = data;
    initFiltersFromData();
    applyFiltersAndPack();
    buildLegend();
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
// CSV parser (robust for quoted commas; flexible headers)
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
  const y = parseInt(year, 10);                      // negative => BCE (astronomical)
  const mo = isNaN(parseInt(month,10)) ? 1 : parseInt(month,10);
  const d  = isNaN(parseInt(day,10))   ? 1 : parseInt(day,10);
  const [h,m,s] = parseTimeString(timeStr);
  return Date.UTC(y, Math.max(0, mo - 1), Math.max(1, d), h, m, s);
}
function parseCSV(text) {
  if (!text) return [];
  const rawLines = text.split("\n");
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
    const group = norm.group || "";
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
// Filters (by Group; fallback to Type; default = all on)
// --------------------------------------
const activeGroups = new Set();
let availableGroups = [];  // [{label, keyLower}...]

function groupKeyFor(ev) {
  return (ev.group || ev.type || "(Other)").trim();
}
function initFiltersFromData() {
  const seen = new Map();
  allEvents.forEach(ev => {
    const label = groupKeyFor(ev);
    const keyLower = label.toLowerCase();
    if (!seen.has(keyLower)) seen.set(keyLower, label);
  });
  availableGroups = [...seen.entries()].map(([keyLower, label]) => ({ label, keyLower }));
  activeGroups.clear();
  availableGroups.forEach(g => activeGroups.add(g.keyLower));
}
function applyFiltersAndPack() {
  visibleEvents = allEvents.filter(ev => activeGroups.has(groupKeyFor(ev).toLowerCase()));
  packRows();
}

// --------------------------------------
// Row packing
// --------------------------------------
function packRows() {
  rows = [];
  visibleEvents.forEach(ev => {
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
// Pan/Zoom helpers
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
// Format helpers (BCE/CE & labels)
// --------------------------------------
function formatYearHuman(y) {
  if (y < 0) return `${Math.abs(y)} BCE`;
  if (y > 0) return `${y}`;
  return ""; // no year 0
}
function formatDateHuman(ts) {
  const d = new Date(ts);
  let y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const yTxt = (y < 0) ? `${Math.abs(y)} BCE` : `${y}`;
  return `${yTxt}${(m && day) ? `-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}` : ""}`;
}
function displayWhen(ev) {
  if (ev.raw && ev.raw['display date']) return ev.raw['display date'];
  const a = formatDateHuman(ev.start);
  const b = formatDateHuman(ev.end);
  return (a === b) ? a : `${a} — ${b}`;
}

// --------------------------------------
// Colors by Group/Type (extend as needed)
// --------------------------------------
const COLOR_MAP = {
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
  "bible copy/translation": "#009688",
  "modern day history of jw":"#ff6f00",
  "(other)":           "#007BFF",
  // fallback by type
  "person": "#2ca02c",
  "era":    "#dc3545",
  "":       "#007BFF"
};
function colorFor(ev) {
  const g = groupKeyFor(ev).toLowerCase();
  const t = (ev.type  || "").toLowerCase().trim();
  return COLOR_MAP[g] || COLOR_MAP[t] || COLOR_MAP[""];
}

// --------------------------------------
// Legend (interactive filter chips)
// --------------------------------------
function buildLegend() {
  const host = document.getElementById("legend");
  if (!host) return;
  host.innerHTML = "";
  availableGroups.forEach(({ label, keyLower }) => {
    const color = COLOR_MAP[keyLower] || COLOR_MAP[""];
    const chip = document.createElement("div");
    chip.className = "chip" + (activeGroups.has(keyLower) ? "" : " inactive");
    chip.setAttribute("data-key", keyLower);
    chip.innerHTML = `<span class="swatch" style="background:${color}"></span><span>${label}</span>`;
    chip.addEventListener("click", () => {
      if (activeGroups.has(keyLower)) activeGroups.delete(keyLower);
      else activeGroups.add(keyLower);
      chip.classList.toggle("inactive");
      applyFiltersAndPack();
      draw(); // keep current pan/zoom; just redraw
    });
    host.appendChild(chip);
  });
}

// --------------------------------------
// Scripture linking for details panel (WOL search)
// Examples detected: "Gen. 2:7", "Job 1:8; 42:16"
// --------------------------------------
const BOOKS = '(?:Gen|Ex|Lev|Num|Deut|Josh|Jg|Judg|Ruth|1\\s?Sam|2\\s?Sam|1\\s?Ki|2\\s?Ki|1\\s?Ch|2\\s?Ch|Chron|Ezra|Neh|Esth?|Job|Ps|Prov|Eccl|Song|Isa|Jer|Lam|Ezek|Dan|Hos|Joel|Amos|Obad|Jonah?|Mic|Nah|Hab|Zeph|Hag|Zech|Mal|Matt|Mt|Mark|Mrk|Luke|Lu|John|Jn|Acts|Rom|Ro|1\\s?Cor|2\\s?Cor|Gal|Eph|Phil|Col|1\\s?Thess|2\\s?Thess|1\\s?Tim|2\\s?Tim|Titus|Philem|Heb|Jas|James|1\\s?Pet|2\\s?Pet|1\\s?John|2\\s?John|3\\s?John|Jude|Rev)\\.?';
const REG_COMBINED = new RegExp(`\\b(${BOOKS})\\s+(\\d+:\\d+(?:[-–]\\d+)?)|\\b(\\d+:\\d+(?:[-–]\\d+)?)`, 'g');

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
/** Turns scripture refs into <a> links to WOL search. */
function linkifyScripture(text) {
  const src = escapeHtml(text);
  let out = "";
  let lastIdx = 0;
  let lastBook = null;

  REG_COMBINED.lastIndex = 0;
  let m;
  while ((m = REG_COMBINED.exec(src)) !== null) {
    const idx = m.index;
    out += src.slice(lastIdx, idx);

    if (m[1] && m[2]) {
      // "Book" + "ch:vs"
      lastBook = m[1].replace(/\s+/g, ' ').trim();
      const ref = m[2];
      const q = encodeURIComponent(`${lastBook} ${ref}`);
      out += `<a href="${WOL_SEARCH_BASE}${q}" target="_blank" rel="noopener">${escapeHtml(lastBook)} ${escapeHtml(ref)}</a>`;
    } else if (m[3]) {
      // "ch:vs" (no book) — use lastBook if present
      const ref = m[3];
      if (lastBook) {
        const q = encodeURIComponent(`${lastBook} ${ref}`);
        out += `<a href="${WOL_SEARCH_BASE}${q}" target="_blank" rel="noopener">${escapeHtml(ref)}</a>`;
      } else {
        out += escapeHtml(ref);
      }
    }
    lastIdx = REG_COMBINED.lastIndex;
  }
  out += src.slice(lastIdx);
  return out;
}

function isImageUrl(url) {
  return /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(url);
}

// --------------------------------------
// Draw (uses visibleEvents; dotted sticks; flags; top scale w/o year 0)
// --------------------------------------
function draw() {
  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  hitRegions = [];

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const topPadding = 8;
  const labelAreaHeight = 28;
  const timelineY = topPadding + labelAreaHeight;
  const rowHeight = 40;

  if (!visibleEvents || visibleEvents.length === 0) {
    ctx.fillStyle = "#000"; ctx.font = "14px Arial";
    ctx.fillText("No events", 10, timelineY + 20);
    return;
  }

  let minTs = Math.min(...visibleEvents.map(e => e.start));
  let maxTs = Math.max(...visibleEvents.map(e => e.end));
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

  // main line
  ctx.strokeStyle = "#222"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, timelineY); ctx.lineTo(W, timelineY); ctx.stroke();

  // top year labels (skip 0)
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

    const text = formatYearHuman(y); if (!text) continue;
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

    // tick
    ctx.strokeStyle = '#00000033';
    ctx.beginPath(); ctx.moveTo(x, pillY + pillH); ctx.lineTo(x, timelineY - 4); ctx.stroke();
  }

  // rows & events
  rows.forEach((row, i) => {
    const yTop = timelineY + 18 + i * rowHeight;
    row.forEach(ev => {
      const x1 = xOfTs(ev.start);
      const x2 = xOfTs(ev.end);
      const left  = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const rawWidth = right - left;

      const color = colorFor(ev);
      const stickX = (rawWidth < 10) ? x1 : left;

      // dotted stick from timeline
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = color + "AA";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(stickX, timelineY);
      ctx.lineTo(stickX, yTop + 10);
      ctx.stroke();
      ctx.restore();

      // duration bar or point
      if (rawWidth >= 10) {
        ctx.fillStyle = color;
        const barX = left, barY = yTop + 18, barW = Math.max(6, rawWidth), barH = 6;
        ctx.fillRect(barX, barY, barW, barH);
        hitRegions.push({ x: barX, y: barY - 4, w: barW, h: barH + 8, ev, kind: 'bar' });
      } else {
        const r = 4;
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(stickX, yTop + 21, r, 0, Math.PI*2);
        ctx.fill();
        hitRegions.push({ x: stickX - 6, y: yTop + 15, w: 12, h: 12, ev, kind: 'dot' });
      }

      // flag (title + date)
      const labelTitle   = ev.title || "";
      const labelDateTxt = (ev.raw && ev.raw['display date']) ? ev.raw['display date'] : formatDateHuman(ev.start);

      const lines = wrapText(ctx, labelTitle, 320, "bold 12px Arial")
                     .concat(wrapText(ctx, labelDateTxt, 320, "11px Arial"));
      const paddingX = 8, paddingY = 6, lineGap = 2;
      const lineHeights = lines.map(l => l.font.startsWith("bold") ? 13 : 12);
      const textW = Math.min(360, Math.max(...lines.map(l => ctx.measureText(l.text).width)));
      const pillW = Math.max(120, textW + paddingX * 2);
      const pillH = paddingY*2 + lineHeights.reduce((a,b)=>a+b,0) + (lines.length-1)*lineGap;

      let pillX = stickX + 10;
      if (pillX + pillW > W - 8) pillX = stickX - 10 - pillW;
      if (pillX < 4) pillX = 4;
      const pillY = yTop;

      ctx.fillStyle = "#ffffffdd";
      ctx.strokeStyle = "#00000022";
      ctx.lineWidth = 1;
      roundRect(ctx, pillX, pillY, pillW, pillH, 8, true, false);

      let ty = pillY + paddingY + (lineHeights[0] - 2);
      lines.forEach((ln, idx) => {
        ctx.font = ln.font;
        ctx.fillStyle = idx === 0 ? "#000" : "#333";
        ctx.fillText(ln.text, pillX + paddingX, ty);
        ty += lineHeights[idx] + lineGap;
      });

      hitRegions.push({ x: pillX, y: pillY, w: pillW, h: pillH, ev, kind: 'flag' });
    });
  });
}

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

// word wrapping for the flag text
function wrapText(ctx, text, maxWidth, font = "12px Arial") {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  ctx.font = font;
  words.forEach((w) => {
    const test = line ? (line + " " + w) : w;
    if (ctx.measureText(test).width > maxWidth && line) {
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
// Interaction: panning + click-to-view
// --------------------------------------
function onPointerDown(clientX) {
  isPanning = true;
  suppressNextClick = false;
  panStartClientX = clientX;
  panStartPanX = panX;
  canvas.style.cursor = 'grabbing';
}
function onPointerMove(clientX) {
  if (!isPanning) return;
  const dx = clientX - panStartClientX;
  if (Math.abs(dx) > 3) suppressNextClick = true;
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

// Click detection for flags/bars/dots
canvas.addEventListener('click', (e) => {
  if (suppressNextClick) { suppressNextClick = false; return; }
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  for (let i = hitRegions.length - 1; i >= 0; i--) {
    const h = hitRegions[i];
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
      showDetails(h.ev);
      return;
    }
  }
  hideDetails();
});

// --------------------------------------
// Details panel (with scripture linking and media preview)
// --------------------------------------
const detailsPanel   = document.getElementById('detailsPanel');
const detailsClose   = document.getElementById('detailsClose');
const detailsContent = document.getElementById('detailsContent');

detailsClose?.addEventListener('click', hideDetails);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideDetails(); });

function showDetails(ev) {
  if (!detailsPanel || !detailsContent) return;
  const title = ev.title || "(untitled)";
  const when  = displayWhen(ev);
  const group = groupKeyFor(ev);
  const text  = ev.text || "";

  const mediaUrl = (ev.media || "").trim();
  const mediaHtml = mediaUrl
    ? (isImageUrl(mediaUrl)
        ? `<div class="media"><img src="${escapeHtml(mediaUrl)}" alt=""></div>`
        : `<div class="media"><a href="${escapeHtml(mediaUrl)}" target="_blank" rel="noopener">Open media</a></div>`)
    : "";

  detailsContent.innerHTML = `
    <h3 id="detailsTitle">${escapeHtml(title)}</h3>
    <div class="meta">${escapeHtml(when)}${group ? ` • ${escapeHtml(group)}` : ""}</div>
    ${text ? `<p>${linkifyScripture(text)}</p>` : ""}
    ${mediaHtml}
  `;
  detailsPanel.classList.remove('hidden');
}

function hideDetails() {
  if (!detailsPanel) return;
  detailsPanel.classList.add('hidden');
}

// --------------------------------------
// Zoom buttons (use visibleEvents for bounds)
// --------------------------------------
document.getElementById('zoomIn').onclick = () => {
  const oldZoom = zoom;
  const newZoom = Math.min(maxZoom, zoom * 1.3);
  if (newZoom === oldZoom) return;

  const W = canvas.width || canvas.clientWidth;
  let minTs = visibleEvents.length ? Math.min(...visibleEvents.map(e=>e.start)) : 0;
  let maxTs = visibleEvents.length ? Math.max(...visibleEvents.map(e=>e.end))   : 1;
  if (minTs===maxTs){ minTs -= 24*3600*1000; maxTs += 24*3600*1000; }
  const span = (maxTs - minTs) || 1;

  const oldScale = (W*oldZoom)/span;
  const newScale = (W*newZoom)/span;
  panX = panX * (newScale/oldScale);

  zoom = newZoom; clampPan(); draw();
};

document.getElementById('zoomOut').onclick = () => {
  const oldZoom = zoom;
  const newZoom = Math.max(minZoom, zoom / 1.3);
  if (newZoom === oldZoom) return;

  const W = canvas.width || canvas.clientWidth;
  let minTs = visibleEvents.length ? Math.min(...visibleEvents.map(e=>e.start)) : 0;
  let maxTs = visibleEvents.length ? Math.max(...visibleEvents.map(e=>e.end))  span;
  const newScale = (W*newZoom)/span;
  panX = panX * (newScale/oldScale);

  zoom = newZoom; clampPan(); draw();
};
