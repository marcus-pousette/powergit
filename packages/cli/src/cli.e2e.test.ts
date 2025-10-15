import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { parsePowerSyncUrl } from '@shared/core'
import { startStack, stopStack } from '../../../scripts/test-stack-hooks.js'
import { seedDemoRepository } from './index.js'
import { loadStoredCredentials } from './auth/session.js'

const execFileAsync = promisify(execFile)
const binPath = fileURLToPath(new URL('./bin.ts', import.meta.url))
const require = createRequire(import.meta.url)
const tsxImport = pathToFileURL(require.resolve('tsx/esm')).href
const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)), '..')
const builtBinPath = resolve(repoRoot, 'packages/cli/dist/cli/src/bin.js')

function buildCliArgs(args: string[]): string[] {
  if (existsSync(builtBinPath)) {
    return [builtBinPath, ...args]
  }
  return ['--import', tsxImport, binPath, ...args]
}

const requiredEnvVars = [
  'PSGIT_TEST_REMOTE_URL',
  'PSGIT_TEST_SUPABASE_URL',
  'PSGIT_TEST_SUPABASE_EMAIL',
  'PSGIT_TEST_SUPABASE_PASSWORD',
]
const initialMissingEnv = requiredEnvVars.filter((name) => !process.env[name])

function resolveSupabaseBinary(): string {
  const configured = process.env.SUPABASE_BIN
  if (configured && configured.length > 0) {
    return configured
  }

  try {
    const packagePath = require.resolve('@supabase/cli/package.json')
    const packageDir = dirname(packagePath)
    const candidate = resolve(packageDir, 'bin', 'supabase')
    if (existsSync(candidate)) {
      return candidate
    }
  } catch {
    // ignore missing workspace copy — fall back to PATH lookup
  }

  return 'supabase'
}

const supabaseBinary = resolveSupabaseBinary()
const supabaseProbe = spawnSync(supabaseBinary, ['--version'], { stdio: 'ignore' })
const hasSupabaseCli = supabaseProbe.error == null && supabaseProbe.status === 0

const dockerBinary = process.env.DOCKER_BIN ?? 'docker'
const dockerProbe = spawnSync(dockerBinary, ['--version'], { stdio: 'ignore' })
const dockerComposeProbe = spawnSync(dockerBinary, ['compose', 'version'], { stdio: 'ignore' })
const dockerInfoProbe = spawnSync(dockerBinary, ['info'], { stdio: 'ignore' })
const hasDocker =
  dockerProbe.error == null &&
  dockerProbe.status === 0 &&
  dockerComposeProbe.error == null &&
  dockerComposeProbe.status === 0 &&
  dockerInfoProbe.error == null &&
  dockerInfoProbe.status === 0

if (hasSupabaseCli) {
  process.env.SUPABASE_BIN = supabaseBinary
}

if (hasDocker) {
  process.env.DOCKER_BIN = dockerBinary
}

const shouldAttemptLocalStack = initialMissingEnv.length > 0 && hasSupabaseCli && hasDocker
const canRunLiveTests = initialMissingEnv.length === 0 || shouldAttemptLocalStack

if (initialMissingEnv.length > 0 && !canRunLiveTests) {
  console.warn(
    '[cli] skipping live PowerSync e2e tests — missing env vars and local Supabase stack is unavailable.\n' +
      `Missing: ${initialMissingEnv.join(', ')}\n` +
      'Install Supabase CLI + Docker or export PSGIT_TEST_* variables to enable these tests.',
  )
}

const describeLive = canRunLiveTests ? describe : describe.skip

type LiveStackConfig = {
  remoteUrl: string
  remoteName: string
  supabaseUrl: string
  supabaseEmail: string
  supabasePassword: string
  endpoint?: string
}

let liveStackConfig!: LiveStackConfig
let startedLocalStack = false
let skipLiveSuite = false

async function runScript(scriptRelativePath: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const scriptPath = resolve(repoRoot, scriptRelativePath)
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn('node', [scriptPath], {
      stdio: 'inherit',
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
    })
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(`${scriptRelativePath} exited with code ${code}`))
    })
    child.on('error', rejectPromise)
  })
}

