import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'public/js/**/*.js'],
      exclude: ['src/server.ts', 'public/js/app.js', 'public/js/recorder.js'],
      reporter: ['text', 'text-summary', 'lcov'],
      thresholds: { lines: 85, functions: 85, branches: 75, statements: 85 },
    },
  },
});
