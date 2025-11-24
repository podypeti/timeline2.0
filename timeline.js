
// ===== Modern Category Dropdown Integration =====

// Global variables for filtering
const legendEl = document.getElementById('legend');
const groupChips = new Map();
let activeGroups = new Set();
let filterMode = 'all';

// Example categories (replace with dynamic data if needed)
const groups = ['History', 'War', 'Religion', 'Science', 'Art'];

function getGroupIcon(group) {
  const iconMap = {
    'History': '📜',
    'War': '⚔️',
    'Religion': '⛪',
    'Science': '🔬',
    'Art': '🎨'
  };
  return iconMap[group] || '📌';
}

function getGroupColor(group) {
  const colorMap = {
    'History': '#f4c542',
    'War': '#d9534f',
    'Religion': '#5bc0de',
    'Science': '#5cb85c',
    'Art': '#f0ad4e'
  };
  return colorMap[group] || '#999';
}

// Build modern legend UI
function buildLegend() {
  legendEl.innerHTML = '';
  groupChips.clear();

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

    chip.appendChild(sw);
    chip.appendChild(icon);
    chip.appendChild(label);

    chip.addEventListener('click', () => {
      filterMode = 'custom';
      if (activeGroups.has(g)) {
        activeGroups.delete(g);
        chip.classList.add('inactive');
      } else {
        activeGroups.add(g);
        chip.classList.remove('inactive');
      }
      draw(); // Keep original draw() logic
    });

    legendEl.appendChild(chip);
    groupChips.set(g, chip);
    activeGroups.add(g);
  });
}

// Initialize legend
buildLegend();

// Search filter
const searchInput = document.getElementById('legendSearch');
searchInput.addEventListener('input', e => {
  const term = e.target.value.toLowerCase();
  groupChips.forEach((chip, group) => {
    chip.style.display = group.toLowerCase().includes(term) ? 'inline-flex' : 'none';
  });
});

// Admin chips
const allChip = document.querySelector('[data-admin="all"]');
const noneChip = document.querySelector('[data-admin="none"]');

allChip.addEventListener('click', () => {
  activeGroups = new Set(groups);
  filterMode = 'all';
  groupChips.forEach(chip => chip.classList.remove('inactive'));
  draw();
});

noneChip.addEventListener('click', () => {
  activeGroups.clear();
  filterMode = 'none';
  groupChips.forEach(chip => chip.classList.add('inactive'));
  draw();
});

// ===== Filtering Logic =====
function isGroupVisible(group) {
  return filterMode === 'all' || activeGroups.has(group);
}

// Keep your existing draw() and other timeline logic unchanged.
