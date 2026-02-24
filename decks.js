/* =============================================================
   decks.js — Decks & Wishlist page
   Depends on: utils.js, api.js
   ============================================================= */
'use strict';

const SCRYFALL = 'https://api.scryfall.com';

let activeDeckId   = null;
let activeDeckData = null;

// ---- DOM refs ----
const deckListEl      = document.getElementById('deck-list');
const deckDetail      = document.getElementById('deck-detail');
const newDeckBtn      = document.getElementById('new-deck-btn');
const viewWishlistBtn = document.getElementById('view-wishlist-btn');
const newDeckForm     = document.getElementById('new-deck-form');
const newDeckName     = document.getElementById('new-deck-name');
const newDeckFormat   = document.getElementById('new-deck-format');
const createDeckBtn   = document.getElementById('create-deck-btn');
const cancelDeckBtn   = document.getElementById('cancel-deck-btn');

// ---- Load deck list ----
async function loadDeckList() {
  try {
    const decks = await VaultAPI.decks.getAll();
    renderDeckList(decks);
  } catch (e) { showFlash(e.message, 'error'); }
}

function renderDeckList(decks) {
  deckListEl.innerHTML = '';
  if (!decks.length) {
    deckListEl.innerHTML = '<p style="font-family:Cinzel,serif;font-size:0.65rem;color:var(--text-dim);text-align:center;padding:10px">No grimoires yet</p>';
    return;
  }
  for (const d of decks) {
    const item = document.createElement('div');
    item.className = `deck-list-item${activeDeckId === d.id ? ' active' : ''}`;
    item.dataset.id = d.id;
    item.innerHTML = `
      ${escapeHtml(d.name)}
      <div class="deck-item-meta">${escapeHtml(d.format)}</div>
      <span class="deck-item-count">${d.card_count ?? 0}</span>`;
    item.addEventListener('click', () => selectDeck(d.id, false));
    deckListEl.appendChild(item);
  }
}

// ---- Select / render deck ----
async function selectDeck(id, isWishlist) {
  activeDeckId = id;
  // Highlight active in list
  document.querySelectorAll('.deck-list-item').forEach(el => {
    el.classList.toggle('active', +el.dataset.id === id);
  });
  try {
    const data = isWishlist
      ? await VaultAPI.wishlist.get()
      : await VaultAPI.decks.get(id);
    activeDeckData = data;
    renderDeckDetail(data, isWishlist);
  } catch (e) { showFlash(e.message, 'error'); }
}

function renderDeckDetail(deck, isWishlist) {
  const totalCards = (deck.cards ?? []).reduce((s, c) => s + c.quantity, 0);

  deckDetail.innerHTML = `
    <div class="deck-detail-header">
      <div>
        <div class="deck-detail-title">${escapeHtml(deck.name)}</div>
        <div class="deck-detail-format">${escapeHtml(deck.format ?? '')}</div>
      </div>
      ${!isWishlist ? `
      <div class="deck-detail-actions">
        <button class="d2-button d2-button-sm" id="rename-deck-btn">Rename</button>
        <button class="d2-button d2-button-arcane d2-button-sm" id="delete-deck-btn">Delete</button>
      </div>` : ''}
    </div>

    <!-- Inline card search -->
    <div class="deck-search-wrap">
      <input type="text" id="deck-search-input" class="d2-input"
             placeholder="Search Scryfall to add cards&#8230;" autocomplete="off" />
      <div id="deck-search-results" class="deck-search-results"></div>
    </div>

    <!-- Card list grouped by type -->
    <div id="deck-card-groups"></div>

    <div class="deck-total-row">
      Total: <span>${totalCards}</span> cards
    </div>`;

  renderCardGroups(deck.cards ?? [], deck.id, isWishlist);
  wireDeckDetailEvents(deck, isWishlist);
}