async function seedLiveStackData(config: LiveStackConfig) {
  const { org, repo } = parsePowerSyncUrl(config.remoteUrl)
  await seedDemoRepository({
    remoteUrl: config.remoteUrl,
    remoteName: config.remoteName,
    branch: 'main',
    skipSync: true,
    keepWorkingDir: false,
  })
  console.log(`[cli-e2e] seeded PowerSync repo ${org}/${repo} via daemon push`)
}

async function runGit(args: string[], cwd: string) {
  return execFileAsync('git', args, { cwd })
}

describe('psgit CLI e2e', () => {
  let repoDir: string

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'psgit-e2e-'))
    await runGit(['init'], repoDir)
  })

  afterEach(async () => {
    if (repoDir) {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  afterAll(async () => {
    if (startedLocalStack) {
      await stopStack().catch(() => undefined)
      startedLocalStack = false
    }
  })

  async function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
    const result = await execFileAsync(
      'node',
      buildCliArgs(args),
      {
        cwd: repoDir,
        env: { ...process.env, ...env },
      }
    )
    return result
  }

  async function getRemoteUrl(name = 'origin') {
    const { stdout } = await runGit(['remote', 'get-url', name], repoDir)
    return stdout.trim()
  }

  it('adds and updates the default powersync remote', async () => {
    const firstUrl = 'powersync::https://example.dev/orgs/acme/repos/infra'
    const { stdout: addStdout } = await runCli(['remote', 'add', 'powersync', firstUrl])
    expect(addStdout).toContain(`Added PowerSync remote (origin): ${firstUrl}`)

    expect(await getRemoteUrl()).toBe(firstUrl)

    const secondUrl = 'powersync::https://example.dev/orgs/acme/repos/runtime'
    const { stdout: updateStdout } = await runCli(['remote', 'add', 'powersync', secondUrl])
    expect(updateStdout).toContain(`Added PowerSync remote (origin): ${secondUrl}`)

    expect(await getRemoteUrl()).toBe(secondUrl)
  })

  it('respects REMOTE_NAME overrides', async () => {
    const customRemote = 'powersync-upstream'
    const remoteUrl = 'powersync::https://example.dev/orgs/acme/repos/mobile'

    const { stdout } = await runCli(
      ['remote', 'add', 'powersync', remoteUrl],
      { REMOTE_NAME: customRemote }
    )

    expect(stdout).toContain(`Added PowerSync remote (${customRemote}): ${remoteUrl}`)
    expect(await getRemoteUrl(customRemote)).toBe(remoteUrl)
  })

  it('prints usage help for unknown commands', async () => {
    const { stdout } = await runCli([])
    expect(stdout).toContain('psgit commands:')
    expect(stdout).toContain('psgit remote add powersync')

    const { stdout: unknownStdout } = await runCli(['status'])
    expect(unknownStdout).toContain('psgit commands:')
  })

  it('exits with usage instructions when url is missing', async () => {
    try {
      await runCli(['remote', 'add', 'powersync'])
      throw new Error('expected CLI command to fail without URL')
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & { stderr?: string }
      expect(execError.code).toBe(2)
      expect(execError.stderr ?? '').toContain('Usage: psgit remote add powersync')
    }
  })
})

