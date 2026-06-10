import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      reporter: ['text', 'lcov']
    },
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts']
  }
});
