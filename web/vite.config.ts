import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Dedicated port for this project — 5173 (Vite's default) collides with
    // other local projects, so pin a fixed one and fail loudly if it's taken
    // rather than silently drifting to 5174+ (which breaks the preview attach).
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ingest': 'http://localhost:8787',
      // Only proxy the public API subpaths to Hono. The bare /public route
      // must reach the SPA so React renders the public view.
      '/public/world': 'http://localhost:8787',
      '/public/project': 'http://localhost:8787',
      '/public/events': 'http://localhost:8787',
    },
  },
})
