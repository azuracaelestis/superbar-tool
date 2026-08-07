import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5183,
    proxy: {
      '/api': 'http://localhost:5184',
      '/fonts': 'http://localhost:5184',
      '/uploads': 'http://localhost:5184',
    },
  },
});
