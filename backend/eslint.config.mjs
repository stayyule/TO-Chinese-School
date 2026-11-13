import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  {
    files: ['**/*.ts'],
    ignores: ['src/common/cents.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'Money is integer cents; use dollarsToCents from common/cents.',
        },
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: 'Money is integer cents; use formatCents from common/cents.',
        },
      ],
    },
  },
);
