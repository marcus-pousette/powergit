import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@playwright/test'
import { loadProfileEnvironment } from '../../../../../cli/src/profile-env.js'
import { ensureDaemonSupabaseAuth } from '../../../../../../scripts/dev-shared.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(process.cwd(), '../../..')

const STACK_HOST = process.env.POWERSYNC_STACK_HOST ?? '127.0.0.1'
const STACK_PORT = Number.parseInt(process.env.POWERSYNC_STACK_PORT ?? '55431', 10)
const START_COMMAND = (process.env.POWERSYNC_STACK_START ?? 'pnpm dev:stack:up').split(/\s+/)
const STOP_COMMAND = (process.env.POWERSYNC_STACK_STOP ?? 'pnpm dev:stack stop').split(/\s+/)
if (!START_COMMAND[0]) {
  throw new Error('Invalid POWERSYNC_STACK_START command.')
}
if (!STOP_COMMAND[0]) {
  throw new Error('Invalid POWERSYNC_STACK_STOP command.')
}
const TCP_TIMEOUT_MS = Number.parseInt(process.env.POWERSYNC_STACK_PROBE_TIMEOUT_MS ?? '1000', 10)
const TCP_RETRY_DELAY_MS = Number.parseInt(process.env.POWERSYNC_STACK_RETRY_DELAY_MS ?? '1000', 10)
const STACK_START_TIMEOUT_MS = Number.parseInt(process.env.POWERSYNC_STACK_START_TIMEOUT_MS ?? '120000', 10)
const DAEMON_WAIT_TIMEOUT_MS = Number.parseInt(process.env.POWERSYNC_DAEMON_READY_TIMEOUT_MS ?? '20000', 10)

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function randomSlug(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${timestamp}-${random}`.replace(/[^a-z0-9-]/gi, '').toLowerCase()
}

function ensureLiveRemoteUrl(): void {
  const existing = firstNonEmpty(
    process.env.PSGIT_TEST_REMOTE_URL,
    process.env.POWERSYNC_SEED_REMOTE_URL,
    process.env.POWERSYNC_TEST_REMOTE_URL,
  )
  if (existing) {
    process.env.PSGIT_TEST_REMOTE_URL = existing
    return
  }

  const endpoint =
    firstNonEmpty(
      process.env.POWERSYNC_ENDPOINT,
      process.env.POWERSYNC_DAEMON_ENDPOINT,
      process.env.POWERSYNC_DAEMON_URL,
    ) ?? 'http://127.0.0.1:5030'
  const normalized = normalizeBaseUrl(endpoint)
  const org = randomSlug('ps-e2e-org')
  const repo = randomSlug('ps-e2e-repo')
  const remoteUrl = `powersync::${normalized}/orgs/${org}/repos/${repo}`
  process.env.PSGIT_TEST_REMOTE_URL = remoteUrl
  if (!process.env.POWERSYNC_SEED_REMOTE_URL) {
    process.env.POWERSYNC_SEED_REMOTE_URL = remoteUrl
  }
  console.info(`[live-setup] Using PowerSync test remote ${remoteUrl}`)
}

async function delay(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function checkTcpConnectivity(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let settled = false

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }

    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(timeoutMs, () => finish(false))
  })
}

async function isStackRunning(): Promise<boolean> {
  return checkTcpConnectivity(STACK_HOST, STACK_PORT, TCP_TIMEOUT_MS)
}

async function waitForStackReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isStackRunning()) {
      return
    }
    await delay(TCP_RETRY_DELAY_MS)
  }
  throw new Error(`PowerSync dev stack did not become ready within ${timeoutMs}ms (host ${STACK_HOST}, port ${STACK_PORT})`)
}

async function waitForDaemonReady(timeoutMs: number): Promise<void> {
  const daemonUrl = getDaemonBaseUrl()
  const normalized = daemonUrl.replace(/\/+$/, '')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${normalized}/health`)
      if (response.ok) {
        return
      }
    } catch {
      // ignore and retry
    }
    await delay(TCP_RETRY_DELAY_MS)
  }
  throw new Error(`PowerSync daemon did not become ready within ${timeoutMs}ms (url ${daemonUrl})`)
}

