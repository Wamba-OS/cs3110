'use strict';
require('dotenv').config();
const express    = require('express');
const { Pool }   = require('pg');
const path       = require('path');
const https      = require('https');
const fs         = require('fs');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const selfsigned = require('selfsigned');

const app = express();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable must be set');

// ---- PostgreSQL connection pool ----
// DATABASE_URL is set in Render's environment variables (points to Neon)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },  // required for Neon and most hosted Postgres
});

// ---- SSL cert paths (local dev only) ----
const certPath = path.join(__dirname, 'cert.pem');
const keyPath  = path.join(__dirname, 'key.pem');

// ================================================================
// DB SETUP — create tables and seed users on first boot
// ================================================================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'author'
                            CHECK(role IN ('admin','author')),
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS collection (
      id          SERIAL PRIMARY KEY,
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
      added_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS decks (
      id          SERIAL PRIMARY KEY,
      name        TEXT    NOT NULL,
      description TEXT    DEFAULT '',
      format      TEXT    DEFAULT 'Casual',
      is_wishlist INTEGER DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS deck_cards (
      id          SERIAL PRIMARY KEY,
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

  // Seed admin
  const adminCheck = await pool.query("SELECT id FROM users WHERE username='Wamba'");
  if (adminCheck.rows.length === 0) {
    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error('ADMIN_PASSWORD environment variable must be set');
    const hash = bcrypt.hashSync(password, 10);
    await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ('Wamba', $1, 'admin')",
      [hash]
    );
    console.log('Admin user created → username: Wamba');
  }

  // Seed author (optional)
  const authorCheck = await pool.query("SELECT id FROM users WHERE username='Wamba_author'");
  if (authorCheck.rows.length === 0) {
    const password = process.env.AUTHOR_PASSWORD;
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await pool.query(
        "INSERT INTO users (username, password_hash, role) VALUES ('Wamba_author', $1, 'author')",
        [hash]
      );
      console.log('Author user created → username: Wamba_author');
    }
  }

  console.log('Database ready.');
}

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
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, username: user.username, role: user.role });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin-only: create new credentials
app.post('/api/auth/register', requireAdmin, async (req, res) => {
  const { username, password, role = 'author' } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (!['admin', 'author'].includes(role)) {
    return res.status(400).json({ error: "role must be 'admin' or 'author'" });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
      [username, hash, role]
    );
    res.status(201).json({ id: r.rows[0].id, username, role });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// COLLECTION
// ================================================================
app.get('/api/collection', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM collection ORDER BY name');
    res.json(result.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/collection', requireAuth, async (req, res) => {
  try {
    const {
      scryfall_id, name,
      set_code = '', set_name = '', rarity = '',
      mana_cost = '', type_line = '', image_uri = '',
      quantity = 1, foil = 0, condition = 'NM',
    } = req.body;
    const foilInt = foil ? 1 : 0;

    const existing = await pool.query(
      'SELECT * FROM collection WHERE scryfall_id=$1 AND foil=$2',
      [scryfall_id, foilInt]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const newQty = row.quantity + quantity;
      await pool.query('UPDATE collection SET quantity=$1 WHERE id=$2', [newQty, row.id]);
      res.json({ ...row, quantity: newQty, updated: true });
    } else {
      const r = await pool.query(`
        INSERT INTO collection
          (scryfall_id,name,set_code,set_name,rarity,mana_cost,type_line,image_uri,quantity,foil,condition)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id
      `, [scryfall_id, name, set_code, set_name, rarity, mana_cost, type_line, image_uri, quantity, foilInt, condition]);
      res.status(201).json({ id: r.rows[0].id, scryfall_id, name, quantity, foil: foilInt, condition });
    }
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/collection/:id', requireAuth, async (req, res) => {
  try {
    const { quantity, condition, foil } = req.body;
    await pool.query(
      'UPDATE collection SET quantity=$1,condition=$2,foil=$3 WHERE id=$4',
      [quantity, condition, foil ? 1 : 0, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/collection/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM collection WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// ================================================================
// DECKS
// ================================================================
app.get('/api/decks', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*, COUNT(dc.id)::int AS card_count
      FROM decks d LEFT JOIN deck_cards dc ON dc.deck_id=d.id
      WHERE d.is_wishlist=0
      GROUP BY d.id ORDER BY d.created_at DESC
    `);
    res.json(result.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/decks', requireAuth, async (req, res) => {
  try {
    const { name, description = '', format = 'Casual' } = req.body;
    const r = await pool.query(
      'INSERT INTO decks (name,description,format) VALUES ($1,$2,$3) RETURNING id',
      [name, description, format]
    );
    res.status(201).json({ id: r.rows[0].id, name, description, format, is_wishlist: 0, card_count: 0 });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/decks/:id', async (req, res) => {
  try {
    const deckRes = await pool.query('SELECT * FROM decks WHERE id=$1', [req.params.id]);
    if (deckRes.rows.length === 0) return res.status(404).json({ error: 'Deck not found' });
    const cards = await pool.query(
      'SELECT * FROM deck_cards WHERE deck_id=$1 ORDER BY name', [req.params.id]
    );
    res.json({ ...deckRes.rows[0], cards: cards.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/decks/:id', requireAuth, async (req, res) => {
  try {
    const { name, description, format } = req.body;
    await pool.query(
      'UPDATE decks SET name=$1,description=$2,format=$3 WHERE id=$4',
      [name, description, format, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/decks/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM decks WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/decks/:id/cards', requireAuth, async (req, res) => {
  try {
    const {
      scryfall_id, name, quantity = 1, board = 'main',
      image_uri = '', mana_cost = '', type_line = '',
    } = req.body;
    const existing = await pool.query(
      'SELECT * FROM deck_cards WHERE deck_id=$1 AND scryfall_id=$2 AND board=$3',
      [req.params.id, scryfall_id, board]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const newQty = row.quantity + quantity;
      await pool.query('UPDATE deck_cards SET quantity=$1 WHERE id=$2', [newQty, row.id]);
      res.json({ ...row, quantity: newQty, updated: true });
    } else {
      const r = await pool.query(`
        INSERT INTO deck_cards (deck_id,scryfall_id,name,quantity,board,image_uri,mana_cost,type_line)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id
      `, [req.params.id, scryfall_id, name, quantity, board, image_uri, mana_cost, type_line]);
      res.status(201).json({ id: r.rows[0].id, deck_id: +req.params.id, scryfall_id, name, quantity, board });
    }
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/decks/:deckId/cards/:cardId', requireAuth, async (req, res) => {
  try {
    const { quantity } = req.body;
    if (quantity <= 0) {
      await pool.query('DELETE FROM deck_cards WHERE id=$1', [req.params.cardId]);
    } else {
      await pool.query('UPDATE deck_cards SET quantity=$1 WHERE id=$2', [quantity, req.params.cardId]);
    }
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/decks/:deckId/cards/:cardId', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM deck_cards WHERE id=$1', [req.params.cardId]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// ================================================================
// WISHLIST  (deck with is_wishlist=1)
// ================================================================
async function getOrCreateWishlist() {
  const result = await pool.query('SELECT * FROM decks WHERE is_wishlist=1 LIMIT 1');
  if (result.rows.length > 0) return result.rows[0];
  const r = await pool.query(
    "INSERT INTO decks (name,description,format,is_wishlist) VALUES ('Wishlist','Cards I want to acquire','Wishlist',1) RETURNING *"
  );
  return r.rows[0];
}

app.get('/api/wishlist', async (_req, res) => {
  try {
    const w = await getOrCreateWishlist();
    const cards = await pool.query(
      'SELECT * FROM deck_cards WHERE deck_id=$1 ORDER BY name', [w.id]
    );
    res.json({ ...w, cards: cards.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/wishlist', requireAuth, async (req, res) => {
  try {
    const w = await getOrCreateWishlist();
    const { scryfall_id, name, quantity = 1, image_uri = '', mana_cost = '', type_line = '' } = req.body;
    const existing = await pool.query(
      'SELECT * FROM deck_cards WHERE deck_id=$1 AND scryfall_id=$2',
      [w.id, scryfall_id]
    );
    if (existing.rows.length > 0) {
      await pool.query(
        'UPDATE deck_cards SET quantity=quantity+$1 WHERE id=$2',
        [quantity, existing.rows[0].id]
      );
      res.json({ updated: true, wishlistId: w.id });
    } else {
      await pool.query(`
        INSERT INTO deck_cards (deck_id,scryfall_id,name,quantity,board,image_uri,mana_cost,type_line)
        VALUES ($1,$2,$3,$4,'main',$5,$6,$7)
      `, [w.id, scryfall_id, name, quantity, image_uri, mana_cost, type_line]);
      res.json({ added: true, wishlistId: w.id });
    }
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/wishlist/:cardId', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM deck_cards WHERE id=$1', [req.params.cardId]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// ================================================================
// START SERVER
// Render terminates SSL at their edge — app serves plain HTTP there.
// Locally we use self-signed HTTPS.
// ================================================================
const PORT = process.env.PORT || 3000;
const IS_RENDER = !!process.env.RENDER;

// Export app and initDB for testing
module.exports = { app, initDB };

// Only start server if this file is run directly (not imported by tests)
if (require.main === module) {
  (async () => {
    await initDB();

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
}
