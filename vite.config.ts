import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const root = path.dirname(fileURLToPath(import.meta.url));
const API_PORT = Number(process.env.API_PORT ?? 4000);

export default defineConfig({
  root: path.join(root, 'client'),
  publicDir: path.join(root, 'client/public'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.join(root, 'client/src'),
      '@shared': path.join(root, 'shared'),
    },
  },
  css: {
    postcss: { plugins: [tailwindcss({ config: path.join(root, 'tailwind.config.ts') }), autoprefixer()] },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: false,
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/ws': { target: `ws://localhost:${API_PORT}`, ws: true },
    },
  },
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
