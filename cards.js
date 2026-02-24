/* ==========================================================
   cards.js — Search page logic
   Depends on: utils.js, api.js (loaded before this file)
   ========================================================== */
'use strict';

const API_SCRYFALL = 'https://api.scryfall.com';

// ---- State ----
const state = { page: 1, query: '', loading: false, activeCard: null };

// ---- DOM refs (search) ----
const searchInput  = document.getElementById('search-input');
const setInput     = document.getElementById('set-input');
const sortSelect   = document.getElementById('sort-select');
const searchBtn    = document.getElementById('search-btn');
const randomBtn    = document.getElementById('random-btn');
const cardGrid     = document.getElementById('card-grid');
const loadingEl    = document.getElementById('loading');
const resultCount  = document.getElementById('result-count');
const pagination   = document.getElementById('pagination');
const tooltip      = document.getElementById('card-tooltip');

// ---- DOM refs (modal) ----
const cardModal        = document.getElementById('card-modal');
const modalOverlay     = document.getElementById('modal-overlay');
const modalClose       = document.getElementById('modal-close');
const modalImg         = document.getElementById('modal-img');
const modalName        = document.getElementById('modal-name');
const modalMana        = document.getElementById('modal-mana');
const modalType        = document.getElementById('modal-type');
const modalText        = document.getElementById('modal-text');
const modalFlavor      = document.getElementById('modal-flavor');
const modalPt          = document.getElementById('modal-pt');
const modalMeta        = document.getElementById('modal-meta');
const modalQty         = document.getElementById('modal-qty');
const modalCondition   = document.getElementById('modal-condition');
const modalFoil        = document.getElementById('modal-foil');
const btnAddCollection = document.getElementById('btn-add-collection');
const btnAddWishlist   = document.getElementById('btn-add-wishlist');
const btnAddDeck       = document.getElementById('btn-add-deck');
const modalDeckSelect  = document.getElementById('modal-deck-select');

// ---- DOM refs (mobile drawer) ----
const filterPanel      = document.querySelector('.filter-panel');
const filterOverlay    = document.getElementById('filter-overlay');
const filterToggleBtn  = document.getElementById('filter-toggle-btn');

// ---- Mobile drawer ----
filterToggleBtn.addEventListener('click', () => {
  filterPanel.classList.toggle('drawer-open');
  filterOverlay.classList.toggle('visible');
});
filterOverlay.addEventListener('click', () => {
  filterPanel.classList.remove('drawer-open');
  filterOverlay.classList.remove('visible');
});

// ---- Query builder ----
function buildQuery() {
  const parts = [];
  const text = searchInput.value.trim();
  if (text) parts.push(text);

  const colors = [...document.querySelectorAll('.color-filter:checked')].map(c => c.value);
  if (colors.length) parts.push(`c:${colors.join('')}`);

  const types = [...document.querySelectorAll('.type-filter:checked')].map(c => c.value);
  types.forEach(t => parts.push(`t:${t}`));

  const set = setInput.value.trim();
  if (set) parts.push(`e:${set}`);

  return parts.length ? parts.join(' ') : 'game:paper';
}

// ---- Scryfall fetch ----
async function fetchCards(query, page = 1) {
  const order = sortSelect.value;
  const url   = `${API_SCRYFALL}/cards/search?q=${encodeURIComponent(query)}&order=${order}&page=${page}`;
  const res   = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.details || `Search failed (${res.status})`);
  }
  return res.json();
}

async function fetchRandomSet() {
  const res  = await fetch(`${API_SCRYFALL}/cards/random`);
  if (!res.ok) throw new Error('Could not summon a random card.');
  const card = await res.json();
  return fetchCards(`e:${card.set}`);
}