function renderCardGroups(cards, deckId, isWishlist) {
  const groups = {
    'Creatures':     [],
    'Instants':      [],
    'Sorceries':     [],
    'Enchantments':  [],
    'Artifacts':     [],
    'Planeswalkers': [],
    'Lands':         [],
    'Other':         [],
  };

  for (const c of cards) {
    const tl = (c.type_line ?? '').toLowerCase();
    if      (tl.includes('creature'))     groups['Creatures'].push(c);
    else if (tl.includes('instant'))      groups['Instants'].push(c);
    else if (tl.includes('sorcery'))      groups['Sorceries'].push(c);
    else if (tl.includes('enchantment'))  groups['Enchantments'].push(c);
    else if (tl.includes('artifact'))     groups['Artifacts'].push(c);
    else if (tl.includes('planeswalker')) groups['Planeswalkers'].push(c);
    else if (tl.includes('land'))         groups['Lands'].push(c);
    else                                  groups['Other'].push(c);
  }

  const container = document.getElementById('deck-card-groups');
  container.innerHTML = '';

  for (const [groupName, groupCards] of Object.entries(groups)) {
    if (!groupCards.length) continue;
    const groupTotal = groupCards.reduce((s, c) => s + c.quantity, 0);

    const group = document.createElement('div');
    group.className = 'deck-type-group';
    group.innerHTML = `
      <div class="deck-type-header">${escapeHtml(groupName)} (${groupTotal})</div>
      <div class="deck-card-list" id="group-${escapeHtml(groupName)}"></div>`;
    container.appendChild(group);

    const list = group.querySelector('.deck-card-list');
    for (const c of groupCards) {
      const row = document.createElement('div');
      row.className = 'deck-card-row';
      row.dataset.id = c.id;
      row.innerHTML = `
        <span class="deck-card-qty">${c.quantity}&#215;</span>
        <div class="deck-card-mana">${renderMana(c.mana_cost)}</div>
        <span class="deck-card-name">${escapeHtml(c.name)}</span>
        <button class="qty-btn"        data-action="dec" data-id="${c.id}" title="Remove one">&#8722;</button>
        <button class="qty-btn"        data-action="inc" data-id="${c.id}" title="Add one">+</button>
        <button class="qty-btn remove-btn" data-action="del" data-id="${c.id}" title="Remove all">&#10006;</button>`;
      list.appendChild(row);
    }
  }

  // Wire qty buttons
  container.addEventListener('click', async e => {
    const btn    = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const cardId = +btn.dataset.id;
    const entry  = (activeDeckData?.cards ?? []).find(c => c.id === cardId);
    if (!entry) return;

    try {
      if (action === 'del') {
        if (isWishlist) await VaultAPI.wishlist.remove(cardId);
        else            await VaultAPI.decks.removeCard(deckId, cardId);
      } else {
        const newQty = entry.quantity + (action === 'inc' ? 1 : -1);
        if (newQty <= 0) {
          if (isWishlist) await VaultAPI.wishlist.remove(cardId);
          else            await VaultAPI.decks.removeCard(deckId, cardId);
        } else {
          await VaultAPI.decks.updateCard(deckId, cardId, { quantity: newQty });
        }
      }
      await selectDeck(activeDeckId, isWishlist);
    } catch (ex) { showFlash(ex.message, 'error'); }
  });
}

