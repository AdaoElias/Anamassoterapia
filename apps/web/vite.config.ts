import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3333';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Proxy evita CORS no dev e deixa o cookie de refresh same-site,
    // que e a configuracao que vai para producao.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
      '/docs': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2023',
    // Bundle inicial enxuto: o agendamento publico e o caminho critico
    // e roda em conexao de celular ruim. Rolldown (Vite 8) exige a forma
    // de funcao, nao o mapa por nome.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) {
            return 'react';
          }
          if (id.includes('@tanstack')) return 'query';
          return undefined;
        },
      },
    },
  },
});
