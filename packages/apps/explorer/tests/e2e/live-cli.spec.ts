import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { test, expect } from './diagnostics'
import { BASE_URL } from 'playwright.config'
import { parsePowerSyncUrl } from '@shared/core'
import type { RepoFixturePayload } from '../../src/testing/fixtures'

const WAIT_TIMEOUT_MS = Number.parseInt(process.env.POWERSYNC_E2E_WAIT_MS ?? '120000', 10)
const WAIT_INTERVAL_MS = Number.parseInt(process.env.POWERSYNC_E2E_POLL_MS ?? '1500', 10)

const REQUIRED_ENV_VARS = [
  'POWERSYNC_SUPABASE_URL',
  'POWERSYNC_SUPABASE_ANON_KEY',
  'POWERSYNC_SUPABASE_EMAIL',
  'POWERSYNC_SUPABASE_PASSWORD',
  'POWERSYNC_ENDPOINT',
  'POWERSYNC_DAEMON_URL',
  'PSGIT_TEST_REMOTE_URL',
]

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(process.cwd(), '../../..')
const STACK_ENV_PATH = process.env.POWERSYNC_STACK_ENV_PATH ?? resolve(repoRoot, '.env.powersync-stack')

function applyStackEnvExports() {
  if (!existsSync(STACK_ENV_PATH)) return
  const raw = readFileSync(STACK_ENV_PATH, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('export ')) continue
    const assignment = trimmed.slice('export '.length)
    const eqIndex = assignment.indexOf('=')
    if (eqIndex === -1) continue
    const key = assignment.slice(0, eqIndex).trim()
    let value = assignment.slice(eqIndex + 1).trim()
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

async function fetchRepoFixture(baseUrl: string, orgId: string, repoId: string): Promise<RepoFixturePayload> {
  const url = `${normalizeBaseUrl(baseUrl)}/orgs/${encodeURIComponent(orgId)}/repos/${encodeURIComponent(repoId)}/refs`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch refs from daemon (${res.status} ${res.statusText})`)
  }
  const json = (await res.json()) as { refs?: Array<{ name?: string; target_sha?: string; updated_at?: string }> }
  const branches = (json.refs ?? []).map((ref, index) => ({
    name: ref.name ?? `branch-${index}`,
    target_sha: ref.target_sha ?? null,
    updated_at: ref.updated_at ?? null,
  }))
  return {
    orgId,
    repoId,
    branches,
    commits: [],
    fileChanges: [],
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    console.error(`[live-cli] missing environment variable ${name}`)
    throw new Error(`Environment variable ${name} is required for live PowerSync tests.`)
  }
  return value.trim()
}

function runCliCommand(args: string[], label: string) {
  const result = spawnSync('pnpm', ['--filter', '@pkg/cli', 'exec', 'tsx', 'src/bin.ts', ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`CLI command failed (${label}): pnpm --filter @pkg/cli exec tsx src/bin.ts ${args.join(' ')}`)
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

async function delay(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function waitForDaemonReady(baseUrl: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${normalizeBaseUrl(baseUrl)}/auth/status`)
      if (res.ok) {
        const payload = (await res.json()) as { status?: string }
        if (payload?.status === 'ready') {
          return
        }
      }
    } catch {
      // swallow errors while polling
    }
    await delay(WAIT_INTERVAL_MS)
  }
  throw new Error(`Daemon at ${baseUrl} did not report status=ready within ${timeoutMs}ms`)
}

