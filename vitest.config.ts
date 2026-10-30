import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': workspaceRoot },
  },
  test: {
    environment: 'node',
    env: { DATABASE_PATH: ':memory:' },
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});