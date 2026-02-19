import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Environment variables for tests
    // Note: Tests define their own API_BASE defaults
    // Uncomment below only for local Worker testing:
    env: {
      API_BASE: 'http://localhost:8787/api',
    },

    // Globals
    globals: true,

    // Test file patterns
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['tests/ftp-integration.test.js'], // Standalone Node script, not Vitest-compatible

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
