import { defineConfig } from '@playwright/test'

const webPort = process.env.WEB_PORT ?? '5173'
const wsPort = process.env.WS_PORT ?? '8787'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: `http://127.0.0.1:${webPort}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      WEB_PORT: webPort,
      WS_PORT: wsPort,
    },
  },
})
