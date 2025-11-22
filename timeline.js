
// ===== Timeline config =====
const MIN_YEAR = -5000;
const MAX_YEAR = 2100;
const INITIAL_CENTER_YEAR = -4000;            // első nézet középpontja
const MIN_ZOOM = 0.2;                          // px / év
const MAX_ZOOM = 500;                          // px / év
const LABEL_ANCHOR_YEAR = -5000;               // év feliratozás kezdő horgonya

// ===== DOM =====
const canvas = document.getElementById('timelineCanvas');
const ctx = canvas.getContext('2d');
const legendEl = document.getElementById('legend');
const btnZoomIn = document.getElementById('zoomIn');
const btnZoomOut = document.getElementById('zoomOut');
const btnReset = document.getElementById('resetZoom');
const detailsPanel = document.getElementById('detailsPanel');
const detailsClose = document.getElementById('detailsClose');
const detailsContent = document.getElementById('detailsContent');

// ===== State =====
let dpr = Math.max(1, window.devicePixelRatio || 1);
let W = 0, H = 0;               // canvas pixeles mérete (backing store)
let scale = 1;                  // px / év
let panX = 0;                   // vízszintes eltolás (px)
let isDragging = false;
let dragStartX = 0;
let events = [];                // CSV-ből betöltött események
let drawPoints = [];            // képernyő-koordináták hit-testhez (pontok és sávok)
let activeGroups = new Set();   // legend szűrés (ha üres: minden aktív)
let groupColors = new Map();    // Group -> szín

// ===== Utils =====
function sizeCanvasToCss() {
  // a látható méret (CSS) alapján állítjuk a rajzoló buffer méretét (retina dpr-rel)
  const rect = canvas.getBoundingClientRect();
  W = Math.max(1, Math.floor(rect.width * dpr));
  H = Math.max(1, Math.floor(rect.height * dpr));
  canvas.width = W;
  canvas.height = H;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // minden rajz dpr-ben
}

function formatYearHuman(y) {
  return y < 0 ? `${Math.abs(y)} BCE` : `${y}`;
}

function chooseTickScale(pxPerYear) {
  if (pxPerYear >= 120) return { step: 1 };
  if (pxPerYear >= 40)  return { step: 10 };
  if (pxPerYear >= 12)  return { step: 100 };
  return { step: 1000 };
}

function hashColor(str) {
  // determinisztikus HSL szín a Group alapján
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

function getGroupColor(group) {
  if (!group) return '#0077ff';
  if (!groupColors.has(group)) groupColors.set(group, hashColor(group));
  return groupColors.get(group);
}

function xForYear(year) {
  return (year - MIN_YEAR) * scale + panX;
}

function yearForX(x) {
  return MIN_YEAR + (x - panX) / scale;
}

// ===== Rounded-rect fallback (Path2D) =====
function roundedRectPath(x, y, w, h, r) {
  const p = new Path2D();
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.quadraticCurveTo(x + w, y, x + w, y + rr);
  p.lineTo(x + w, y + h - rr);
  p.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  p.lineTo(x + rr, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - rr);
  p.lineTo(x, y + rr);
  p.quadraticCurveTo(x, y, x + rr, y);
  return p;
}

function fillStrokeRoundedRect(x, y, w, h, r, fillStyle, strokeStyle) {
  const path = (Path2D.prototype.roundRect)
    ? (() => { const p = new Path2D(); p.roundRect(x, y, w, h, r); return p; })()
    : roundedRectPath(x, y, w, h, r);
  if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(path); }
  if (strokeStyle) { ctx.strokeStyle = strokeStyle; ctx.stroke(path); }
}

// ===== CSV parsing (quoted commas supported) =====
async function loadCsv(url) {
  const res = await fetch(url);
  const text = await res.text();
  return parseCSV(text);
}

function parseCSV(text) {
  // normálizálás
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const header = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = splitCsvLine(line);
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      const key = header[j].trim();
      const val = (cols[j] ?? '').trim().replace(/^"|"$/g, '');
      obj[key] = val;
    }
    rows.push(obj);
  }
  return rows;
}

