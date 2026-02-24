/* =============================================================
   utils.js — shared client-side utilities for all pages
   ============================================================= */
'use strict';

function escapeHtml(str = '') {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const _MANA_MAP = {
  W:'w', U:'u', B:'b', R:'r', G:'g', C:'c',
  T:'t', Q:'q', X:'x', Y:'y', Z:'z',
};

function pipClass(sym) {
  const u = sym.toUpperCase();
  if (_MANA_MAP[u]) return `mana-${_MANA_MAP[u]}`;
  if (/^\d+$/.test(sym)) return 'mana-colorless';
  const first = u.split('/')[0];
  return _MANA_MAP[first] ? `mana-${_MANA_MAP[first]}` : 'mana-colorless';
}

function renderMana(cost = '') {
  return cost.replace(/\{([^}]+)\}/g, (_, sym) =>
    `<span class="mana-pip ${pipClass(sym)}" title="{${sym}}">${sym}</span>`
  );
}

function renderOracleText(text = '') {
  let html = escapeHtml(text);
  html = html.replace(/\{([^}]+)\}/g, (_, sym) =>
    `<span class="mana-pip ${pipClass(sym)}" title="{${sym}}">${sym}</span>`
  );
  return html.replace(/\n/g, '<br />');
}

function getImageUri(card) {
  return (
    card?.image_uris?.normal ??
    card?.card_faces?.[0]?.image_uris?.normal ??
    ''
  );
}

function getField(card, field) {
  return card?.[field] ?? card?.card_faces?.[0]?.[field] ?? '';
}

/** Brief toast message at bottom of screen */
function showFlash(msg, type = 'success') {
  document.querySelector('.confirm-flash')?.remove();
  const el = document.createElement('div');
  el.className = 'confirm-flash';
  if (type === 'error') {
    el.style.borderColor = '#c04040';
    el.style.color = '#e06060';
  }
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
