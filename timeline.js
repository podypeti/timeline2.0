
// ===== Timeline.js Fully Patched Version =====
console.log('[timeline] script loaded v7');

// ===== Config =====
const MIN_YEAR = -4050;
const MAX_YEAR = 2100;
const INITIAL_CENTER_YEAR = 1;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 12000;
const AVG_YEAR_DAYS = 365.2425;

// ===== DOM =====
const canvas = document.getElementById('timelineCanvas');
const ctx = canvas.getContext('2d');
const btnZoomIn = document.getElementById('zoomIn');
const btnZoomOut = document.getElementById('zoomOut');
const btnResetFloating = document.getElementById('resetZoomFloating');
const detailsPanel = document.getElementById('detailsPanel');
const detailsClose = document.getElementById('detailsClose');
const detailsContent = document.getElementById('detailsContent');
const legendEl = document.getElementById('legend');

// ===== State =====
let dpr = Math.max(1, window.devicePixelRatio || 1);
let W = 0, H = 0;
let scale = 1;
let panX = 0;
let isDragging = false;
let dragStartX = 0;
let events = [];
let drawHitRects = [];
let groupColors = new Map();
let anchorJD = null;
let groupChips = new Map();
let activeGroups = new Set();
let filterMode = 'all';
let eventSearchTerm = '';

