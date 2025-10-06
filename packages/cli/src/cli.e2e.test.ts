import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'

const execFileAsync = promisify(execFile)
const binPath = fileURLToPath(new URL('./bin.ts', import.meta.url))
const require = createRequire(import.meta.url)
const tsxImport = pathToFileURL(require.resolve('tsx/esm')).href
const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)), '..')

const requiredEnvVars = ['PSGIT_TEST_REMOTE_URL', 'PSGIT_TEST_FUNCTIONS_URL', 'PSGIT_TEST_SERVICE_ROLE_KEY']
const missingEnv = requiredEnvVars.filter((name) => !process.env[name])
if (missingEnv.length > 0) {
  throw new Error(
    `Missing required environment variables for PowerSync live-stack tests: ${missingEnv.join(
      ', ',
    )}. See DEV_SETUP.md for instructions.`,
  )
}

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

  async function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
    const result = await execFileAsync(
      'node',
      ['--import', tsxImport, binPath, ...args],
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

const liveStackConfig = {
  remoteUrl: process.env.PSGIT_TEST_REMOTE_URL!,
  remoteName: process.env.PSGIT_TEST_REMOTE_NAME ?? 'powersync',
  functionsUrl: process.env.PSGIT_TEST_FUNCTIONS_URL!,
  serviceRoleKey: process.env.PSGIT_TEST_SERVICE_ROLE_KEY!,
  supabaseUrl: process.env.PSGIT_TEST_SUPABASE_URL,
  directToken: process.env.PSGIT_TEST_REMOTE_TOKEN,
  endpoint: process.env.PSGIT_TEST_ENDPOINT,
}

describe('psgit sync against live PowerSync stack', () => {
  let repoDir: string
  let dbPath: string

  beforeAll(async () => {
    await runScript('scripts/seed-sync-rules.mjs')
    await runScript('scripts/seed-local-stack.mjs', {
      POWERSYNC_SEED_REMOTE_URL: liveStackConfig.remoteUrl,
      POWERSYNC_SEED_REMOTE_NAME: liveStackConfig.remoteName,
    })
  })

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'psgit-stack-e2e-'))
    await runGit(['init'], repoDir)
    dbPath = join(repoDir, 'powersync-e2e.sqlite')
  })

  afterEach(async () => {
    if (repoDir) {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  async function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
    return execFileAsync(
      'node',
      ['--import', tsxImport, binPath, ...args],
      {
        cwd: repoDir,
        env: {
          ...process.env,
          POWERSYNC_SUPABASE_FUNCTIONS_URL: liveStackConfig.functionsUrl,
          POWERSYNC_SUPABASE_SERVICE_ROLE_KEY: liveStackConfig.serviceRoleKey,
          POWERSYNC_SUPABASE_URL: liveStackConfig.supabaseUrl,
          POWERSYNC_ENDPOINT: liveStackConfig.endpoint,
          POWERSYNC_TOKEN: liveStackConfig.directToken,
          ...env,
        },
      },
    )
  }

  it('hydrates refs, commits, and file changes into SQLite', async () => {
    await runCli(
      ['remote', 'add', 'powersync', liveStackConfig.remoteUrl!],
      { REMOTE_NAME: liveStackConfig.remoteName },
    )

    const { stdout } = await runCli(
      ['sync', '--remote', liveStackConfig.remoteName, '--db', dbPath],
    )

    expect(stdout).toMatch(/Synced PowerSync repo/)
    expect(stdout).toMatch(/Rows: \d+ refs, \d+ commits, \d+ file changes/)

    const db = new Database(dbPath, { readonly: true })
    try {
      const refs = db.prepare('SELECT COUNT(*) AS count FROM refs').get() as { count: number }
      const commits = db.prepare('SELECT COUNT(*) AS count FROM commits').get() as { count: number }
      const fileChanges = db.prepare('SELECT COUNT(*) AS count FROM file_changes').get() as { count: number }

  expect(refs.count).toBeGreaterThan(0)
  expect(commits.count).toBeGreaterThan(0)
  expect(fileChanges.count).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  }, 60_000)
})
