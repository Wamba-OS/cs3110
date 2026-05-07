import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, initDB } from '../server.js';

describe('Authentication', () => {
  let adminToken;
  let authorToken;

  beforeAll(async () => {
    // Initialize database before tests
    await initDB();
  });

  describe('POST /api/auth/login', () => {
    it('should login admin user with correct credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'Wamba',
          password: process.env.ADMIN_PASSWORD,
        })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('username', 'Wamba');
      expect(response.body).toHaveProperty('role', 'admin');

      // Save token for later tests
      adminToken = response.body.token;
    });

    it('should login author user with correct credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'Wamba_author',
          password: process.env.AUTHOR_PASSWORD,
        })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('username', 'Wamba_author');
      expect(response.body).toHaveProperty('role', 'author');

      // Save token for later tests
      authorToken = response.body.token;
    });

    it('should reject login with incorrect password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'Wamba',
          password: 'wrong-password',
        })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Invalid credentials');
    });

    it('should reject login with non-existent username', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'nonexistent',
          password: 'somepassword',
        })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Invalid credentials');
    });

    it('should reject login with missing credentials', async () => {
      await request(app)
        .post('/api/auth/login')
        .send({})
        .expect(400);
    });
  });

  describe('POST /api/auth/register', () => {
    it('should allow admin to create new author user', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'test_author',
          password: 'test_password',
          role: 'author',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('username', 'test_author');
      expect(response.body).toHaveProperty('role', 'author');
    });

    it('should allow admin to create new admin user', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'test_admin',
          password: 'test_password',
          role: 'admin',
        })
        .expect(201);

      expect(response.body).toHaveProperty('username', 'test_admin');
      expect(response.body).toHaveProperty('role', 'admin');
    });

    it('should reject duplicate username', async () => {
      await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'Wamba',
          password: 'somepassword',
          role: 'author',
        })
        .expect(409);
    });

    it('should reject registration by non-admin user', async () => {
      await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${authorToken}`)
        .send({
          username: 'unauthorized_user',
          password: 'test_password',
          role: 'author',
        })
        .expect(403);
    });

    it('should reject registration without auth token', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'no_auth',
          password: 'test_password',
          role: 'author',
        })
        .expect(401);
    });

    it('should reject invalid role', async () => {
      await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'invalid_role_user',
          password: 'test_password',
          role: 'superuser',
        })
        .expect(400);
    });
  });

  describe('JWT Token Validation', () => {
    it('should reject expired or invalid token', async () => {
      await request(app)
        .post('/api/auth/register')
        .set('Authorization', 'Bearer invalid-token-string')
        .send({
          username: 'should_fail',
          password: 'test_password',
          role: 'author',
        })
        .expect(401);
    });

    it('should reject malformed Authorization header', async () => {
      await request(app)
        .post('/api/auth/register')
        .set('Authorization', 'NotBearer token')
        .send({
          username: 'should_fail',
          password: 'test_password',
          role: 'author',
        })
        .expect(401);
    });
  });
});
