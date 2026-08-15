/**
 * Test setup for @joinery/main
 * Runs before each test file.
 */

import { afterAll } from 'vitest';
import { ConnectionPoolManager } from '../services/sql/connection-pool';

// Stop the cleanup timer to prevent Jest open handle warnings
afterAll(() => {
  try {
    ConnectionPoolManager.getInstance().stopCleanupTimer();
  } catch {
    // Singleton may not have been instantiated
  }
});
