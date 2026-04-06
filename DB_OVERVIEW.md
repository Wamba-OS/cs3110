# Database Overview — Vault of Tarnished Sigils

## Persistence Approach

**SQL — PostgreSQL hosted on Neon (neon.tech)**

The server uses the `pg` npm package to connect to a free PostgreSQL instance on Neon. The
connection string is stored in the `DATABASE_URL` environment variable set in Render's dashboard —
it never appears in source code. Because the database lives outside of Render's ephemeral
filesystem, all data survives server restarts and redeployments.

```js
// server.js — connection pool (DATABASE_URL set in Render env vars)
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },  // required for Neon
});
```

---

## Schema

Tables are created with `CREATE TABLE IF NOT EXISTS` on every server boot, so a fresh Neon
database is initialised automatically on first deploy.

```js
// server.js — initDB()
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
```

### Table summary

| Table | Purpose |
|---|---|
| `users` | Login credentials (bcrypt-hashed passwords) and roles |
| `collection` | The user's owned MTG cards |
| `decks` | Named deck lists; `is_wishlist=1` marks the special wish-list deck |
| `deck_cards` | Individual card entries inside a deck or wishlist |

`deck_cards.deck_id` references `decks(id) ON DELETE CASCADE`, so deleting a deck automatically
removes all its cards.

---

## CRUD Operations

Every resource implements all four operations.

### CREATE

**New card in collection** — `POST /api/collection` (auth required)

If the same card+foil combo already exists the quantity is incremented instead of inserting a
duplicate row.

```js
// server.js
const existing = await pool.query(
  'SELECT * FROM collection WHERE scryfall_id=$1 AND foil=$2',
  [scryfall_id, foilInt]
);

if (existing.rows.length > 0) {
  // upsert: bump quantity
  const newQty = existing.rows[0].quantity + quantity;
  await pool.query('UPDATE collection SET quantity=$1 WHERE id=$2', [newQty, existing.rows[0].id]);
} else {
  // fresh insert — RETURNING id gives us the new row's PK
  const r = await pool.query(`
    INSERT INTO collection
      (scryfall_id,name,set_code,set_name,rarity,mana_cost,type_line,image_uri,quantity,foil,condition)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id
  `, [scryfall_id, name, set_code, set_name, rarity, mana_cost, type_line, image_uri, quantity, foilInt, condition]);
  res.status(201).json({ id: r.rows[0].id, ... });
}
```

**New deck** — `POST /api/decks` (auth required)

```js
const r = await pool.query(
  'INSERT INTO decks (name,description,format) VALUES ($1,$2,$3) RETURNING id',
  [name, description, format]
);
res.status(201).json({ id: r.rows[0].id, name, description, format, is_wishlist: 0, card_count: 0 });
```

### READ

**Full collection** — `GET /api/collection` (public)

```js
const result = await pool.query('SELECT * FROM collection ORDER BY name');
res.json(result.rows);
```

**Single deck with its cards** — `GET /api/decks/:id` (public)

```js
const deckRes = await pool.query('SELECT * FROM decks WHERE id=$1', [req.params.id]);
const cards   = await pool.query('SELECT * FROM deck_cards WHERE deck_id=$1 ORDER BY name', [req.params.id]);
res.json({ ...deckRes.rows[0], cards: cards.rows });
```

**Deck list with card counts** — `GET /api/decks` (public)

```js
const result = await pool.query(`
  SELECT d.*, COUNT(dc.id)::int AS card_count
  FROM decks d LEFT JOIN deck_cards dc ON dc.deck_id=d.id
  WHERE d.is_wishlist=0
  GROUP BY d.id ORDER BY d.created_at DESC
`);
res.json(result.rows);
```

### UPDATE

**Edit collection entry** — `PUT /api/collection/:id` (auth required)

```js
await pool.query(
  'UPDATE collection SET quantity=$1,condition=$2,foil=$3 WHERE id=$4',
  [quantity, condition, foil ? 1 : 0, req.params.id]
);
res.json({ success: true });
```

**Edit deck metadata** — `PUT /api/decks/:id` (auth required)

```js
await pool.query(
  'UPDATE decks SET name=$1,description=$2,format=$3 WHERE id=$4',
  [name, description, format, req.params.id]
);
```

### DELETE

**Remove card from collection** — `DELETE /api/collection/:id` (auth required)

```js
await pool.query('DELETE FROM collection WHERE id=$1', [req.params.id]);
res.json({ success: true });
```

**Delete a deck** — `DELETE /api/decks/:id` (auth required)

The `ON DELETE CASCADE` constraint on `deck_cards.deck_id` means all cards in the deck are removed
automatically by the database — no extra query needed.

```js
await pool.query('DELETE FROM decks WHERE id=$1', [req.params.id]);
res.json({ success: true });
```

---

## Authentication & Password Security

Passwords are hashed with **bcrypt (10 salt rounds)** before storage. The plain-text password
never touches the database.

```js
// Registering a new user — POST /api/auth/register (admin only)
const hash = bcrypt.hashSync(password, 10);
const r = await pool.query(
  'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
  [username, hash, role]
);
```

Login verifies the submitted password against the stored hash:

```js
// POST /api/auth/login
const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
const user = result.rows[0];
if (!user || !bcrypt.compareSync(password, user.password_hash)) {
  return res.status(401).json({ error: 'Invalid credentials' });
}
```

On success a signed **JWT** (8-hour expiry, secret from `JWT_SECRET` env var) is issued. All
mutation endpoints verify this token:

```js
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
```

---

## Admin seeding

The admin account is created on first boot from environment variables — the password is never
hard-coded in source:

```js
const adminCheck = await pool.query("SELECT id FROM users WHERE username='Wamba'");
if (adminCheck.rows.length === 0) {
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
  await pool.query(
    "INSERT INTO users (username, password_hash, role) VALUES ('Wamba', $1, 'admin')",
    [hash]
  );
}
```

---

## SSL / HTTPS

- **Deployed (Render):** TLS is terminated at Render's edge proxy. The Node process serves plain
  HTTP internally; the public URL is `https://`.
- **Local dev:** `selfsigned` generates a self-signed cert on first run. The server starts an
  `https.createServer` with those files.

---

## Requirement Checklist

| Requirement | How it is met |
|---|---|
| Persist data across restarts | PostgreSQL on Neon — data lives outside Render's ephemeral filesystem |
| Store user-generated content | `collection`, `decks`, `deck_cards` tables |
| Store authentication information | `users` table |
| Create persistent entries | `POST /api/collection`, `/api/decks`, `/api/decks/:id/cards`, `/api/wishlist` |
| Update persistent entries | `PUT /api/collection/:id`, `/api/decks/:id`, `/api/decks/:deckId/cards/:cardId` |
| Delete persistent entries | `DELETE /api/collection/:id`, `/api/decks/:id`, `/api/wishlist/:cardId` |
| Serve persistent entries | `GET /api/collection`, `/api/decks`, `/api/decks/:id`, `/api/wishlist` |
| Secure password storage | bcrypt (10 rounds) — plain-text password never stored |
| SSL-protected deployment | Render HTTPS edge + local self-signed cert |