function splitCsvLine(line) {
  // vesszők idézőjelek között ne váljanak el
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// ===== Legend (Groups) =====
function buildLegend() {
  const groups = [...new Set(events.map(e => e['Group']).filter(Boolean))].sort();
  legendEl.innerHTML = '';
  groups.forEach(g => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.group = g;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = getGroupColor(g);
    const label = document.createElement('span');
    label.textContent = g;
    chip.appendChild(sw);
    chip.appendChild(label);
    chip.addEventListener('click', () => {
      if (activeGroups.has(g)) {
        activeGroups.delete(g);
        chip.classList.add('inactive');
      } else {
        activeGroups.add(g);
        chip.classList.remove('inactive');
      }
      draw();
    });
    legendEl.appendChild(chip);
    // kezdetben minden aktív
    activeGroups.add(g);
  });
}

// ===== Details panel =====
function showDetails(ev) {
  const displayDate = ev['Display Date'] || formatYearHuman(parseInt(ev['Year'], 10));
  const headline = ev['Headline'] || '';
  const text = ev['Text'] || '';
  const media = ev['Media'] || '';
  const credit = ev['Media Credit'] || '';
  const caption = ev['Media Caption'] || '';
  detailsContent.innerHTML = `
    <h3>${escapeHtml(headline)}</h3>
    <div class="meta">${escapeHtml(displayDate)}${ev['Type'] ? ' • ' + escapeHtml(ev['Type']) : ''}${ev['Group'] ? ' • ' + escapeHtml(ev['Group']) : ''}</div>
    ${media ? `<div class="media">${escapeAttr(media)}</div>` : ''}
    ${caption ? `<p><em>${escapeHtml(caption)}</em></p>` : ''}
    ${text ? `<p>${text}</p>` : ''}
    ${credit ? `<p class="meta">${escapeHtml(credit)}</p>` : ''}
  `;
  detailsPanel.classList.remove('hidden');
}

function hideDetails() {
  detailsPanel.classList.add('hidden');
  detailsContent.innerHTML = '';
}

detailsClose.addEventListener('click', hideDetails);

// ===== HTML escape helpers =====
function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

// ===== Main draw =====
function draw() {
  sizeCanvasToCss();
  ctx.clearRect(0, 0, W, H);
  drawPoints = [];

  // háttér
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // skála és év-címkék
  ctx.save();
  ctx.font = '14px sans-serif';
  const { step } = chooseTickScale(scale);
  let t = Math.ceil((MIN_YEAR - LABEL_ANCHOR_YEAR) / step) * step + LABEL_ANCHOR_YEAR;
  let lastRight = -Infinity;
  const gap = 12;
  const pillY = 16;
  while (t < MAX_YEAR) {
    const x = xForYear(t);
    if (x > -80 && x < W + 80) {
      // tick vonal
      ctx.strokeStyle = '#00000022';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 40);
      ctx.stroke();

      // év "pill"
      const text = formatYearHuman(t);
      const pillW = ctx.measureText(text).width + 10;
      const pillH = 20;
      if (x - pillW / 2 > lastRight + gap) {
        fillStrokeRoundedRect(x - pillW / 2, pillY, pillW, pillH, 6, '#ffffffee', '#00000022');
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x - pillW / 2 + 5, pillY + pillH / 2);
        lastRight = x + pillW / 2;
      }
    }
    t += step;
  }
  ctx.restore();

  // középvonal
  ctx.strokeStyle = '#00000033';
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();

  // esemény-sáv Y pozíciók
  const rowYPoint = 110;    // pontok sora
  const rowYBar   = 180;    // időszakok (Year..End Year) sora

  // események kirajzolása
  ctx.textBaseline = 'top';
  ctx.font = '14px sans-serif';

  events.forEach(ev => {
    const group = ev['Group'] || '';
    // szűrés: ha van legend és a group inaktív, ugorjuk
    if (activeGroups.size && !activeGroups.has(group)) return;

    const col = getGroupColor(group);

    const yVal = parseInt(ev['Year'], 10);
    const endYVal = parseInt(ev['End Year'], 10);
    const title = ev['Headline'] || ev['Text'] || '';

    if (Number.isFinite(yVal) && Number.isFinite(endYVal)) {
      // időszak (sáv)
      const x1 = xForYear(yVal);
      const x2 = xForYear(endYVal);
      const xL = Math.min(x1, x2);
      const xR = Math.max(x1, x2);
      if (xR > -50 && xL < W + 50) {
        ctx.fillStyle = col.replace('45%', '85%'); // világosabb a sáv
        fillStrokeRoundedRect(xL, rowYBar, Math.max(4, xR - xL), 16, 8, ctx.fillStyle, '#00000022');
        // cím a sáv végén
        if (title) {
          ctx.fillStyle = '#111';
          ctx.fillText(title, xR + 8, rowYBar);
        }
        // hit-test rect
        drawPoints.push({ kind: 'bar', ev, x: xL, y: rowYBar, w: Math.max(4, xR - xL), h: 16 });
      }
    } else if (Number.isFinite(yVal)) {
      // pont
      const x = xForYear(yVal);
      if (x > -50 && x < W + 50) {
        // pont
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, rowYPoint, 5, 0, Math.PI * 2);
        ctx.fill();
        // cím
        if (title) {
          ctx.fillStyle = '#111';
          ctx.fillText(title, x + 8, rowYPoint + 8);
        }
        // hit-test kör (egyszerűsítve négyzetre)
        drawPoints.push({ kind: 'point', ev, x: x - 6, y: rowYPoint - 6, w: 12, h: 12 });
      }
    }
  });
}

