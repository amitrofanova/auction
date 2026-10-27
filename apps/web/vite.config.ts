import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const webPort = Number(process.env.WEB_PORT ?? 5173)
const wsPort = process.env.WS_PORT ?? '8787'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: {
      '/ws': {
        target: `http://127.0.0.1:${wsPort}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
