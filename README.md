# Vault of Tarnished Sigils

A Diablo II-themed Magic: The Gathering card catalog web application. Built with Node.js, Express, and SQLite on the backend, and vanilla JavaScript on the frontend. Card data is sourced live from the [Scryfall API](https://scryfall.com/docs/api).

**Live App:** [https://cs3110hub.ddns.net/](https://cs3110hub.ddns.net/)

---

## Tech Stack

- **Backend:** Node.js + Express.js
- **Database:** SQLite via `better-sqlite3`
- **Frontend:** Vanilla HTML/CSS/JavaScript (no framework)
- **External APIs:** Scryfall (card data), Tesseract.js (OCR for card scanning)

---

## Pages

### Search (`index.html`)
The main card search page powered by the Scryfall API.

- Search cards by name, color identity, type, and set code
- Sort results by name, color, rarity, release date, or price
- Paginate through large result sets
- Random Set button — fetches a random card, then loads its entire set
- Hover over any card to see a tooltip with mana cost, oracle text, flavor text, power/toughness, set, and artist
- Click any card to open a detail modal where you can:
  - Set quantity, condition (NM/LP/MP/HP/DMG), and foil flag
  - Add the card to your collection (My Vault)
  - Add the card to your Wishlist
  - Add the card directly to a deck (select from dropdown)
- Stats sidebar showing color distribution, type breakdown, and rarity breakdown for the current search results

### My Vault (`collection.html`)
Displays all cards in your personal collection stored in the local database.

- Filter by card name (live search), rarity checkboxes, and condition checkboxes
- Sort by name, quantity, rarity, or date added
- Shows card count vs total in the current filter (`X / Y relics`)
- Click any card to open an edit modal:
  - Adjust quantity with +/- buttons or direct input
  - Change condition and foil status
  - Remove the card from the vault entirely
- Stats sidebar showing unique card count, total card count, color breakdown, rarity breakdown, and foil count

### Decks & Wishlist (`decks.html`)
Manage multiple deck lists and a personal wishlist.

- Create new decks with a name and format (Standard, Modern, Commander, Legacy, Vintage, Casual, etc.)
- Rename or delete existing decks
- View cards in a deck grouped by card type (Creatures, Instants, Sorceries, Enchantments, Artifacts, Planeswalkers, Lands, Other)
- Each card row shows quantity, mana pip icons, and card name with +/- and remove buttons
- Inline Scryfall search inside each deck — type to search, click a result to add it instantly
- Wishlist — a special persistent list for cards you want to acquire, accessible from the sidebar

### Card Scanner (`scan.html`)
Identify physical cards using your device camera or an uploaded image.

- Start your device camera (prefers rear-facing) or upload an image file
- Capture a frame, then run OCR (Tesseract.js) on the top 20% of the image where the card name appears
- Displays live progress as the OCR engine loads and processes
- Sends the cleaned OCR text to Scryfall via fuzzy name match + full-text search
- Shows up to 6 candidate matches — click the correct card to confirm it
- Set quantity, condition, and foil, then add the confirmed card to My Vault

---

## API Routes

All routes are served by `server.js` at `/api/`.

### Collection

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/collection` | Return all cards in the collection, ordered by name |
| POST | `/api/collection` | Add a card; auto-increments quantity if the same card+foil combo already exists |
| PUT | `/api/collection/:id` | Update quantity, condition, and foil for a collection entry |
| DELETE | `/api/collection/:id` | Remove a card from the collection |

### Decks

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/decks` | Return all decks (excluding wishlists) with total card count |
| POST | `/api/decks` | Create a new deck |
| GET | `/api/decks/:id` | Return a single deck with its full card list |
| PUT | `/api/decks/:id` | Update deck name, description, and format |
| DELETE | `/api/decks/:id` | Delete a deck and all its cards (cascading delete) |
| POST | `/api/decks/:id/cards` | Add a card to a deck; auto-increments if card+board already exists |
| PUT | `/api/decks/:deckId/cards/:cardId` | Update a deck card's quantity; deletes the entry if quantity reaches 0 |
| DELETE | `/api/decks/:deckId/cards/:cardId` | Remove a specific card from a deck |

### Wishlist

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/wishlist` | Return the wishlist with all cards (auto-creates wishlist if none exists) |
| POST | `/api/wishlist` | Add a card to the wishlist; auto-increments quantity if already present |
| DELETE | `/api/wishlist/:cardId` | Remove a card from the wishlist |

---

## Database Schema

The SQLite database (`vault.db`) has three tables:

**`collection`** — Physical card inventory
- `scryfall_id`, `name`, `set_code`, `set_name`, `rarity`, `mana_cost`, `type_line`, `image_uri`
- `quantity`, `foil` (0/1), `condition` (NM/LP/MP/HP/DMG), `added_at`

**`decks`** — Deck and wishlist metadata
- `name`, `description`, `format`, `is_wishlist` (0/1), `created_at`

**`deck_cards`** — Cards belonging to a deck or wishlist
- `deck_id` (FK → decks), `scryfall_id`, `name`, `quantity`, `board` (main/sideboard), `image_uri`, `mana_cost`, `type_line`

Foreign keys are enforced and `deck_cards` cascade-deletes when a deck is removed. The database runs in WAL mode for better concurrent read performance.

---

## Running Locally

```bash
npm install
npm start
# Server runs at http://localhost:3000
```

Requires Node.js 20.x.
