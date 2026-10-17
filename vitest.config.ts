import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(root, 'client/src'),
      '@shared': path.join(root, 'shared'),
    },
  },
  test: {
    root,
    include: ['tests/unit/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
  },
});
