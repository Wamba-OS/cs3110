/* ==========================================================
   The Vault of Tarnished Sigils — Scryfall card catalogue
   ========================================================== */

const API = 'https://api.scryfall.com';

// ---- State ----
const state = { page: 1, query: '', loading: false };

// ---- DOM refs ----
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

// ---- Utility ----
function escapeHtml(str = '') {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---- Scryfall query builder ----
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

// ---- API calls ----
async function fetchCards(query, page = 1) {
  const order = sortSelect.value;
  const url   = `${API}/cards/search?q=${encodeURIComponent(query)}&order=${order}&page=${page}`;
  const res   = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.details || `Search failed (${res.status})`);
  }
  return res.json();
}

async function fetchRandomSet() {
  const res  = await fetch(`${API}/cards/random`);
  if (!res.ok) throw new Error('Could not summon a random card.');
  const card = await res.json();
  return fetchCards(`e:${card.set}`);
}

// ---- Mana symbol rendering ----
const COLOR_MAP = { W:'w', U:'u', B:'b', R:'r', G:'g', C:'c', T:'t', Q:'q', X:'x', Y:'y', Z:'z' };

function pipClass(sym) {
  const upper = sym.toUpperCase();
  if (COLOR_MAP[upper]) return `mana-${COLOR_MAP[upper]}`;
  if (/^\d+$/.test(sym))       return 'mana-colorless';
  // Hybrid / Phyrexian (e.g. "W/U", "P/R") — use first colour
  const first = upper.split('/')[0];
  return COLOR_MAP[first] ? `mana-${COLOR_MAP[first]}` : 'mana-colorless';
}

function renderMana(cost = '') {
  return cost.replace(/\{([^}]+)\}/g, (_, sym) =>
    `<span class="mana-pip ${pipClass(sym)}" title="{${sym}}">${sym}</span>`
  );
}

function renderOracleText(text = '') {
  // Escape HTML first, then restore mana pips, then line-breaks
  let html = escapeHtml(text);
  html = html.replace(/\{([^}]+)\}/g, (_, sym) =>
    `<span class="mana-pip ${pipClass(sym)}" title="{${sym}}">${sym}</span>`
  );
  return html.replace(/\n/g, '<br />');
}

// ---- Card helpers ----
function getImageUri(card) {
  return (
    card.image_uris?.normal ??
    card.card_faces?.[0]?.image_uris?.normal ??
    ''
  );
}

function getField(card, field) {
  return card[field] ?? card.card_faces?.[0]?.[field] ?? '';
}