// ===== Initialization =====
function initScaleAndPan() {
  sizeCanvasToCss();
  // Alap skála: látszódjon egy nagy tartomány, de ne legyen túl kicsi
  scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, canvas.clientWidth / (MAX_YEAR - MIN_YEAR)));
  // középre igazítás az INITIAL_CENTER_YEAR körül
  panX = (canvas.clientWidth / 2) - ((INITIAL_CENTER_YEAR - MIN_YEAR) * scale);
}

async function init() {
  initScaleAndPan();
  // CSV betöltés
  try {
    events = await loadCsv('timeline-data.csv');
  } catch (e) {
    console.error('CSV betöltési hiba:', e);
    events = [];
  }
  buildLegend();
  draw();
}

init();

// ===== Zoom controls =====
function zoomTo(newScale, anchorX = canvas.clientWidth / 2) {
  // Kurzor-központú zoom: az anchorX alatti év maradjon ugyanott
  const anchorYear = yearForX(anchorX);
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
  const oldScale = scale;
  scale = clamped;
  // állítsuk a panX-et úgy, hogy anchorYear ugyanott legyen:
  // anchorX = (anchorYear - MIN_YEAR) * scale + panX
  panX = anchorX - (anchorYear - MIN_YEAR) * scale;
  // kicsi simítás: ha túl nagy változás, limitáljuk
  draw();
}

function zoomIn(anchorX) { zoomTo(scale * 1.3, anchorX); }
function zoomOut(anchorX) { zoomTo(scale / 1.3, anchorX); }

btnZoomIn.addEventListener('click', () => zoomIn(canvas.clientWidth / 2));
btnZoomOut.addEventListener('click', () => zoomOut(canvas.clientWidth / 2));
btnReset.addEventListener('click', () => { initScaleAndPan(); draw(); });

// egérgörgő zoom (passive:false, hogy preventDefault működjön)
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const anchor = (e.offsetX ?? (e.clientX - canvas.getBoundingClientRect().left));
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  zoomTo(scale * zoomFactor, anchor);
}, { passive: false });

// ===== Drag-to-pan =====
canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragStartX = e.clientX;
});
window.addEventListener('mousemove', (e) => {
  if (isDragging) {
    panX += (e.clientX - dragStartX);
    dragStartX = e.clientX;
    draw();
  }
});
window.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; });

// Touch (alap) – egyujjas húzás
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    isDragging = true;
    dragStartX = e.touches[0].clientX;
  }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (isDragging && e.touches.length === 1) {
    panX += (e.touches[0].clientX - dragStartX);
    dragStartX = e.touches[0].clientX;
    draw();
  }
}, { passive: true });
canvas.addEventListener('touchend', () => { isDragging = false; });

// ===== Hit test (kattintás a pontokra / sávokra) =====
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * dpr;
  const y = (e.clientY - rect.top) * dpr;
  // végigmegyünk a drawPoints tömbön
  for (let i = drawPoints.length - 1; i >= 0; i--) {
    const p = drawPoints[i];
    const px1 = p.x * dpr, py1 = p.y * dpr, pw = p.w * dpr, ph = p.h * dpr;
    if (x >= px1 && x <= px1 + pw && y >= py1 && y <= py1 + ph) {
      showDetails(p.ev);
      return;
    }
  }
});

// ===== Responsive redraw =====
window.addEventListener('resize', () => { draw(); });