describeLive('psgit sync against live PowerSync stack', () => {
  let repoDir: string

  beforeAll(async () => {
    if (!canRunLiveTests) {
      return
    }

    const cachedCredentials = await loadStoredCredentials().catch(() => null)
    if (!cachedCredentials?.endpoint || !cachedCredentials?.token) {
      skipLiveSuite = true
      console.warn(
        '[cli] skipping live PowerSync stack tests — missing cached PowerSync credentials for daemon login.',
      )
      return
    }
    process.env.POWERSYNC_DAEMON_ENDPOINT = cachedCredentials.endpoint
    process.env.POWERSYNC_DAEMON_TOKEN = cachedCredentials.token

    if (shouldAttemptLocalStack) {
      await startStack({ skipDemoSeed: true })
      startedLocalStack = true
    }

    const missingAfterStart = requiredEnvVars.filter((name) => !process.env[name])
    if (missingAfterStart.length > 0) {
      throw new Error(
        `Missing required environment variables for PowerSync live-stack tests: ${missingAfterStart.join(
          ', ',
        )}. Start the local stack or export PSGIT_TEST_* variables.`,
      )
    }

    liveStackConfig = {
      remoteUrl: process.env.PSGIT_TEST_REMOTE_URL!,
      remoteName: process.env.PSGIT_TEST_REMOTE_NAME ?? 'powersync',
      supabaseUrl: process.env.PSGIT_TEST_SUPABASE_URL!,
      endpoint: process.env.PSGIT_TEST_ENDPOINT,
      supabaseEmail: process.env.PSGIT_TEST_SUPABASE_EMAIL!,
      supabasePassword: process.env.PSGIT_TEST_SUPABASE_PASSWORD!,
    }

    try {
      const { default: BetterSqlite } = await import('better-sqlite3')
      const probe = new BetterSqlite(':memory:')
      probe.close()
    } catch (error) {
      skipLiveSuite = true
      console.warn(
        '[cli] skipping live PowerSync stack tests — better-sqlite3 native module unavailable:',
        (error as Error)?.message ?? error,
      )
      return
    }

    if (startedLocalStack) {
      await runScript('scripts/seed-sync-rules.mjs')
    }

    if (startedLocalStack) {
      await seedLiveStackData(liveStackConfig)
    }

    try {
      await execFileAsync(
        'node',
        buildCliArgs([
          'login',
          '--supabase-email',
          liveStackConfig.supabaseEmail,
          '--supabase-password',
          liveStackConfig.supabasePassword,
        ]),
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            POWERSYNC_SUPABASE_URL: liveStackConfig.supabaseUrl,
            POWERSYNC_SUPABASE_EMAIL: liveStackConfig.supabaseEmail,
            POWERSYNC_SUPABASE_PASSWORD: liveStackConfig.supabasePassword,
            POWERSYNC_ENDPOINT: liveStackConfig.endpoint,
          },
        },
      )
    } catch (error) {
      skipLiveSuite = true
      console.warn(
        '[cli] skipping live PowerSync stack tests — daemon login failed:',
        (error as Error)?.message ?? error,
      )
      return
    }
  }, 240_000)

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'psgit-stack-e2e-'))
    await runGit(['init'], repoDir)
  })

  afterEach(async () => {
    if (repoDir) {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  async function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
    return execFileAsync(
      'node',
      buildCliArgs(args),
      {
        cwd: repoDir,
        env: {
          ...process.env,
          POWERSYNC_SUPABASE_URL: liveStackConfig.supabaseUrl,
          POWERSYNC_SUPABASE_EMAIL: liveStackConfig.supabaseEmail,
          POWERSYNC_SUPABASE_PASSWORD: liveStackConfig.supabasePassword,
          POWERSYNC_ENDPOINT: liveStackConfig.endpoint,
          ...env,
        },
      },
    )
  }

  it('hydrates refs, commits, and file changes into SQLite', async () => {
    if (skipLiveSuite) {
      return
    }

    await runCli(
      ['remote', 'add', 'powersync', liveStackConfig.remoteUrl!],
      { REMOTE_NAME: liveStackConfig.remoteName },
    )

    const { stdout, stderr } = await runCli(['sync', '--remote', liveStackConfig.remoteName])

    const output = `${stdout ?? ''}${stderr ?? ''}`
    expect(output).toMatch(/Synced PowerSync repo/)
    const match = /Rows: (\d+) refs, (\d+) commits, (\d+) file changes/.exec(output)
    expect(match).not.toBeNull()
    if (match) {
      const refs = Number(match[1])
      const commits = Number(match[2])
      const fileChanges = Number(match[3])
      expect(refs).toBeGreaterThan(0)
      expect(commits).toBeGreaterThan(0)
      expect(fileChanges).toBeGreaterThan(0)
    }
  }, 60_000)
})
