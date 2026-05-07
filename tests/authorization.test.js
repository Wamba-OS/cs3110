import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, initDB } from '../server.js';

describe('Authorization - Cross-user data access', () => {
  let user1Token;
  let user2Token;
  let user1Collection;
  let user1Deck;
  let adminToken;

  beforeAll(async () => {
    await initDB();

    // Login as admin to create test users
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'Wamba',
        password: process.env.ADMIN_PASSWORD,
      });
    adminToken = adminRes.body.token;

    // Create two test users
    await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'testuser1',
        password: 'password1',
        role: 'author',
      });

    await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'testuser2',
        password: 'password2',
        role: 'author',
      });

    // Login as both users
    const user1Res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser1', password: 'password1' });
    user1Token = user1Res.body.token;

    const user2Res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser2', password: 'password2' });
    user2Token = user2Res.body.token;

    // User1 creates a collection entry
    const collRes = await request(app)
      .post('/api/collection')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        scryfall_id: 'test-card-123',
        name: 'Test Card',
        set_code: 'TST',
        quantity: 1,
      });
    user1Collection = collRes.body;

    // User1 creates a deck
    const deckRes = await request(app)
      .post('/api/decks')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'User1 Test Deck',
        format: 'Standard',
      });
    user1Deck = deckRes.body;
  });

  describe('Collection isolation', () => {
    it('should allow user to update their own collection entry', async () => {
      await request(app)
        .put(`/api/collection/${user1Collection.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          quantity: 2,
          condition: 'LP',
          foil: 0,
        })
        .expect(200);
    });

    it('should allow user to delete their own collection entry', async () => {
      // Create a new entry to delete
      const createRes = await request(app)
        .post('/api/collection')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          scryfall_id: 'delete-test-456',
          name: 'Delete Test Card',
          quantity: 1,
        });

      await request(app)
        .delete(`/api/collection/${createRes.body.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);
    });

    // Note: Current implementation does NOT enforce per-user collection isolation
    // This is a known limitation - the collection is shared across all users
    // If you want per-user collections, the schema needs user_id foreign key
    it('NOTE: Collection is currently shared (not user-isolated)', async () => {
      // This documents current behavior - collection is global
      const res = await request(app).get('/api/collection');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Deck isolation', () => {
    it('should allow user to update their own deck', async () => {
      await request(app)
        .put(`/api/decks/${user1Deck.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Updated Deck Name',
          description: 'Updated description',
          format: 'Modern',
        })
        .expect(200);
    });

    it('should allow user to delete their own deck', async () => {
      // Create a new deck to delete
      const createRes = await request(app)
        .post('/api/decks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Deck to Delete',
          format: 'Casual',
        });

      await request(app)
        .delete(`/api/decks/${createRes.body.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);
    });

    it('should allow user to add cards to their own deck', async () => {
      await request(app)
        .post(`/api/decks/${user1Deck.id}/cards`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          scryfall_id: 'deck-card-789',
          name: 'Deck Test Card',
          quantity: 4,
        })
        .expect(201);
    });

    // Note: Current implementation does NOT enforce per-user deck isolation
    // This is a known limitation - any authenticated user can modify any deck
    // If you want per-user decks, the schema needs user_id foreign key
    it('NOTE: Decks are currently shared (not user-isolated)', async () => {
      // This documents current behavior - decks are global
      const res = await request(app).get('/api/decks');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Unauthenticated access', () => {
    it('should reject collection modification without token', async () => {
      await request(app)
        .post('/api/collection')
        .send({
          scryfall_id: 'unauthorized-test',
          name: 'Should Fail',
          quantity: 1,
        })
        .expect(401);
    });

    it('should reject deck creation without token', async () => {
      await request(app)
        .post('/api/decks')
        .send({
          name: 'Unauthorized Deck',
          format: 'Standard',
        })
        .expect(401);
    });

    it('should allow public read of collection', async () => {
      await request(app)
        .get('/api/collection')
        .expect(200);
    });

    it('should allow public read of decks', async () => {
      await request(app)
        .get('/api/decks')
        .expect(200);
    });
  });
});
