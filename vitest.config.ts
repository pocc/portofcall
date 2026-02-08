import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Globals
    globals: true,

    // Test file patterns
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],

    // Timeout for each test
    testTimeout: 60000, // 60 seconds (FTP operations can be slow)

    // Hook timeout
    hookTimeout: 30000,

    // Reporter
    reporter: ['verbose', 'json', 'html'],

    // Output
    outputFile: {
      json: './test-results/results.json',
      html: './test-results/index.html',
    },

    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/worker/**/*.ts'],
      exclude: ['src/worker/index.ts'], // Exclude main entry point
    },
  },
});
