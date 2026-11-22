import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// renderer-only dev server (embedded by shell via WHITEBOARD_RENDERER_URL for HMR; no standalone Electron)
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: {
    port: Number(process.env.WHITEBOARD_DEV_PORT) || 5183,
    strictPort: true,
  },
})
