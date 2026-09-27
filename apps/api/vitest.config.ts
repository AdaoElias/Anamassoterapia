import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // A constraint de exclusao de agenda e global: dois arquivos rodando em
    // paralelo brigariam pelo mesmo horario. Suite sempre em serie.
    fileParallelism: false,
    pool: 'forks',
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      exclude: ['src/generated/**', '**/*.config.ts', 'tests/**'],
    },
  },
});
