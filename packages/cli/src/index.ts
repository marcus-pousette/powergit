
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import simpleGit from 'simple-git'
import { PowerSyncRemoteClient, RAW_TABLE_SPECS, type RepoDataSummary, parsePowerSyncUrl } from '@shared/core'
import { loadStoredCredentials, isCredentialExpired } from './auth/session.js'

const STREAM_SUFFIXES = ['refs', 'commits', 'file_changes', 'objects'] as const
type StreamSuffix = typeof STREAM_SUFFIXES[number]
const DEFAULT_SEED_BRANCH = 'main'
const DEFAULT_SEED_AUTHOR = { name: 'PowerSync Seed Bot', email: 'seed@powersync.test' }

const DEFAULT_DAEMON_URL =
  process.env.POWERSYNC_DAEMON_URL ??
  process.env.POWERSYNC_DAEMON_ENDPOINT ??
  'http://127.0.0.1:5030'
const DAEMON_START_COMMAND = process.env.POWERSYNC_DAEMON_START_COMMAND ?? 'pnpm --filter @svc/daemon start'
const DAEMON_AUTOSTART_DISABLED = (process.env.POWERSYNC_DAEMON_AUTOSTART ?? 'true').toLowerCase() === 'false'
const DAEMON_START_TIMEOUT_MS = Number.parseInt(process.env.POWERSYNC_DAEMON_START_TIMEOUT_MS ?? '7000', 10)
const DAEMON_CHECK_TIMEOUT_MS = Number.parseInt(process.env.POWERSYNC_DAEMON_CHECK_TIMEOUT_MS ?? '2000', 10)
const DAEMON_START_HINT =
  'PowerSync daemon unreachable — start it with "pnpm --filter @svc/daemon start" or point POWERSYNC_DAEMON_URL at a running instance.'

export interface SeedDemoOptions {
  remoteUrl?: string
  remoteName?: string
  branch?: string
  skipSync?: boolean
  keepWorkingDir?: boolean
  workingDir?: string
}

export interface SeedDemoResult {
  remoteUrl: string
  branch: string
  workingDirectory: string
  syncedDatabase?: string
}

export async function seedDemoRepository(options: SeedDemoOptions = {}): Promise<SeedDemoResult> {
  const remoteUrl =
    options.remoteUrl ??
    process.env.POWERSYNC_SEED_REMOTE_URL ??
    process.env.PSGIT_TEST_REMOTE_URL ??
    process.env.POWERSYNC_TEST_REMOTE_URL

  if (!remoteUrl) {
    throw new Error('Missing PowerSync remote URL. Set POWERSYNC_SEED_REMOTE_URL or PSGIT_TEST_REMOTE_URL.')
  }

  const remoteName =
    options.remoteName ??
    process.env.POWERSYNC_SEED_REMOTE_NAME ??
    process.env.PSGIT_TEST_REMOTE_NAME ??
    'powersync'

  const branch = options.branch ?? process.env.POWERSYNC_SEED_BRANCH ?? DEFAULT_SEED_BRANCH

  const repoDir = options.workingDir ?? (await mkdtemp(join(tmpdir(), 'psgit-seed-')))
  const createdTempRepo = !options.workingDir

  await mkdir(repoDir, { recursive: true })

  const git = simpleGit({ baseDir: repoDir })
  await git.init()
  await git.addConfig('user.email', DEFAULT_SEED_AUTHOR.email)
  await git.addConfig('user.name', DEFAULT_SEED_AUTHOR.name)

  await writeFile(join(repoDir, 'README.md'), '# PowerSync Seed Repo\n\nThis data was seeded via psgit.\n')
  await git.add(['README.md'])
  await git.commit('Initial commit')

  await mkdir(join(repoDir, 'src'), { recursive: true })
  await writeFile(
    join(repoDir, 'src', 'app.ts'),
    "export const greet = (name: string) => `Hello, ${name}!`\n",
  )
  await writeFile(
    join(repoDir, 'src', 'routes.md'),
    '- /branches\n- /commits\n- /files\n',
  )
  await git.add(['src/app.ts', 'src/routes.md'])
  await git.commit('Add sample application files')

  const remotes = await git.getRemotes(true)
  const existingRemote = remotes.find((entry) => entry.name === remoteName)
  if (existingRemote) {
    await git.remote(['set-url', remoteName, remoteUrl])
  } else {
    await git.addRemote(remoteName, remoteUrl)
  }

  const pushRef = `HEAD:refs/heads/${branch}`
  await git.raw(['push', '--force', remoteName, pushRef])

  let syncedDatabase: string | undefined
  if (!options.skipSync) {
    const result = await syncPowerSyncRepository(repoDir, {
      remoteName,
    }).catch((error: unknown) => {
      console.warn('[psgit] seed sync failed', error)
      return null
    })
    if (result?.databasePath) {
      syncedDatabase = result.databasePath ?? undefined
    }
  }

  if (createdTempRepo && !options.keepWorkingDir) {
    await rm(repoDir, { recursive: true, force: true })
  }

  return {
    remoteUrl,
    branch,
    workingDirectory: repoDir,
    syncedDatabase,
  }
}

