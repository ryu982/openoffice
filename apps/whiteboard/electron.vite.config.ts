import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const bundled = [
  '@genoffice/i18n',
  '@genoffice/electron-utils',
  '@genoffice/whiteboard-engine',
  '@genoffice/print-layout',
  '@genoffice/file-parse',
  '@genoffice/ai-provider',
  '@genoffice/ai-search',
  '@genoffice/agent-core',
  '@genoffice/project-store',
  '@genoffice/ui',
]

export default defineConfig({
  // workspace packages ship as TS source and must be bundled
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundled })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundled })],
  },
  renderer: {
    plugins: [react()],
    server: {
      port: Number(process.env.WHITEBOARD_DEV_PORT) || 5183,
      strictPort: Boolean(process.env.WHITEBOARD_DEV_PORT),
    },
  },
})