// ---- Render card grid ----
function renderCards(cards) {
  cardGrid.innerHTML = '';
  if (!cards.length) {
    cardGrid.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No Relics Found</p>
        <p class="empty-text">The vault contains nothing matching your query.</p>
      </div>`;
    return;
  }

  for (const card of cards) {
    const imgSrc = getImageUri(card);
    const item   = document.createElement('div');
    item.className = `card-item rarity-${card.rarity}`;

    item.innerHTML = `
      <img src="${imgSrc}" alt="${escapeHtml(card.name)}" loading="lazy" />
      <div class="card-name-overlay">${escapeHtml(card.name)}</div>`;

    item.addEventListener('mouseenter', e => showTooltip(card, e));
    item.addEventListener('mouseleave', hideTooltip);
    item.addEventListener('click',      () => openModal(card));

    cardGrid.appendChild(item);
  }
}

// ---- Hover tooltip ----
function showTooltip(card, e) {
  const ttName   = document.getElementById('tt-name');
  ttName.className   = `tooltip-name rarity-${card.rarity}`;
  ttName.textContent = card.name;

  document.getElementById('tt-mana').innerHTML  = renderMana(getField(card, 'mana_cost'));
  document.getElementById('tt-type').textContent = card.type_line ?? '';
  document.getElementById('tt-text').innerHTML  = renderOracleText(getField(card, 'oracle_text'));

  const flavor = getField(card, 'flavor_text');
  const ttFlavor = document.getElementById('tt-flavor');
  ttFlavor.textContent    = flavor;
  ttFlavor.style.display  = flavor ? '' : 'none';

  const pt      = (card.power != null && card.toughness != null) ? `${card.power} / ${card.toughness}` : '';
  const loyalty = card.loyalty ?? '';
  const ttPt    = document.getElementById('tt-pt');
  const ttDiv2  = document.getElementById('tt-div2');
  if (pt) {
    ttPt.textContent  = pt;
    ttPt.style.display = ttDiv2.style.display = '';
  } else if (loyalty) {
    ttPt.textContent  = `Loyalty: ${loyalty}`;
    ttPt.style.display = ttDiv2.style.display = '';
  } else {
    ttPt.style.display = ttDiv2.style.display = 'none';
  }

  document.getElementById('tt-set').textContent    = `${card.set_name ?? ''} · ${(card.released_at ?? '').slice(0,4)}`;
  document.getElementById('tt-artist').textContent = card.artist ? `Art: ${card.artist}` : '';

  tooltip.classList.remove('hidden');
  positionTooltip(e.clientX, e.clientY);
}

function hideTooltip() { tooltip.classList.add('hidden'); }

function positionTooltip(x, y) {
  const tw = tooltip.offsetWidth  || 288;
  const th = tooltip.offsetHeight || 200;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = x + 22;
  let top  = y + 10;
  if (left + tw > vw - 8) left = x - tw - 12;
  if (top  + th > vh - 8) top  = vh - th - 8;
  if (top < 8)            top  = 8;
  tooltip.style.left = `${left}px`;
  tooltip.style.top  = `${top}px`;
}

document.addEventListener('mousemove', e => {
  if (!tooltip.classList.contains('hidden')) positionTooltip(e.clientX, e.clientY);
});

// ---- Card detail modal ----
function openModal(card) {
  state.activeCard = card;
  hideTooltip();

  modalImg.src         = getImageUri(card);
  modalImg.alt         = card.name;
  modalName.className  = `modal-card-name rarity-${card.rarity}`;
  modalName.textContent = card.name;
  modalMana.innerHTML  = renderMana(getField(card, 'mana_cost'));
  modalType.textContent = card.type_line ?? '';
  modalText.innerHTML  = renderOracleText(getField(card, 'oracle_text'));

  const flavor = getField(card, 'flavor_text');
  modalFlavor.textContent   = flavor;
  modalFlavor.style.display = flavor ? '' : 'none';

  const pt      = (card.power != null && card.toughness != null) ? `${card.power} / ${card.toughness}` : '';
  const loyalty = card.loyalty ?? '';
  if (pt)      { modalPt.textContent = pt;              modalPt.style.display = ''; }
  else if (loyalty) { modalPt.textContent = `Loyalty: ${loyalty}`; modalPt.style.display = ''; }
  else         { modalPt.style.display = 'none'; }

  modalMeta.textContent = `${card.set_name ?? ''} · ${(card.released_at ?? '').slice(0,4)}${card.artist ? ' · Art: ' + card.artist : ''}`;
  modalQty.value        = 1;
  modalCondition.value  = 'NM';
  modalFoil.checked     = false;

  cardModal.classList.remove('hidden');
  loadDecksIntoSelect();
}

function closeModal() {
  cardModal.classList.add('hidden');
  state.activeCard = null;
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

async function loadDecksIntoSelect() {
  modalDeckSelect.innerHTML = '<option value="">&#8212; Select Deck &#8212;</option>';
  try {
    const decks = await VaultAPI.decks.getAll();
    decks.forEach(d => {
      const opt = document.createElement('option');
      opt.value       = d.id;
      opt.textContent = `${d.name} (${d.format})`;
      modalDeckSelect.appendChild(opt);
    });
  } catch { /* no decks yet — ok */ }
}

// ---- Modal actions ----
btnAddCollection.addEventListener('click', async () => {
  const card = state.activeCard;
  if (!card) return;
  try {
    await VaultAPI.collection.add({
      scryfall_id: card.id,
      name:        card.name,
      set_code:    card.set,
      set_name:    card.set_name ?? '',
      rarity:      card.rarity,
      mana_cost:   getField(card, 'mana_cost'),
      type_line:   card.type_line ?? '',
      image_uri:   getImageUri(card),
      quantity:    parseInt(modalQty.value, 10) || 1,
      foil:        modalFoil.checked ? 1 : 0,
      condition:   modalCondition.value,
    });
    showFlash(`${card.name} added to My Vault`);
  } catch (e) { showFlash(e.message, 'error'); }
});

btnAddWishlist.addEventListener('click', async () => {
  const card = state.activeCard;
  if (!card) return;
  try {
    await VaultAPI.wishlist.add({
      scryfall_id: card.id,
      name:        card.name,
      quantity:    parseInt(modalQty.value, 10) || 1,
      image_uri:   getImageUri(card),
      mana_cost:   getField(card, 'mana_cost'),
      type_line:   card.type_line ?? '',
    });
    showFlash(`${card.name} added to Wishlist`);
  } catch (e) { showFlash(e.message, 'error'); }
});

btnAddDeck.addEventListener('click', async () => {
  const card   = state.activeCard;
  const deckId = modalDeckSelect.value;
  if (!card || !deckId) { showFlash('Select a deck first', 'error'); return; }
  try {
    await VaultAPI.decks.addCard(deckId, {
      scryfall_id: card.id,
      name:        card.name,
      quantity:    parseInt(modalQty.value, 10) || 1,
      image_uri:   getImageUri(card),
      mana_cost:   getField(card, 'mana_cost'),
      type_line:   card.type_line ?? '',
    });
    showFlash(`${card.name} added to deck`);
  } catch (e) { showFlash(e.message, 'error'); }
});

// ---- Stats ----
function updateStats(data) {
  const cards = data.data ?? [];
  document.getElementById('stat-total').textContent = (data.total_cards ?? cards.length).toLocaleString();

  const clr  = { w:0, u:0, b:0, r:0, g:0 };
  const typ  = { creature:0, instant:0, sorcery:0, other:0 };
  const rar  = { common:0, uncommon:0, rare:0, mythic:0 };

  for (const c of cards) {
    (c.colors ?? []).forEach(col => { if (col.toLowerCase() in clr) clr[col.toLowerCase()]++; });
    const tl = (c.type_line ?? '').toLowerCase();
    if      (tl.includes('creature')) typ.creature++;
    else if (tl.includes('instant'))  typ.instant++;
    else if (tl.includes('sorcery'))  typ.sorcery++;
    else                              typ.other++;
    if (c.rarity in rar) rar[c.rarity]++;
  }

  const set = (id, val) => { document.getElementById(id).textContent = val || '—'; };
  set('stat-w', clr.w); set('stat-u', clr.u); set('stat-b', clr.b); set('stat-r', clr.r); set('stat-g', clr.g);
  set('stat-creatures', typ.creature); set('stat-instants', typ.instant);
  set('stat-sorceries', typ.sorcery); set('stat-other', typ.other);
  set('stat-common', rar.common); set('stat-uncommon', rar.uncommon);
  set('stat-rare', rar.rare); set('stat-mythic', rar.mythic);
}

// ---- Pagination ----
function renderPagination(hasMore) {
  pagination.innerHTML = '';
  if (state.page > 1) {
    const btn = document.createElement('button');
    btn.className = 'd2-page-btn'; btn.textContent = '&#9668; Prev';
    btn.onclick = () => goToPage(state.page - 1);
    pagination.appendChild(btn);
  }
  const ind = document.createElement('span');
  ind.className = 'page-indicator'; ind.textContent = `Page ${state.page}`;
  pagination.appendChild(ind);
  if (hasMore) {
    const btn = document.createElement('button');
    btn.className = 'd2-page-btn'; btn.textContent = 'Next &#9658;';
    btn.onclick = () => goToPage(state.page + 1);
    pagination.appendChild(btn);
  }
}

async function goToPage(page) {
  state.page = page;
  await doSearch(state.query, page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Main search ----
async function doSearch(query, page = 1) {
  if (state.loading) return;
  state.loading = true;
  state.query   = query;
  cardGrid.innerHTML      = '';
  resultCount.textContent = '';
  pagination.innerHTML    = '';
  loadingEl.classList.remove('hidden');

  try {
    const data = await fetchCards(query, page);
    state.page = page;
    renderCards(data.data);
    updateStats(data);
    renderPagination(data.has_more);
    resultCount.textContent = `${data.total_cards.toLocaleString()} relics found`;
  } catch (err) {
    cardGrid.innerHTML = `
      <div class="empty-state error-state">
        <p class="empty-title">The Dark Forces Intervene</p>
        <p class="empty-text">${escapeHtml(err.message)}</p>
      </div>`;
  } finally {
    state.loading = false;
    loadingEl.classList.add('hidden');
  }
}

// ---- Event listeners ----
searchBtn.addEventListener('click', () => { state.page = 1; doSearch(buildQuery(), 1); });

randomBtn.addEventListener('click', async () => {
  if (state.loading) return;
  state.loading = true;
  cardGrid.innerHTML = ''; resultCount.textContent = ''; pagination.innerHTML = '';
  loadingEl.classList.remove('hidden');
  try {
    const data = await fetchRandomSet();
    state.page  = 1;
    state.query = `e:${data.data[0]?.set ?? ''}`;
    renderCards(data.data);
    updateStats(data);
    renderPagination(data.has_more);
    resultCount.textContent = `${data.total_cards.toLocaleString()} relics found`;
  } catch (err) {
    cardGrid.innerHTML = `
      <div class="empty-state error-state">
        <p class="empty-title">The Dark Forces Intervene</p>
        <p class="empty-text">${escapeHtml(err.message)}</p>
      </div>`;
  } finally {
    state.loading = false;
    loadingEl.classList.add('hidden');
  }
});

searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { state.page = 1; doSearch(buildQuery(), 1); } });
setInput.addEventListener('keydown',    e => { if (e.key === 'Enter') { state.page = 1; doSearch(buildQuery(), 1); } });
sortSelect.addEventListener('change',   () => { if (state.query) doSearch(state.query, 1); });
