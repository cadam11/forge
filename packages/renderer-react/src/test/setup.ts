import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest runs without `globals: true`, so Testing Library's automatic teardown
// never registers itself. Without this, mounted trees leak between test files
// in the same worker and queries match stale DOM.
afterEach(() => {
  cleanup();
});
