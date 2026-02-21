import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/', 'node_modules/', '.wrangler/', 'test-results/'],
  },
  {
    rules: {
      // Allow unused vars prefixed with _
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Allow explicit any in worker protocol handlers (common for socket data)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow non-null assertions (used in xterm refs, etc.)
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
