import { defineConfig, devices } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

// Use a dedicated port to avoid clashing with local dev server defaults
const PORT = Number(process.env.PORT || 5191)
const HOST = process.env.HOST || 'localhost'
const BASE_HTTP = `http://${HOST}:${PORT}`
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..', '..', '..')
const STACK_ENV_PATH = process.env.POWERSYNC_STACK_ENV_PATH ?? resolve(repoRoot, '.env.powersync-stack')

if (existsSync(STACK_ENV_PATH)) {
  const raw = readFileSync(STACK_ENV_PATH, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('export ')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice('export '.length, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1)
    }
    const current = process.env[key]
    if (!current || !current.trim()) {
      process.env[key] = value
    }
  }
}

const stripQuotes = (value?: string) => {
  if (!value) return value
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

const getEnvOrEmpty = (...keys: string[]) => {
  for (const key of keys) {
    const value = stripQuotes(process.env[key])
    if (value) return value
  }
  return ''
}

const SUPABASE_URL = getEnvOrEmpty('VITE_SUPABASE_URL', 'POWERSYNC_SUPABASE_URL') || 'https://example.supabase.co'
const SUPABASE_ANON_KEY = getEnvOrEmpty('VITE_SUPABASE_ANON_KEY', 'POWERSYNC_SUPABASE_ANON_KEY') || 'test-anon-key'

const TEST_TIMEOUT_MS = 30_000
export const BASE_URL = BASE_HTTP

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  timeout: TEST_TIMEOUT_MS,

  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_HTTP,
    actionTimeout: TEST_TIMEOUT_MS,
    navigationTimeout: TEST_TIMEOUT_MS,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup-live',
      testMatch: /tests\/e2e\/setup\/live-stack\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup-live'],
      testIgnore: [/tests\/e2e\/setup\/.*/, /tests\/e2e\/live-.*\.spec\.ts/],
    },
    {
      name: 'chromium-live',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /tests\/e2e\/live-.*\.spec\.ts/,
      dependencies: ['setup-live'],
    },
  ],
  webServer: {
    // Spawn Vite via pnpm so the workspace-local version is used
    command: `pnpm exec vite --host ${HOST} --port ${PORT}`,
    url: BASE_HTTP,
    reuseExistingServer: true,
    cwd: resolve(__dirname),
    env: {
      ...process.env,
      VITE_POWERSYNC_DISABLED: process.env.VITE_POWERSYNC_DISABLED ?? 'true',
      VITE_POWERSYNC_USE_FIXTURES: process.env.VITE_POWERSYNC_USE_FIXTURES ?? 'true',
      VITE_POWERSYNC_USE_DAEMON: process.env.VITE_POWERSYNC_USE_DAEMON ?? 'true',
      VITE_POWERSYNC_REQUIRE_VAULT: process.env.VITE_POWERSYNC_REQUIRE_VAULT ?? 'false',
      VITE_SUPABASE_URL: SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    },
  },
  expect: {
    timeout: 10_000,
  },
  workers: 1
})