export async function addPowerSyncRemote(dir: string, name: string, url: string) {
  const git = simpleGit({ baseDir: dir })
  const remotes = await git.getRemotes(true)
  const exists = remotes.find(r => r.name === name)
  if (!exists) await git.addRemote(name, url)
  else await git.remote(['set-url', name, url])
  return true
}

export interface SyncCommandOptions {
  remoteName?: string
  sessionPath?: string
  daemonUrl?: string
}

export interface SyncCommandResult {
  org: string
  repo: string
  endpoint: string
  counts: Record<StreamSuffix, number>
  databasePath?: string | null
}

export async function syncPowerSyncRepository(dir: string, options: SyncCommandOptions = {}): Promise<SyncCommandResult> {
  const remoteName = options.remoteName ?? process.env.REMOTE_NAME ?? 'origin'
  const git = simpleGit({ baseDir: dir })
  const remotes = await git.getRemotes(true)
  const remote = remotes.find(r => r.name === remoteName)
  if (!remote) {
    throw new Error(`Missing Git remote "${remoteName}". Use "psgit remote add powersync" first or specify --remote.`)
  }

  const candidateUrl = remote.refs.fetch || remote.refs.push
  if (!candidateUrl) {
    throw new Error(`Git remote "${remoteName}" does not have a fetch URL configured.`)
  }

  const { endpoint, org, repo } = parsePowerSyncUrl(candidateUrl)

  const storedCredentials = await loadStoredCredentials(options.sessionPath).catch(() => null)
  if (!storedCredentials?.endpoint || !storedCredentials?.token) {
    throw new Error('[psgit] missing cached PowerSync credentials. Run `psgit login` before syncing.')
  }
  if (isCredentialExpired(storedCredentials)) {
    throw new Error('Cached PowerSync credentials have expired. Run `psgit login` to refresh.')
  }

  if (!process.env.POWERSYNC_DAEMON_ENDPOINT) {
    process.env.POWERSYNC_DAEMON_ENDPOINT = storedCredentials.endpoint
  }
  if (!process.env.POWERSYNC_DAEMON_TOKEN) {
    process.env.POWERSYNC_DAEMON_TOKEN = storedCredentials.token
  }

  const daemonBaseUrl = normalizeBaseUrl(options.daemonUrl ?? process.env.POWERSYNC_DAEMON_URL ?? DEFAULT_DAEMON_URL)
  await ensureDaemonReady(daemonBaseUrl)

  const client = new PowerSyncRemoteClient({
    endpoint: daemonBaseUrl,
    pathRouting: 'segments',
    fetchImpl: globalThis.fetch as typeof fetch,
  })

  const summary: RepoDataSummary = await client.getRepoSummary(org, repo)
  const counts = Object.fromEntries(
    STREAM_SUFFIXES.map((name) => [name, summary.counts[name] ?? 0]),
  ) as Record<StreamSuffix, number>

  return {
    org,
    repo,
    endpoint,
    counts,
    databasePath: null,
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

async function ensureDaemonReady(baseUrl: string): Promise<void> {
  if (await isDaemonResponsive(baseUrl)) {
    return
  }

  if (DAEMON_AUTOSTART_DISABLED) {
    throw new Error(DAEMON_START_HINT)
  }

  try {
    launchDaemon()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${DAEMON_START_HINT} (${message})`)
  }

  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isDaemonResponsive(baseUrl)) {
      return
    }
    await delay(200)
  }

  throw new Error(`${DAEMON_START_HINT} (daemon start timed out)`)
}

async function isDaemonResponsive(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DAEMON_CHECK_TIMEOUT_MS)
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

function launchDaemon(): void {
  const child = spawn(DAEMON_START_COMMAND, {
    shell: true,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  child.unref()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