function wireDeckDetailEvents(deck, isWishlist) {
  // Delete deck
  document.getElementById('delete-deck-btn')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${deck.name}"? This cannot be undone.`)) return;
    try {
      await VaultAPI.decks.remove(deck.id);
      activeDeckId   = null;
      activeDeckData = null;
      deckDetail.innerHTML = '<div class="empty-state"><p class="empty-title">Grimoire Destroyed</p><p class="empty-text">Select or create another.</p></div>';
      await loadDeckList();
      showFlash(`${deck.name} deleted`);
    } catch (e) { showFlash(e.message, 'error'); }
  });

  // Rename deck
  document.getElementById('rename-deck-btn')?.addEventListener('click', async () => {
    const newName = prompt('New grimoire name:', deck.name);
    if (!newName || newName === deck.name) return;
    try {
      await VaultAPI.decks.update(deck.id, { name: newName, description: deck.description, format: deck.format });
      await selectDeck(deck.id, false);
      await loadDeckList();
      showFlash('Renamed');
    } catch (e) { showFlash(e.message, 'error'); }
  });

  // Inline Scryfall search
  const searchInput   = document.getElementById('deck-search-input');
  const searchResults = document.getElementById('deck-search-results');

  const doSearch = debounce(async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) { searchResults.classList.remove('visible'); return; }
    try {
      const res  = await fetch(`${SCRYFALL}/cards/search?q=${encodeURIComponent(q)}&order=name`);
      const data = await res.json();
      const cards = (data.data ?? []).slice(0, 8);
      renderSearchDropdown(cards, deck.id, isWishlist, searchInput, searchResults);
    } catch { searchResults.classList.remove('visible'); }
  }, 300);

  searchInput.addEventListener('input', doSearch);
  searchInput.addEventListener('focus', doSearch);

  document.addEventListener('click', e => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.classList.remove('visible');
    }
  });
}

function renderSearchDropdown(cards, deckId, isWishlist, inputEl, resultsEl) {
  resultsEl.innerHTML = '';
  if (!cards.length) { resultsEl.classList.remove('visible'); return; }

  for (const card of cards) {
    const row = document.createElement('div');
    row.className = 'deck-search-result';
    row.innerHTML = `
      <img class="deck-result-img" src="${escapeHtml(card.image_uris?.small ?? '')}" alt="" loading="lazy" />
      <span class="deck-result-name">${escapeHtml(card.name)}</span>
      <div class="deck-result-mana">${renderMana(card.mana_cost ?? '')}</div>`;

    row.addEventListener('click', async () => {
      resultsEl.classList.remove('visible');
      inputEl.value = '';
      try {
        const payload = {
          scryfall_id: card.id,
          name:        card.name,
          quantity:    1,
          image_uri:   getImageUri(card),
          mana_cost:   getField(card, 'mana_cost'),
          type_line:   card.type_line ?? '',
        };
        if (isWishlist) await VaultAPI.wishlist.add(payload);
        else            await VaultAPI.decks.addCard(deckId, payload);
        showFlash(`${card.name} added`);
        await selectDeck(activeDeckId, isWishlist);
      } catch (e) { showFlash(e.message, 'error'); }
    });
    resultsEl.appendChild(row);
  }
  resultsEl.classList.add('visible');
}

// ---- New deck form ----
newDeckBtn.addEventListener('click', () => {
  newDeckForm.classList.remove('hidden');
  newDeckName.focus();
});
cancelDeckBtn.addEventListener('click', () => {
  newDeckForm.classList.add('hidden');
  newDeckName.value = '';
});
createDeckBtn.addEventListener('click', async () => {
  const name   = newDeckName.value.trim();
  const format = newDeckFormat.value;
  if (!name) { showFlash('Enter a name', 'error'); return; }
  try {
    const deck = await VaultAPI.decks.create({ name, description: '', format });
    newDeckForm.classList.add('hidden');
    newDeckName.value = '';
    await loadDeckList();
    selectDeck(deck.id, false);
    showFlash(`${name} created`);
  } catch (e) { showFlash(e.message, 'error'); }
});
newDeckName.addEventListener('keydown', e => { if (e.key === 'Enter') createDeckBtn.click(); });

// ---- Wishlist ----
viewWishlistBtn.addEventListener('click', async () => {
  document.querySelectorAll('.deck-list-item').forEach(el => el.classList.remove('active'));
  try {
    const w = await VaultAPI.wishlist.get();
    activeDeckId   = w.id;
    activeDeckData = w;
    renderDeckDetail(w, true);
  } catch (e) { showFlash(e.message, 'error'); }
});

// ---- Init ----
loadDeckList();
