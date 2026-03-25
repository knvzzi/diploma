import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

// Алиас "@" → "./src" нужен для Shadcn UI:
// компоненты импортируются как "@/components/ui/button", а не по относительному пути.
// basicSsl — HTTPS для локальной разработки (Geolocation API на мобильных требует secure context).
export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        // Убедись, что здесь НЕТ лишних rewrite, если бэкенд ожидает именно /api/...
      },
    },
  },
});
