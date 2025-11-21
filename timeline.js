// ===== Configuration =====
const minZoom = 0.2;
const maxZoom = 500; // allow deep zoom for months/days
const LABEL_ANCHOR_YEAR = -5000; // start ticks from 5000 BCE
const INITIAL_CENTER_YEAR = -4000; // center view near 4000 BCE

// ===== Canvas and state =====
const canvas = document.getElementById('timelineCanvas');
const ctx = canvas.getContext('2d');
let W, H;
let scale; // pixels per year
let panX = 0;
let isDragging = false;
let dragStartX = 0;

// ===== Timeline range =====
const minYear = -5000;
const maxYear = 2100;

// ===== Utility functions =====
function formatYearHuman(y) {
  return y < 0 ? `${Math.abs(y)} BCE` : `${y}`;
}

function chooseTickScale(pxPerYear) {
  if (pxPerYear >= 120) return { unit: 'year', step: 1 };
  if (pxPerYear >= 40) return { unit: 'year', step: 10 };
  if (pxPerYear >= 12) return { unit: 'year', step: 100 };
  return { unit: 'year', step: 1000 };
}

// ===== Main draw function =====
function draw() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  ctx.clearRect(0, 0, W, H);

  const { unit, step } = chooseTickScale(scale);
  let t = Math.ceil((minYear - LABEL_ANCHOR_YEAR) / step) * step + LABEL_ANCHOR_YEAR;
  let lastRight = -Infinity;
  const gap = 10;

  while (t < maxYear) {
    const x = (t - minYear) * scale + panX;
    if (x > -50 && x < W + 50) {
      const text = formatYearHuman(t);
      ctx.font = '14px sans-serif';
      const pillW = ctx.measureText(text).width + 10;
      const pillH = 20;
      const pillY = 30;
      if (x - pillW / 2 > lastRight + gap) {
        ctx.fillStyle = '#ffffffee';
        ctx.strokeStyle = '#00000022';
        ctx.beginPath();
        ctx.roundRect(x - pillW / 2, pillY, pillW, pillH, 6);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x - pillW / 2 + 5, pillY + pillH / 2);
        lastRight = x + pillW / 2;
      }
    }
    t += step;
  }
}

// ===== Initialization =====
function init() {
  scale = window.innerWidth / (maxYear - minYear); // fit entire timeline
  panX = (window.innerWidth / 2) - ((INITIAL_CENTER_YEAR - minYear) * scale);
  draw();
}
init();

// ===== Zoom controls =====
function zoomIn() {
  scale = Math.min(scale * 1.3, maxZoom);
  draw();
}
function zoomOut() {
  scale = Math.max(scale / 1.3, minZoom);
  draw();
}
document.getElementById('zoomIn').addEventListener('click', zoomIn);
document.getElementById('zoomOut').addEventListener('click', zoomOut);
document.getElementById('resetZoom').addEventListener('click', init);

// ===== Mouse wheel zoom =====
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  scale = Math.min(Math.max(scale * zoomFactor, minZoom), maxZoom);
  draw();
});

// ===== Drag-to-pan =====
canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragStartX = e.clientX;
});
canvas.addEventListener('mousemove', (e) => {
  if (isDragging) {
    panX += e.clientX - dragStartX;
    dragStartX = e.clientX;
    draw();
  }
});
canvas.addEventListener('mouseup', () => isDragging = false);
canvas.addEventListener('mouseleave', () => isDragging = false);

// ===== Responsive redraw =====
window.addEventListener('resize', () => {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  draw();
});
