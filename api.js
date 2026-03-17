/* =============================================================
   api.js — backend API client for all pages
   ============================================================= */
'use strict';

const VaultAPI = (() => {
  const TOKEN_KEY = 'vault_token';

  function getToken()    { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t)   { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken()  { localStorage.removeItem(TOKEN_KEY); }

  async function req(method, url, body = null, authenticated = false) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (authenticated) {
      const token = getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const opts = { method, headers, body: body ? JSON.stringify(body) : null };
    const res  = await fetch(url, opts);
    const data = await res.json();
    if (res.status === 401) {
      clearToken();
      document.dispatchEvent(new CustomEvent('vault:unauthorized'));
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  return {
    // ----------------------------------------------------------
    // AUTH
    // ----------------------------------------------------------
    auth: {
      async login(username, password) {
        const data = await req('POST', '/api/auth/login', { username, password });
        setToken(data.token);
        return data;           // { token, username, role }
      },
      async register(username, password, role = 'author') {
        return req('POST', '/api/auth/register', { username, password, role }, true);
      },
      logout() {
        clearToken();
        document.dispatchEvent(new CustomEvent('vault:logout'));
      },
      isLoggedIn() { return !!getToken(); },
      getUser() {
        const token = getToken();
        if (!token) return null;
        try {
          return JSON.parse(atob(token.split('.')[1]));
        } catch { return null; }
      },
    },

    // ----------------------------------------------------------
    // COLLECTION  (GET is public; mutations require auth)
    // ----------------------------------------------------------
    collection: {
      getAll()          { return req('GET',    '/api/collection'); },
      add(card)         { return req('POST',   '/api/collection', card, true); },
      update(id, data)  { return req('PUT',    `/api/collection/${id}`, data, true); },
      remove(id)        { return req('DELETE', `/api/collection/${id}`, null, true); },
    },

    // ----------------------------------------------------------
    // DECKS
    // ----------------------------------------------------------
    decks: {
      getAll()                   { return req('GET',    '/api/decks'); },
      create(data)               { return req('POST',   '/api/decks', data, true); },
      get(id)                    { return req('GET',    `/api/decks/${id}`); },
      update(id, data)           { return req('PUT',    `/api/decks/${id}`, data, true); },
      remove(id)                 { return req('DELETE', `/api/decks/${id}`, null, true); },
      addCard(id, card)          { return req('POST',   `/api/decks/${id}/cards`, card, true); },
      updateCard(dId, cId, data) { return req('PUT',    `/api/decks/${dId}/cards/${cId}`, data, true); },
      removeCard(dId, cId)       { return req('DELETE', `/api/decks/${dId}/cards/${cId}`, null, true); },
    },

    // ----------------------------------------------------------
    // WISHLIST
    // ----------------------------------------------------------
    wishlist: {
      get()          { return req('GET',    '/api/wishlist'); },
      add(card)      { return req('POST',   '/api/wishlist', card, true); },
      remove(cardId) { return req('DELETE', `/api/wishlist/${cardId}`, null, true); },
    },
  };
})();
