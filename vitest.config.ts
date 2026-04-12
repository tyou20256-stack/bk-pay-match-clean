import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // HTTP-dependent tests are excluded from the default `vitest run` so
    // pure unit tests can run without a live server. They ARE run by CI
    // in the "Integration tests" step which boots dist/index.js first.
    exclude: [
      'tests/api.test.ts',
      'tests/api-security.test.ts',
      'tests/e2e.test.ts',
      'tests/extended.test.ts',
      'tests/integration.test.ts',
      'tests/phase3-5.test.ts',
    ],
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts'],
      thresholds: {
        statements: 15,
        branches: 10,
        functions: 10,
        lines: 15,
      },
    },
  },
});