// ---- Render card grid ----
function renderCards(cards) {
  cardGrid.innerHTML = '';
  if (!cards.length) {
    cardGrid.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No Relics Found</p>
        <p class="empty-text">The vault contains nothing matching your query.<br />
        Seek elsewhere, adventurer.</p>
      </div>`;
    return;
  }

  for (const card of cards) {
    const img  = getImageUri(card);
    const item = document.createElement('div');
    item.className = `card-item rarity-${card.rarity}`;
    item.innerHTML = `
      <img src="${img}" alt="${escapeHtml(card.name)}" loading="lazy" />
      <div class="card-name-overlay">${escapeHtml(card.name)}</div>`;

    item.addEventListener('mouseenter', e => showTooltip(card, e));
    item.addEventListener('mouseleave', hideTooltip);
    cardGrid.appendChild(item);
  }
}

// ---- Tooltip ----
function showTooltip(card, e) {
  const name   = card.name;
  const mana   = getField(card, 'mana_cost');
  const type   = card.type_line ?? '';
  const text   = getField(card, 'oracle_text');
  const flavor = getField(card, 'flavor_text');
  const pt     = (card.power != null && card.toughness != null)
                   ? `${card.power} / ${card.toughness}` : '';
  const loyalty = card.loyalty ?? '';

  // Name (rarity-coloured)
  const nameEl = document.getElementById('tt-name');
  nameEl.className = `tooltip-name rarity-${card.rarity}`;
  nameEl.textContent = name;

  document.getElementById('tt-mana').innerHTML = renderMana(mana);
  document.getElementById('tt-type').textContent = type;
  document.getElementById('tt-text').innerHTML = renderOracleText(text);

  const flavorEl = document.getElementById('tt-flavor');
  flavorEl.textContent = flavor;
  flavorEl.style.display = flavor ? '' : 'none';

  const ptEl  = document.getElementById('tt-pt');
  const div2  = document.getElementById('tt-div2');
  if (pt) {
    ptEl.textContent    = pt;
    ptEl.style.display  = '';
    div2.style.display  = '';
  } else if (loyalty) {
    ptEl.textContent    = `Loyalty: ${loyalty}`;
    ptEl.style.display  = '';
    div2.style.display  = '';
  } else {
    ptEl.style.display  = 'none';
    div2.style.display  = 'none';
  }

  document.getElementById('tt-set').textContent =
    `${card.set_name ?? card.set?.toUpperCase() ?? ''} · ${(card.released_at ?? '').slice(0, 4)}`;
  document.getElementById('tt-artist').textContent =
    card.artist ? `Art: ${card.artist}` : '';

  tooltip.classList.remove('hidden');
  positionTooltip(e.clientX, e.clientY);
}

function hideTooltip() {
  tooltip.classList.add('hidden');
}

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

// ---- Stats panel ----
function updateStats(data) {
  const cards = data.data ?? [];
  const total = data.total_cards ?? cards.length;

  document.getElementById('stat-total').textContent = total.toLocaleString();

  const clr  = { w: 0, u: 0, b: 0, r: 0, g: 0 };
  const type = { creature: 0, instant: 0, sorcery: 0, other: 0 };
  const rar  = { common: 0, uncommon: 0, rare: 0, mythic: 0 };

  for (const card of cards) {
    (card.colors ?? []).forEach(c => { if (clr[c.toLowerCase()] != null) clr[c.toLowerCase()]++; });

    const tl = (card.type_line ?? '').toLowerCase();
    if      (tl.includes('creature')) type.creature++;
    else if (tl.includes('instant'))  type.instant++;
    else if (tl.includes('sorcery'))  type.sorcery++;
    else                              type.other++;

    if (rar[card.rarity] != null) rar[card.rarity]++;
  }

  const set = (id, val) => { document.getElementById(id).textContent = val || '—'; };
  set('stat-w', clr.w);  set('stat-u', clr.u);  set('stat-b', clr.b);
  set('stat-r', clr.r);  set('stat-g', clr.g);
  set('stat-creatures', type.creature);
  set('stat-instants',  type.instant);
  set('stat-sorceries', type.sorcery);
  set('stat-other',     type.other);
  set('stat-common',    rar.common);
  set('stat-uncommon',  rar.uncommon);
  set('stat-rare',      rar.rare);
  set('stat-mythic',    rar.mythic);
}

// ---- Pagination ----
function renderPagination(hasMore) {
  pagination.innerHTML = '';

  if (state.page > 1) {
    const btn = document.createElement('button');
    btn.className   = 'd2-page-btn';
    btn.textContent = '◀ Prev';
    btn.onclick     = () => goToPage(state.page - 1);
    pagination.appendChild(btn);
  }

  const indicator = document.createElement('span');
  indicator.className   = 'page-indicator';
  indicator.textContent = `Page ${state.page}`;
  pagination.appendChild(indicator);

  if (hasMore) {
    const btn = document.createElement('button');
    btn.className   = 'd2-page-btn';
    btn.textContent = 'Next ▶';
    btn.onclick     = () => goToPage(state.page + 1);
    pagination.appendChild(btn);
  }
}

async function goToPage(page) {
  state.page = page;
  await doSearch(state.query, page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Main search routine ----
async function doSearch(query, page = 1) {
  if (state.loading) return;
  state.loading = true;
  state.query   = query;

  cardGrid.innerHTML  = '';
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
searchBtn.addEventListener('click', () => {
  state.page = 1;
  doSearch(buildQuery(), 1);
});

randomBtn.addEventListener('click', async () => {
  if (state.loading) return;
  state.loading = true;
  cardGrid.innerHTML      = '';
  resultCount.textContent = '';
  pagination.innerHTML    = '';
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

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { state.page = 1; doSearch(buildQuery(), 1); }
});

setInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { state.page = 1; doSearch(buildQuery(), 1); }
});

// Re-run current search when sort changes (if there's an active query)
sortSelect.addEventListener('change', () => {
  if (state.query) doSearch(state.query, 1);
});
