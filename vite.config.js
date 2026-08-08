import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5188,
    host: true,
    proxy: {
      '/api': 'http://localhost:8790',
      '/agent': 'http://localhost:8790',
      '/.well-known': 'http://localhost:8790',
    },
  },
})
