import { beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';

// Load .env file first
dotenv.config();

// Set test environment variables
beforeAll(() => {
  // Use test database URL if provided, otherwise use production DB
  // NOTE: For production use, create a separate TEST_DATABASE_URL in your .env
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }

  // Use test-specific credentials if provided, otherwise use production credentials
  // This allows tests to run without a separate test database (though not recommended)
  if (process.env.TEST_JWT_SECRET) {
    process.env.JWT_SECRET = process.env.TEST_JWT_SECRET;
  }
  if (process.env.TEST_ADMIN_PASSWORD) {
    process.env.ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;
  }
  if (process.env.TEST_AUTHOR_PASSWORD) {
    process.env.AUTHOR_PASSWORD = process.env.TEST_AUTHOR_PASSWORD;
  }

  // Disable Render detection in tests
  delete process.env.RENDER;

  // Set test port to avoid conflicts
  process.env.PORT = process.env.TEST_PORT || '3001';
});

afterAll(() => {
  // Cleanup after all tests complete
});
