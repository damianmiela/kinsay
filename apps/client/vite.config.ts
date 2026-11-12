import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // phones a few years old: code iOS 15 and Chrome 96 understand
  build: { target: ['es2020', 'safari15', 'chrome96', 'firefox96', 'edge96'] },
  server: {
    port: 5180,
    // in development the API and Socket.IO go to the Fastify server
    proxy: {
      '/socket.io': { target: 'http://127.0.0.1:3300', ws: true },
      '/api/': 'http://127.0.0.1:3300',
      '/admin/api/': 'http://127.0.0.1:3300',
      '/admin/login': 'http://127.0.0.1:3300',
      '/admin/logout': 'http://127.0.0.1:3300',
    },
  },
});
