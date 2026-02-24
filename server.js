'use strict';
const express  = require('express');
const Database = require('better-sqlite3');
const path     = require('path');

const app = express();
const db  = new Database(path.join(__dirname, 'vault.db'));

db.pragma('foreign_keys = ON');
db.pragma('journal_mode  = WAL');

// ---- Init schema ----
db.exec(`
  CREATE TABLE IF NOT EXISTS collection (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scryfall_id TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    set_code    TEXT    DEFAULT '',
    set_name    TEXT    DEFAULT '',
    rarity      TEXT    DEFAULT '',
    mana_cost   TEXT    DEFAULT '',
    type_line   TEXT    DEFAULT '',
    image_uri   TEXT    DEFAULT '',
    quantity    INTEGER DEFAULT 1,
    foil        INTEGER DEFAULT 0,
    condition   TEXT    DEFAULT 'NM',
    added_at    TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS decks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    format      TEXT    DEFAULT 'Casual',
    is_wishlist INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deck_cards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id     INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    scryfall_id TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    quantity    INTEGER DEFAULT 1,
    board       TEXT    DEFAULT 'main',
    image_uri   TEXT    DEFAULT '',
    mana_cost   TEXT    DEFAULT '',
    type_line   TEXT    DEFAULT ''
  );
`);

// ---- Middleware ----
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ================================================================
// COLLECTION
// ================================================================
app.get('/api/collection', (req, res) => {
  try { res.json(db.prepare('SELECT * FROM collection ORDER BY name').all()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/collection', (req, res) => {
  try {
    const {
      scryfall_id, name,
      set_code = '', set_name = '', rarity = '',
      mana_cost = '', type_line = '', image_uri = '',
      quantity = 1, foil = 0, condition = 'NM',
    } = req.body;
    const foilInt = foil ? 1 : 0;
    const existing = db.prepare(
      'SELECT * FROM collection WHERE scryfall_id=? AND foil=?'
    ).get(scryfall_id, foilInt);
    if (existing) {
      const newQty = existing.quantity + quantity;
      db.prepare('UPDATE collection SET quantity=? WHERE id=?').run(newQty, existing.id);
      res.json({ ...existing, quantity: newQty, updated: true });
    } else {
      const r = db.prepare(`
        INSERT INTO collection
          (scryfall_id,name,set_code,set_name,rarity,mana_cost,type_line,image_uri,quantity,foil,condition)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(scryfall_id, name, set_code, set_name, rarity, mana_cost, type_line, image_uri, quantity, foilInt, condition);
      res.status(201).json({ id: r.lastInsertRowid, scryfall_id, name, quantity, foil: foilInt, condition });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/collection/:id', (req, res) => {
  try {
    const { quantity, condition, foil } = req.body;
    db.prepare('UPDATE collection SET quantity=?,condition=?,foil=? WHERE id=?')
      .run(quantity, condition, foil ? 1 : 0, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/collection/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM collection WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================================================================
// DECKS
// ================================================================
app.get('/api/decks', (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT d.*, COUNT(dc.id) AS card_count
      FROM decks d LEFT JOIN deck_cards dc ON dc.deck_id=d.id
      WHERE d.is_wishlist=0
      GROUP BY d.id ORDER BY d.created_at DESC
    `).all());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/decks', (req, res) => {
  try {
    const { name, description = '', format = 'Casual' } = req.body;
    const r = db.prepare('INSERT INTO decks (name,description,format) VALUES (?,?,?)').run(name, description, format);
    res.status(201).json({ id: r.lastInsertRowid, name, description, format, is_wishlist: 0, card_count: 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/decks/:id', (req, res) => {
  try {
    const deck = db.prepare('SELECT * FROM decks WHERE id=?').get(req.params.id);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    const cards = db.prepare('SELECT * FROM deck_cards WHERE deck_id=? ORDER BY name').all(req.params.id);
    res.json({ ...deck, cards });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/decks/:id', (req, res) => {
  try {
    const { name, description, format } = req.body;
    db.prepare('UPDATE decks SET name=?,description=?,format=? WHERE id=?').run(name, description, format, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/decks/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM decks WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/decks/:id/cards', (req, res) => {
  try {
    const {
      scryfall_id, name, quantity = 1, board = 'main',
      image_uri = '', mana_cost = '', type_line = '',
    } = req.body;
    const existing = db.prepare(
      'SELECT * FROM deck_cards WHERE deck_id=? AND scryfall_id=? AND board=?'
    ).get(req.params.id, scryfall_id, board);
    if (existing) {
      const newQty = existing.quantity + quantity;
      db.prepare('UPDATE deck_cards SET quantity=? WHERE id=?').run(newQty, existing.id);
      res.json({ ...existing, quantity: newQty, updated: true });
    } else {
      const r = db.prepare(`
        INSERT INTO deck_cards (deck_id,scryfall_id,name,quantity,board,image_uri,mana_cost,type_line)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(req.params.id, scryfall_id, name, quantity, board, image_uri, mana_cost, type_line);
      res.status(201).json({ id: r.lastInsertRowid, deck_id: +req.params.id, scryfall_id, name, quantity, board });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/decks/:deckId/cards/:cardId', (req, res) => {
  try {
    const { quantity } = req.body;
    if (quantity <= 0) {
      db.prepare('DELETE FROM deck_cards WHERE id=?').run(req.params.cardId);
    } else {
      db.prepare('UPDATE deck_cards SET quantity=? WHERE id=?').run(quantity, req.params.cardId);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/decks/:deckId/cards/:cardId', (req, res) => {
  try {
    db.prepare('DELETE FROM deck_cards WHERE id=?').run(req.params.cardId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================================================================
// WISHLIST  (deck with is_wishlist=1)
// ================================================================
function getOrCreateWishlist() {
  let w = db.prepare('SELECT * FROM decks WHERE is_wishlist=1 LIMIT 1').get();
  if (!w) {
    const r = db.prepare(
      "INSERT INTO decks (name,description,format,is_wishlist) VALUES ('Wishlist','Cards I want to acquire','Wishlist',1)"
    ).run();
    w = db.prepare('SELECT * FROM decks WHERE id=?').get(r.lastInsertRowid);
  }
  return w;
}

app.get('/api/wishlist', (req, res) => {
  try {
    const w = getOrCreateWishlist();
    const cards = db.prepare('SELECT * FROM deck_cards WHERE deck_id=? ORDER BY name').all(w.id);
    res.json({ ...w, cards });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wishlist', (req, res) => {
  try {
    const w = getOrCreateWishlist();
    const { scryfall_id, name, quantity = 1, image_uri = '', mana_cost = '', type_line = '' } = req.body;
    const existing = db.prepare(
      'SELECT * FROM deck_cards WHERE deck_id=? AND scryfall_id=?'
    ).get(w.id, scryfall_id);
    if (existing) {
      db.prepare('UPDATE deck_cards SET quantity=quantity+? WHERE id=?').run(quantity, existing.id);
      res.json({ updated: true, wishlistId: w.id });
    } else {
      db.prepare(`
        INSERT INTO deck_cards (deck_id,scryfall_id,name,quantity,board,image_uri,mana_cost,type_line)
        VALUES (?,?,?,?,'main',?,?,?)
      `).run(w.id, scryfall_id, name, quantity, image_uri, mana_cost, type_line);
      res.json({ added: true, wishlistId: w.id });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/wishlist/:cardId', (req, res) => {
  try {
    db.prepare('DELETE FROM deck_cards WHERE id=?').run(req.params.cardId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Start ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Vault server → http://localhost:${PORT}`));
