#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../../../..')
const STACK_ENV_PATH = resolve(repoRoot, '.env.powersync-stack')

function parseStackEnv(path) {
  if (!existsSync(path)) {
    return {}
  }
  const raw = readFileSync(path, 'utf8')
  const entries = {}
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
    entries[key] = value
  }
  return entries
}

function applyFallback(mapping, stackEnv, defaults = {}) {
  for (const [target, sources] of Object.entries(mapping)) {
    if (process.env[target] && process.env[target].trim().length > 0) {
      continue
    }
    let resolved = null
    for (const source of sources) {
      const candidate = process.env[source] ?? stackEnv[source]
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        resolved = candidate.trim()
        break
      }
    }
    if (!resolved && typeof defaults[target] === 'string') {
      resolved = defaults[target]
    }
    if (resolved) {
      process.env[target] = resolved
    }
  }
}

function ensureDefaults(stackEnv, defaults = {}) {
  if (!process.env.VITE_PORT || process.env.VITE_PORT.trim().length === 0) {
    process.env.VITE_PORT = '5783'
  }
  if (!process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL.trim().length === 0) {
    process.env.VITE_SUPABASE_URL = stackEnv.POWERSYNC_SUPABASE_URL ?? defaults.VITE_SUPABASE_URL ?? 'http://127.0.0.1:55431'
  }
  if (!process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY.trim().length === 0) {
    process.env.VITE_SUPABASE_ANON_KEY = stackEnv.POWERSYNC_SUPABASE_ANON_KEY ?? defaults.VITE_SUPABASE_ANON_KEY ?? ''
  }
  if (!process.env.VITE_POWERSYNC_ENDPOINT || process.env.VITE_POWERSYNC_ENDPOINT.trim().length === 0) {
    process.env.VITE_POWERSYNC_ENDPOINT = stackEnv.POWERSYNC_ENDPOINT ?? defaults.VITE_POWERSYNC_ENDPOINT ?? 'http://127.0.0.1:55440'
  }
  if (!process.env.POWERSYNC_DAEMON_DEVICE_URL || process.env.POWERSYNC_DAEMON_DEVICE_URL.trim().length === 0) {
    process.env.POWERSYNC_DAEMON_DEVICE_URL = `http://localhost:${process.env.VITE_PORT}/auth`
  }
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'development'
  }
}

const stackEnv = parseStackEnv(STACK_ENV_PATH)

const STACK_FALLBACKS = {
  VITE_SUPABASE_URL: ['VITE_SUPABASE_URL', 'POWERSYNC_SUPABASE_URL', 'PSGIT_TEST_SUPABASE_URL'],
  VITE_SUPABASE_ANON_KEY: ['VITE_SUPABASE_ANON_KEY', 'POWERSYNC_SUPABASE_ANON_KEY', 'PSGIT_TEST_SUPABASE_ANON_KEY'],
  VITE_SUPABASE_SCHEMA: ['VITE_SUPABASE_SCHEMA', 'POWERSYNC_SUPABASE_SCHEMA'],
  VITE_POWERSYNC_ENDPOINT: ['VITE_POWERSYNC_ENDPOINT', 'POWERSYNC_ENDPOINT', 'PSGIT_TEST_ENDPOINT'],
  VITE_POWERSYNC_DEFAULT_REPOS: ['VITE_POWERSYNC_DEFAULT_REPOS'],
  VITE_POWERSYNC_DISABLED: ['VITE_POWERSYNC_DISABLED'],
  POWERSYNC_DAEMON_DEVICE_URL: ['POWERSYNC_DAEMON_DEVICE_URL'],
}

const DEFAULTS = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:55431',
  VITE_SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  VITE_POWERSYNC_ENDPOINT: 'http://127.0.0.1:55440',
}

applyFallback(STACK_FALLBACKS, stackEnv, DEFAULTS)
ensureDefaults(stackEnv, DEFAULTS)

console.info('[explorer] dev server starting with:')
console.info(`  VITE_SUPABASE_URL=${process.env.VITE_SUPABASE_URL}`)
console.info(`  VITE_POWERSYNC_ENDPOINT=${process.env.VITE_POWERSYNC_ENDPOINT}`)
console.info(`  POWERSYNC_DAEMON_DEVICE_URL=${process.env.POWERSYNC_DAEMON_DEVICE_URL}`)

const child = spawn(
  'vite',
  process.argv.slice(2),
  {
    stdio: 'inherit',
    env: process.env,
  },
)

child.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
  } else {
    process.exit(code ?? 0)
  }
})

child.on('error', (error) => {
  console.error('[explorer] failed to launch Vite dev server:', error)
  process.exit(1)
})