// ===== Utils =====
function sizeCanvasToCss() {
  const rect = canvas.getBoundingClientRect();
  W = Math.max(1, Math.floor(rect.width * dpr));
  H = Math.max(1, Math.floor(rect.height * dpr));
  canvas.width = W;
  canvas.height = H;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function formatYearHuman(y) {
  if (y < 0) return `${Math.abs(y)} BCE`;
  if (y > 0) return `${y} CE`;
  return '1 CE';
}
function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360},65%,45%)`;
}
function getGroupColor(group) {
  const g = (group ?? '').trim();
  if (!g) return '#0077ff';
  if (!groupColors.has(g)) groupColors.set(g, hashColor(g));
  return groupColors.get(g);
}
function xForYear(yearFloat) { return (yearFloat - MIN_YEAR) * scale + panX; }
function yearForX(x) { return MIN_YEAR + (x - panX) / scale; }
function isGroupVisible(group) {
  const g = (group ?? '').trim();
  if (filterMode === 'all') return true;
  if (filterMode === 'none') return false;
  return activeGroups.has(g);
}

// ===== CSV Loader =====
async function loadCsv(url) {
  const res = await fetch(url);
  const text = await res.text();
  return parseCSV(text);
}
function parseCSV(text) {
  const rows = [];
  let header = null;
  let i = 0, len = text.length;
  let cur = '';
  let row = [];
  let inQuotes = false;
  while (i < len) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { cur += '"'; i += 2; continue; }
      inQuotes = !inQuotes; i++; continue;
    }
    if (ch === ',' && !inQuotes) { row.push(cur); cur = ''; i++; continue; }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (!header) {
        header = row.map(s => s.trim());
      } else {
        const obj = {}; for (let j = 0; j < header.length; j++) obj[header[j]] = (row[j] ?? '').trim();
        rows.push(obj);
      }
      row = []; i++; continue;
    }
    cur += ch; i++;
  }
  row.push(cur);
  if (!header) header = row.map(s => s.trim());
  else if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
    const obj = {}; for (let j = 0; j < header.length; j++) obj[header[j]] = (row[j] ?? '').trim();
    rows.push(obj);
  }
  return rows;
}

// ===== Legend =====
function addAdminChip(label, onClick, color) {
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.dataset.admin = label.toLowerCase();
  const sw = document.createElement('span');
  sw.className = 'swatch';
  sw.style.background = color;
  const text = document.createElement('span');
  text.textContent = label;
  chip.appendChild(sw);
  chip.appendChild(text);
  chip.addEventListener('click', onClick);
  legendEl.appendChild(chip);
}
function getGroupIcon(group) {
  const g = (group ?? '').trim();
  const map = {
    'Bible writing': '📚',
    'Bible copy/translation': '📜',
    'Events': '⭐',
    'Persons': '👤',
    'Covenants': '📜',
    'Judges': '⚖️',
    'Kings of Israel': '👑',
    'Kings of Judah': '👑',
    'Prophets': '📖',
    'World powers': '🌍',
    'Jesus': '👑🧔',
    'Time periods': '⏳',
    'Modern day history of JW': '🕊️',
    'King of the North': '⬆️',
    'King of the South': '⬇️',
    "Paul's journeys": '🛤️',
  };
  return map[g] || '•';
}
function buildLegend() {
  const groups = [...new Set(events.map(e => (e['Group'] ?? '').trim()).filter(Boolean))].sort();
  legendEl.innerHTML = '';
  groupChips.clear();
  filterMode = 'all';
  activeGroups = new Set(groups);

  // Remove All button, keep None
  addAdminChip('None', () => {
    activeGroups.clear();
    filterMode = 'none';
    groupChips.forEach(chip => chip.classList.add('inactive'));
    draw();
  }, '#c33');

  groups.forEach(g => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.group = g;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = getGroupColor(g);
    const icon = document.createElement('span');
    icon.className = 'chip-icon';
    icon.textContent = getGroupIcon(g);
    const label = document.createElement('span');
    label.textContent = g;
    chip.append(sw, icon, label);
    chip.addEventListener('click', () => {
      filterMode = 'custom';
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
    groupChips.set(g, chip);
  });

  const search = document.getElementById('legendSearch');
  if (search && !search._wired) {
    search.addEventListener('input', e => {
      const term = e.target.value.toLowerCase();
      groupChips.forEach((chip, group) => {
        chip.style.display = group.toLowerCase().includes(term) ? 'inline-flex' : 'none';
      });
    });
    search._wired = true;
  }

  const es = document.getElementById('eventSearch');
  if (es && !es._wired) {
    let timer = null;
    es.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        eventSearchTerm = es.value || '';
        draw();
      }, 120);
    });
    es._wired = true;
  }
}

// ===== Reset =====
function resetAll() {
  const es = document.getElementById('eventSearch');
  if (es) es.value = '';
  eventSearchTerm = '';

  const groups = [...new Set(events.map(e => (e['Group'] ?? '').trim()).filter(Boolean))];
  activeGroups = new Set(groups);
  filterMode = 'all';
  groupChips.forEach(chip => chip.classList.remove('inactive'));

  const ls = document.getElementById('legendSearch');
  if (ls) {
    ls.value = '';
    groupChips.forEach(chip => chip.style.display = 'inline-flex');
  }

  const legendDetails = document.querySelector('.legend-panel');
  if (legendDetails) legendDetails.open = false;

  initScaleAndPan();
  draw();
}
if (btnResetFloating) btnResetFloating.addEventListener('click', resetAll);

// ===== Init Scale =====
function initScaleAndPan() {
  sizeCanvasToCss();
  scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, canvas.clientWidth / (MAX_YEAR - MIN_YEAR)));
  panX = (canvas.clientWidth / 2) - ((INITIAL_CENTER_YEAR - MIN_YEAR) * scale);
}

// ===== Draw =====
function draw() {
  sizeCanvasToCss();
  ctx.clearRect(0, 0, W, H);
  drawHitRects = [];
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  // ticks
  ctx.strokeStyle = '#00000033';
  ctx.beginPath();
  ctx.moveTo(W / dpr / 2, 0);
  ctx.lineTo(W / dpr / 2, H / dpr);
  ctx.stroke();

  const centerYear = yearForX(canvas.clientWidth / 2);

  // ticks labels
  ctx.font = '14px sans-serif';
  ctx.textBaseline = 'top';
  const step = 500;
  for (let t = MIN_YEAR; t <= MAX_YEAR; t += step) {
    const x = xForYear(t);
    if (x > -100 && x < W / dpr + 100) {
      ctx.fillStyle = '#000';
      ctx.fillText(formatYearHuman(t), x - 20, 16);
    }
  }

  // events
  events.forEach(ev => {
    const group = (ev['Group'] ?? '').trim();
    if (!isGroupVisible(group)) return;
    if (eventSearchTerm && !matchesEventSearch(ev, eventSearchTerm)) return;

    const baseYear = parseInt(ev['Year'], 10);
    if (!Number.isFinite(baseYear)) return;
    const x = xForYear(baseYear);
    if (x > -50 && x < W / dpr + 50) {
      ctx.fillStyle = getGroupColor(group);
      ctx.beginPath();
      ctx.arc(x, 100, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function matchesEventSearch(ev, term) {
  if (!term) return true;
  const t = term.trim().toLowerCase();
  if (!t) return true;
  const fields = [ev['Headline'], ev['Text'], ev['Display Date'], ev['Type'], ev['Group']];
  return fields.some(f => (f ?? '').toLowerCase().includes(t));
}

// ===== Controls =====
if (btnZoomIn) btnZoomIn.addEventListener('click', () => { scale *= 1.3; draw(); });
if (btnZoomOut) btnZoomOut.addEventListener('click', () => { scale /= 1.3; draw(); });
canvas.addEventListener('mousedown', e => { isDragging = true; dragStartX = e.clientX; });
window.addEventListener('mousemove', e => { if (isDragging) { panX += (e.clientX - dragStartX); dragStartX = e.clientX; draw(); } });
window.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('wheel', e => { e.preventDefault(); scale *= e.deltaY < 0 ? 1.1 : 0.9; draw(); }, { passive: false });

window.addEventListener('resize', draw);