function getDaemonBaseUrl(): string {
  return (
    process.env.POWERSYNC_DAEMON_URL ??
    process.env.POWERSYNC_DAEMON_ENDPOINT ??
    'http://127.0.0.1:5030'
  )
}

async function isDaemonResponsive(): Promise<boolean> {
  try {
    const response = await fetch(`${normalizeBaseUrl(getDaemonBaseUrl())}/health`)
    return response.ok
  } catch {
    return false
  }
}

let daemonProcess: ReturnType<typeof spawn> | null = null
let daemonStartedBySuite = false

async function ensureDaemonProcessRunning(): Promise<void> {
  if (await isDaemonResponsive()) {
    return
  }
  const profile = process.env.STACK_PROFILE ?? 'local-dev'
  const script = resolve(repoRoot, 'scripts', 'start-daemon-with-profile.mjs')
  daemonProcess = spawn(process.execPath, [script, '--profile', profile], {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: 'ignore',
    detached: true,
  })
  daemonProcess.unref()
  daemonStartedBySuite = true
  await waitForDaemonReady(DAEMON_WAIT_TIMEOUT_MS)
}

async function stopDaemonProcess(): Promise<void> {
  if (!(await isDaemonResponsive())) {
    return
  }
  try {
    await fetch(`${normalizeBaseUrl(getDaemonBaseUrl())}/shutdown`, { method: 'POST' })
  } catch {
    // ignore shutdown errors
  }
  if (daemonProcess) {
    try {
      process.kill(-daemonProcess.pid!, 'SIGTERM')
    } catch {
      // ignore
    }
    daemonProcess = null
  }
}

function runCommand(command: string, args: string[], label: string): void {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`Command failed (${label}): ${command} ${args.join(' ')}`)
  }
}

async function loginDaemonIfNeeded(): Promise<void> {
  const daemonUrl =
    process.env.POWERSYNC_DAEMON_URL ??
    process.env.POWERSYNC_DAEMON_ENDPOINT ??
    'http://127.0.0.1:5030'
  const status = await fetch(`${daemonUrl.replace(/\/+$/, '')}/auth/status`)
    .then(async (res) => (res.ok ? ((await res.json()) as { status?: string }) : null))
    .catch(() => null)
  if (status?.status === 'ready') {
    return
  }
  const authResult = await ensureDaemonSupabaseAuth({
    env: process.env,
    metadata: { initiatedBy: 'playwright-e2e' },
    logger: console,
  })
  if (!authResult.status || authResult.status.status !== 'ready') {
    throw new Error('Failed to authenticate daemon via Supabase for Playwright tests.')
  }
}

function applyProfileEnvironment(): void {
  const profileOverride = process.env.STACK_PROFILE ?? null
  const profileResult = loadProfileEnvironment({
    profile: profileOverride,
    startDir: repoRoot,
    updateState: false,
    strict: Boolean(profileOverride),
  })
  for (const [key, value] of Object.entries(profileResult.combinedEnv)) {
    const current = process.env[key]
    if (current === undefined || current.trim().length === 0) {
      process.env[key] = value
    }
  }
}

function shouldManageLocalStack(): boolean {
  const profileName = process.env.STACK_PROFILE ?? 'local-dev'
  if (profileName === 'local-dev') return true
  const supabaseUrl = (process.env.POWERSYNC_SUPABASE_URL ?? '').toLowerCase()
  if (supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost')) {
    return true
  }
  return false
}

test.describe('PowerSync dev stack (live)', () => {
  let startedBySuite = false

  test('ensure stack is running', async () => {
    applyProfileEnvironment()
    ensureLiveRemoteUrl()

    if (shouldManageLocalStack()) {
      if (!(await isStackRunning())) {
        runCommand(START_COMMAND[0]!, START_COMMAND.slice(1), 'start dev stack')
        await waitForStackReady(STACK_START_TIMEOUT_MS)
        startedBySuite = true
      }
      await ensureDaemonProcessRunning()
    }

    await loginDaemonIfNeeded()
  })

  test.afterAll(async () => {
    if (!startedBySuite) return
    runCommand(STOP_COMMAND[0]!, STOP_COMMAND.slice(1), 'stop dev stack')
    if (daemonStartedBySuite) {
      await stopDaemonProcess()
    }
  })
})