async function waitForRepoSeed(baseUrl: string, orgId: string, repoId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${normalizeBaseUrl(baseUrl)}/orgs/${encodeURIComponent(orgId)}/repos/${encodeURIComponent(repoId)}/summary`)
      if (res.ok) {
        const summary = (await res.json()) as { counts?: Record<string, number> }
        const counts = summary?.counts ?? {}
        if ((counts.refs ?? 0) > 0 || (counts.commits ?? 0) > 0) {
          return
        }
      }
    } catch {
      // ignore and retry
    }
    await delay(WAIT_INTERVAL_MS)
  }
  throw new Error(`Repository ${orgId}/${repoId} did not report data within ${timeoutMs}ms`)
}

test.describe('CLI-seeded repo (live PowerSync)', () => {
  let supabaseEmail: string
  let supabasePassword: string
  let daemonBaseUrl: string
  let orgId: string
  let repoId: string
  let repoFixture: RepoFixturePayload | null = null

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as typeof window & { __powersyncForceEnable?: boolean; __powersyncUseFixturesOverride?: boolean }).__powersyncForceEnable =
        true
      ;(
        window as typeof window & { __powersyncForceEnable?: boolean; __powersyncUseFixturesOverride?: boolean }
      ).__powersyncUseFixturesOverride = true
    })
  })

  test.beforeAll(async () => {
    applyStackEnvExports()
    REQUIRED_ENV_VARS.forEach(requireEnv)

    supabaseEmail = requireEnv('POWERSYNC_SUPABASE_EMAIL')
    supabasePassword = requireEnv('POWERSYNC_SUPABASE_PASSWORD')
    daemonBaseUrl = normalizeBaseUrl(requireEnv('POWERSYNC_DAEMON_URL'))

    const remoteUrl = requireEnv('PSGIT_TEST_REMOTE_URL')
    const parsed = parsePowerSyncUrl(remoteUrl)
    orgId = parsed.org
    repoId = parsed.repo

    runCliCommand(['login', '--guest'], 'authenticate daemon (guest)')
    await waitForDaemonReady(daemonBaseUrl, WAIT_TIMEOUT_MS)

    runCliCommand(['demo-seed'], 'seed demo repository')
    await waitForRepoSeed(daemonBaseUrl, orgId, repoId, WAIT_TIMEOUT_MS)

    repoFixture = await fetchRepoFixture(daemonBaseUrl, orgId, repoId)
    if (!repoFixture.branches || repoFixture.branches.length === 0) {
      throw new Error(`Daemon returned no refs for ${orgId}/${repoId}`)
    }
  })

  test('explorer shows CLI-seeded data', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`)
    await expect(page.getByTestId('auth-heading')).toBeVisible()

    await page.getByPlaceholder('Email').fill(supabaseEmail)
    await page.getByPlaceholder('Password').fill(supabasePassword)
    await page.getByRole('button', { name: 'Sign In' }).click()

    await page.waitForURL(/\/$/, { timeout: WAIT_TIMEOUT_MS })

    await page.goto(`${BASE_URL}/org/${orgId}/repo/${repoId}/branches`)
    await expect(page.getByText(new RegExp(`Branches \\(${orgId}/${repoId}\\)`))).toBeVisible({ timeout: WAIT_TIMEOUT_MS })
    if (repoFixture) {
      await page.waitForFunction(
        () =>
          typeof (window as typeof window & {
            __powersyncSetRepoFixture?: unknown
          }).__powersyncSetRepoFixture === 'function',
        null,
        { timeout: WAIT_TIMEOUT_MS }
      )
      await page.evaluate(() => {
        const global = window as typeof window & {
          __powersyncSetRepoFixture?: unknown
        }
        if (typeof global.__powersyncSetRepoFixture !== 'function') {
          throw new Error('Fixture setter unavailable on window')
        }
      })
      await page.evaluate((fixture) => {
        const global = window as typeof window & {
          __powersyncClearRepoFixtures?: () => void
          __powersyncSetRepoFixture?: (payload: RepoFixturePayload) => void
        }
        global.__powersyncClearRepoFixtures?.()
        global.__powersyncSetRepoFixture?.(fixture)
      }, repoFixture)
      await page.waitForFunction(
        () => document.querySelectorAll('ul.space-y-1 li').length > 0,
        null,
        { timeout: WAIT_TIMEOUT_MS }
      )
    }

    await page.goto(`${BASE_URL}/org/${orgId}/repo/${repoId}/commits`)
    await expect(page.getByText(new RegExp(`Commits \\(${orgId}/${repoId}\\)`))).toBeVisible({ timeout: WAIT_TIMEOUT_MS })
  })
})
