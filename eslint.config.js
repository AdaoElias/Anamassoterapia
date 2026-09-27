import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/next/**',
      'apps/api/src/generated/**',
      '**/*.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,

  {
    // O plugin precisa ser registrado explicitamente: a v14 nao expoe mais
    // um flat config pronto, e passar o objeto direto quebra o ESLint 10.
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  {
    // Fastify aceita handler sincrono de proposito, e uma rota sem I/O e o
    // caso mais comum. A regra faz sentido em `services/` (onde um await
    // esquecido e bug real) e so atrapalha em `routes/` e `plugins/`.
    files: ['apps/api/src/routes/**/*.ts', 'apps/api/src/plugins/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['**/*.config.{js,ts}', 'scripts/**/*.{js,ts}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
