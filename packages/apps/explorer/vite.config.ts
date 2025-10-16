import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

const resolveFromRoot = (p: string) => path.resolve(fileURLToPath(new URL('.', import.meta.url)), p)

const stackEnvPath = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..', '.env.powersync-stack')

const STACK_ENV_FALLBACKS: Record<string, string[]> = {
  VITE_SUPABASE_URL: ['POWERSYNC_SUPABASE_URL', 'PSGIT_TEST_SUPABASE_URL'],
  VITE_SUPABASE_ANON_KEY: ['POWERSYNC_SUPABASE_ANON_KEY', 'PSGIT_TEST_SUPABASE_ANON_KEY'],
  VITE_SUPABASE_SCHEMA: ['POWERSYNC_SUPABASE_SCHEMA'],
  VITE_POWERSYNC_ENDPOINT: ['POWERSYNC_ENDPOINT', 'PSGIT_TEST_ENDPOINT'],
  VITE_POWERSYNC_DAEMON_URL: ['POWERSYNC_DAEMON_URL', 'PSGIT_TEST_DAEMON_URL'],
  VITE_POWERSYNC_USE_DAEMON: ['POWERSYNC_USE_DAEMON'],
  POWERSYNC_DAEMON_DEVICE_URL: ['POWERSYNC_DAEMON_DEVICE_URL'],
}

function loadStackEnv(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {}
  }
  const output: Record<string, string> = {}
  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith('export ')) continue
    const assignment = trimmed.slice('export '.length)
    const eqIndex = assignment.indexOf('=')
    if (eqIndex === -1) continue
    const key = assignment.slice(0, eqIndex).trim()
    let value = assignment.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    output[key] = value
  }
  return output
}

const stackEnv = loadStackEnv(stackEnvPath)

const PLACEHOLDER_PATTERNS: Array<(value: string) => boolean> = [
  (value) => value.trim().length === 0,
  (value) => value.trim().toLowerCase() === 'dev-token-placeholder',
  (value) => value.trim().toLowerCase() === 'anon-placeholder',
  (value) => value.trim().toLowerCase() === 'service-role-placeholder',
  (value) => value.trim().toLowerCase() === 'powersync-remote-placeholder',
  (value) => /^https?:\/\/localhost(?::\d+)?\/?$/.test(value.trim().toLowerCase()) && value.includes('8090'),
]

const isPlaceholder = (rawValue: string | undefined | null): boolean => {
  if (typeof rawValue !== 'string') return true
  const value = rawValue.trim()
  if (!value) return true
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern(value))
}

function applyStackEnvFallbacks() {
  const defaults: Record<string, string> = {
    VITE_SUPABASE_URL: 'http://127.0.0.1:55431',
    VITE_SUPABASE_ANON_KEY:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
    VITE_POWERSYNC_ENDPOINT: 'http://127.0.0.1:55440',
    VITE_POWERSYNC_DAEMON_URL: 'http://127.0.0.1:5030',
    VITE_POWERSYNC_USE_DAEMON: 'true',
    POWERSYNC_DAEMON_DEVICE_URL: 'http://localhost:5783/auth',
  }

  for (const [target, fallbacks] of Object.entries(STACK_ENV_FALLBACKS)) {
    const current = process.env[target]
    if (!isPlaceholder(current)) {
      continue
    }
    const candidates = [
      process.env[target],
      stackEnv[target],
      ...fallbacks.map((key) => process.env[key] ?? stackEnv[key]),
    ].filter((value): value is string => typeof value === 'string' && !isPlaceholder(value))
    const resolved = candidates.find(Boolean)
    if (resolved) {
      process.env[target] = resolved.trim()
    } else if (defaults[target]) {
      process.env[target] = defaults[target]
    }
  }

  if (!process.env.VITE_PORT) {
    process.env.VITE_PORT = '5783'
  }
}

applyStackEnvFallbacks()

const repoBase = (() => {
  if (process.env.GITHUB_PAGES?.toLowerCase() === 'true') {
    const repo = process.env.GITHUB_REPOSITORY?.split('/')?.[1]
    if (repo) {
      return `/${repo}/`
    }
  }
  if (process.env.VITE_BASE_PATH) {
    const base = process.env.VITE_BASE_PATH.trim()
    if (base) return base.endsWith('/') ? base : `${base}/`
  }
  return '/'
})()

const devServerPort = (() => {
  const candidate = process.env.VITE_PORT ?? process.env.PORT ?? '5783'
  const parsed = Number.parseInt(candidate, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5783
})()

export default defineConfig({
  base: repoBase,
  plugins: [wasm(), topLevelAwait(), react()],
  define: { 'process.env': {} },
  envPrefix: ['VITE_', 'POWERSYNC_', 'PSGIT_'],
  resolve: {
    alias: {
      '@ps': resolveFromRoot('src/ps'),
      '@tsdb': resolveFromRoot('src/tsdb'),
      '@shared/core/powersync/schema': resolveFromRoot('../../shared/src/powersync/schema.ts'),
      '@shared/core': resolveFromRoot('../../shared/src/index.ts'),
      '@shared/core/': `${resolveFromRoot('../../shared/src')}/`,
    },
  },
  optimizeDeps: {
    exclude: ['@journeyapps/wa-sqlite', '@powersync/web'],
  },
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  server: {
    port: devServerPort,
    strictPort: true,
    host: '127.0.0.1',
    fs: {
      allow: [resolveFromRoot('../../..')],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
})
