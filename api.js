/* =============================================================
   api.js — backend API client for all pages
   ============================================================= */
'use strict';

const VaultAPI = (() => {
  async function req(method, url, body = null) {
    const opts = {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : null,
    };
    const res  = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  return {
    collection: {
      getAll()          { return req('GET',    '/api/collection'); },
      add(card)         { return req('POST',   '/api/collection', card); },
      update(id, data)  { return req('PUT',    `/api/collection/${id}`, data); },
      remove(id)        { return req('DELETE', `/api/collection/${id}`); },
    },
    decks: {
      getAll()                   { return req('GET',    '/api/decks'); },
      create(data)               { return req('POST',   '/api/decks', data); },
      get(id)                    { return req('GET',    `/api/decks/${id}`); },
      update(id, data)           { return req('PUT',    `/api/decks/${id}`, data); },
      remove(id)                 { return req('DELETE', `/api/decks/${id}`); },
      addCard(id, card)          { return req('POST',   `/api/decks/${id}/cards`, card); },
      updateCard(dId, cId, data) { return req('PUT',    `/api/decks/${dId}/cards/${cId}`, data); },
      removeCard(dId, cId)       { return req('DELETE', `/api/decks/${dId}/cards/${cId}`); },
    },
    wishlist: {
      get()          { return req('GET',    '/api/wishlist'); },
      add(card)      { return req('POST',   '/api/wishlist', card); },
      remove(cardId) { return req('DELETE', `/api/wishlist/${cardId}`); },
    },
  };
})();
