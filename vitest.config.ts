import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: ['test/smoke/**', 'test/smoke.test.ts', 'node_modules/**'],
    setupFiles: ['test/vitest.setup.ts'],
  },
});
