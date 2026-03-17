'use strict';
require('dotenv').config();
const express    = require('express');
const Database   = require('better-sqlite3');
const path       = require('path');
const https      = require('https');
const fs         = require('fs');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const selfsigned = require('selfsigned');

const app = express();
const db  = new Database(path.join(__dirname, 'vault.db'));

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable must be set');

// ---- SSL cert paths ----
const certPath = path.join(__dirname, 'cert.pem');
const keyPath  = path.join(__dirname, 'key.pem');

// ---- DB setup ----
db.pragma('foreign_keys = ON');
db.pragma('journal_mode  = WAL');

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

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'author' CHECK(role IN ('admin','author')),
    created_at    TEXT    DEFAULT (datetime('now'))
  );
`);

// ---- Seed admin ----
(function seedAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE username='Wamba'").get();
  if (!existing) {
    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error('ADMIN_PASSWORD environment variable must be set');
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('Wamba', ?, 'admin')").run(hash);
    console.log('Admin user created → username: Wamba');
  }
})();

// ---- Seed author (optional) ----
(function seedAuthor() {
  const existing = db.prepare("SELECT id FROM users WHERE username='Wamba_author'").get();
  if (!existing) {
    const password = process.env.AUTHOR_PASSWORD;
    if (!password) return; // optional — skip if not set
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('Wamba_author', ?, 'author')").run(hash);
    console.log('Author user created → username: Wamba_author');
  }
})();

// ================================================================
// MIDDLEWARE
// ================================================================
app.use(express.json());

// Block direct access to sensitive server-side files
const BLOCKED = /\.(db|db-shm|db-wal|env|pem|key|log)$|(^|\/)server\.js$|(^|\/)package(-lock)?\.json$/i;
app.use((req, res, next) => {
  if (BLOCKED.test(req.path)) return res.status(403).end();
  next();
});

app.use(express.static(path.join(__dirname)));

function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — login required' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — admin access required' });
    }
    next();
  });
}

// ================================================================
// AUTH
// ================================================================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.json({ token, username: user.username, role: user.role });
});

// Admin-only: create new credentials
app.post('/api/auth/register', requireAdmin, (req, res) => {
  const { username, password, role = 'author' } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (!['admin', 'author'].includes(role)) {
    return res.status(400).json({ error: "role must be 'admin' or 'author'" });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    ).run(username, hash, role);
    res.status(201).json({ id: r.lastInsertRowid, username, role });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// COLLECTION
// ================================================================
// GET is unauthenticated (public read)
app.get('/api/collection', (_req, res) => {
  try { res.json(db.prepare('SELECT * FROM collection ORDER BY name').all()); }
  catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/collection', requireAuth, (req, res) => {
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
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/collection/:id', requireAuth, (req, res) => {
  try {
    const { quantity, condition, foil } = req.body;
    db.prepare('UPDATE collection SET quantity=?,condition=?,foil=? WHERE id=?')
      .run(quantity, condition, foil ? 1 : 0, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/collection/:id', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM collection WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ================================================================
// DECKS
// ================================================================
app.get('/api/decks', (_req, res) => {
  try {
    res.json(db.prepare(`
      SELECT d.*, COUNT(dc.id) AS card_count
      FROM decks d LEFT JOIN deck_cards dc ON dc.deck_id=d.id
      WHERE d.is_wishlist=0
      GROUP BY d.id ORDER BY d.created_at DESC
    `).all());
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/decks', requireAuth, (req, res) => {
  try {
    const { name, description = '', format = 'Casual' } = req.body;
    const r = db.prepare('INSERT INTO decks (name,description,format) VALUES (?,?,?)').run(name, description, format);
    res.status(201).json({ id: r.lastInsertRowid, name, description, format, is_wishlist: 0, card_count: 0 });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/decks/:id', (req, res) => {
  try {
    const deck = db.prepare('SELECT * FROM decks WHERE id=?').get(req.params.id);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    const cards = db.prepare('SELECT * FROM deck_cards WHERE deck_id=? ORDER BY name').all(req.params.id);
    res.json({ ...deck, cards });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/decks/:id', requireAuth, (req, res) => {
  try {
    const { name, description, format } = req.body;
    db.prepare('UPDATE decks SET name=?,description=?,format=? WHERE id=?').run(name, description, format, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/decks/:id', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM decks WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/decks/:id/cards', requireAuth, (req, res) => {
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
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/decks/:deckId/cards/:cardId', requireAuth, (req, res) => {
  try {
    const { quantity } = req.body;
    if (quantity <= 0) {
      db.prepare('DELETE FROM deck_cards WHERE id=?').run(req.params.cardId);
    } else {
      db.prepare('UPDATE deck_cards SET quantity=? WHERE id=?').run(quantity, req.params.cardId);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/decks/:deckId/cards/:cardId', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM deck_cards WHERE id=?').run(req.params.cardId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
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

app.get('/api/wishlist', (_req, res) => {
  try {
    const w = getOrCreateWishlist();
    const cards = db.prepare('SELECT * FROM deck_cards WHERE deck_id=? ORDER BY name').all(w.id);
    res.json({ ...w, cards });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/wishlist', requireAuth, (req, res) => {
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
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/wishlist/:cardId', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM deck_cards WHERE id=?').run(req.params.cardId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ================================================================
// START SERVER
// Render terminates SSL at their edge — app serves plain HTTP there.
// Locally we use self-signed HTTPS.
// ================================================================
const PORT = process.env.PORT || 3000;
const IS_RENDER = !!process.env.RENDER;

(async () => {
  if (IS_RENDER) {
    app.listen(PORT, () => console.log(`Vault server → http://0.0.0.0:${PORT}`));
  } else {
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      const attrs = [{ name: 'commonName', value: 'localhost' }];
      const pems  = await selfsigned.generate(attrs, { days: 365 });
      fs.writeFileSync(certPath, pems.cert);
      fs.writeFileSync(keyPath,  pems.private);
      console.log('Self-signed SSL certificate generated.');
    }
    const sslOptions = {
      cert: fs.readFileSync(certPath),
      key:  fs.readFileSync(keyPath),
    };
    https.createServer(sslOptions, app).listen(PORT, () => {
      console.log(`Vault server → https://localhost:${PORT}`);
      console.log('NOTE: Accept the self-signed certificate warning in your browser.');
    });
  }
})();
