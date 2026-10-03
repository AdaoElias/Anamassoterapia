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
        projectService: {
          // A raiz do repo nao tem tsconfig.json -- ele fica em apps/*.
          // `scripts/criar-env.mjs` roda antes de qualquer `pnpm install`,
          // entao precisa ser JS puro, e o projectService so aceita arquivo
          // fora de todo tsconfig pela allow-list. Sem isto o arquivo falha
          // com "not found by the project service".
          allowDefaultProject: ['scripts/*.mjs'],
        },
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
    // `files` casa caminhos relativos a raiz do config, nao ao pacote: sem
    // o `**/`, um padrao `scripts/**` nunca alcança `apps/api/scripts/`.
    files: ['**/*.config.{js,ts}', '**/scripts/**/*.{js,mjs,cjs,ts}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    // O seed e um programa de CLI: o resumo que ele imprime no terminal
    // e a saida do programa, nao log esquecido no codigo. `no-console`
    // existe para a aplicacao, onde console vira log orfao -- aqui o
    // console.log e a interface.
    files: ['apps/api/prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  },
);
