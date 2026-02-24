/* =============================================================
   collection.js — My Vault page
   Depends on: utils.js, api.js
   ============================================================= */
'use strict';

let allCards     = [];
let editingEntry = null;

// ---- DOM refs ----
const collSearch  = document.getElementById('coll-search');
const collSort    = document.getElementById('coll-sort');
const collGrid    = document.getElementById('coll-grid');
const collCount   = document.getElementById('coll-count');
const filterPanel = document.querySelector('.filter-panel');
const filterOverlay = document.getElementById('filter-overlay');

// Edit modal
const editModal     = document.getElementById('edit-modal');
const editOverlay   = document.getElementById('edit-modal-overlay');
const editClose     = document.getElementById('edit-modal-close');
const editImg       = document.getElementById('edit-img');
const editName      = document.getElementById('edit-name');
const editType      = document.getElementById('edit-type');
const editQty       = document.getElementById('edit-qty');
const editCondition = document.getElementById('edit-condition');
const editFoil      = document.getElementById('edit-foil');
const editSaveBtn   = document.getElementById('edit-save-btn');
const editRemoveBtn = document.getElementById('edit-remove-btn');

// ---- Mobile drawer ----
document.getElementById('filter-toggle-btn').addEventListener('click', () => {
  filterPanel.classList.toggle('drawer-open');
  filterOverlay.classList.toggle('visible');
});
filterOverlay.addEventListener('click', () => {
  filterPanel.classList.remove('drawer-open');
  filterOverlay.classList.remove('visible');
});

// ---- Load + render ----
async function loadCollection() {
  try {
    allCards = await VaultAPI.collection.getAll();
  } catch (e) {
    collGrid.innerHTML = `
      <div class="empty-state error-state">
        <p class="empty-title">The Dark Forces Intervene</p>
        <p class="empty-text">${escapeHtml(e.message)}</p>
      </div>`;
    return;
  }
  applyFilters();
  updateStats(allCards);
}

function applyFilters() {
  const text      = collSearch.value.toLowerCase().trim();
  const rarities  = [...document.querySelectorAll('.rarity-filter:checked')].map(c => c.value);
  const conds     = [...document.querySelectorAll('.cond-filter:checked')].map(c => c.value);
  const sortBy    = collSort.value;

  let filtered = allCards.filter(c => {
    if (text && !c.name.toLowerCase().includes(text)) return false;
    if (rarities.length && !rarities.includes(c.rarity)) return false;
    if (conds.length && !conds.includes(c.condition)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'qty')    return b.quantity - a.quantity;
    if (sortBy === 'rarity') {
      const order = { mythic:0, rare:1, uncommon:2, common:3 };
      return (order[a.rarity] ?? 4) - (order[b.rarity] ?? 4);
    }
    if (sortBy === 'added')  return new Date(b.added_at) - new Date(a.added_at);
    return a.name.localeCompare(b.name);
  });

  renderGrid(filtered);
  collCount.textContent = `${filtered.length} / ${allCards.length} relics`;
}

function renderGrid(cards) {
  collGrid.innerHTML = '';
  if (!cards.length) {
    collGrid.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No Relics Found</p>
        <p class="empty-text">Your vault contains no cards matching this filter.</p>
      </div>`;
    return;
  }

  for (const entry of cards) {
    const item = document.createElement('div');
    item.className = `coll-card rarity-${entry.rarity}`;

    item.innerHTML = `
      <img src="${escapeHtml(entry.image_uri)}" alt="${escapeHtml(entry.name)}" loading="lazy" />
      ${entry.foil ? '<span class="coll-badge foil-badge">FOIL</span>' : ''}
      <span class="coll-badge cond-badge">${escapeHtml(entry.condition)}</span>
      <span class="coll-badge qty-badge">&#215;${entry.quantity}</span>`;

    item.addEventListener('click', () => openEditModal(entry));
    collGrid.appendChild(item);
  }
}

function updateStats(cards) {
  const unique = cards.length;
  const total  = cards.reduce((sum, c) => sum + c.quantity, 0);

  document.getElementById('stat-unique').textContent      = unique.toLocaleString();
  document.getElementById('stat-total-count').textContent = total.toLocaleString();

  const clr  = { w:0, u:0, b:0, r:0, g:0 };
  const rar  = { common:0, uncommon:0, rare:0, mythic:0 };
  let foil   = 0;

  for (const c of cards) {
    // Use mana_cost to infer colors (simple heuristic)
    const mc = (c.mana_cost || '').toUpperCase();
    if (mc.includes('W')) clr.w++;
    if (mc.includes('U')) clr.u++;
    if (mc.includes('B') && !mc.includes('BG') && !mc.includes('BR') || mc.includes('{B}')) clr.b++;
    if (mc.includes('R')) clr.r++;
    if (mc.includes('G')) clr.g++;
    if (c.rarity in rar) rar[c.rarity]++;
    if (c.foil) foil++;
  }

  const set = (id, val) => { document.getElementById(id).textContent = val || '—'; };
  set('stat-w', clr.w); set('stat-u', clr.u); set('stat-b', clr.b); set('stat-r', clr.r); set('stat-g', clr.g);
  set('stat-common', rar.common); set('stat-uncommon', rar.uncommon);
  set('stat-rare', rar.rare); set('stat-mythic', rar.mythic);
  set('stat-foil', foil);
}

// ---- Edit modal ----
function openEditModal(entry) {
  editingEntry = entry;
  editImg.src           = entry.image_uri;
  editImg.alt           = entry.name;
  editName.textContent  = entry.name;
  editType.textContent  = entry.type_line || '';
  editQty.value         = entry.quantity;
  editCondition.value   = entry.condition || 'NM';
  editFoil.checked      = !!entry.foil;
  editModal.classList.remove('hidden');
}

function closeEditModal() {
  editModal.classList.add('hidden');
  editingEntry = null;
}

editClose.addEventListener('click', closeEditModal);
editOverlay.addEventListener('click', closeEditModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEditModal(); });

document.getElementById('qty-minus').addEventListener('click', () => {
  const v = parseInt(editQty.value, 10);
  if (v > 1) editQty.value = v - 1;
});
document.getElementById('qty-plus').addEventListener('click', () => {
  editQty.value = parseInt(editQty.value, 10) + 1;
});

editSaveBtn.addEventListener('click', async () => {
  if (!editingEntry) return;
  try {
    await VaultAPI.collection.update(editingEntry.id, {
      quantity:  parseInt(editQty.value, 10),
      condition: editCondition.value,
      foil:      editFoil.checked ? 1 : 0,
    });
    showFlash('Changes saved');
    closeEditModal();
    await loadCollection();
  } catch (e) { showFlash(e.message, 'error'); }
});

editRemoveBtn.addEventListener('click', async () => {
  if (!editingEntry) return;
  try {
    await VaultAPI.collection.remove(editingEntry.id);
    showFlash(`${editingEntry.name} removed from vault`);
    closeEditModal();
    await loadCollection();
  } catch (e) { showFlash(e.message, 'error'); }
});

// ---- Event listeners ----
document.getElementById('coll-filter-btn').addEventListener('click', applyFilters);
document.getElementById('coll-clear-btn').addEventListener('click', () => {
  collSearch.value = '';
  document.querySelectorAll('.rarity-filter, .cond-filter').forEach(cb => { cb.checked = false; });
  collSort.value = 'name';
  applyFilters();
});
collSearch.addEventListener('input', debounce(applyFilters, 280));
collSort.addEventListener('change', applyFilters);

// ---- Init ----
loadCollection();
