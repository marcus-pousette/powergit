#!/usr/bin/env node

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const tsxImport = pathToFileURL(require.resolve('tsx/esm')).href

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

const remoteUrl =
  process.env.POWERSYNC_SEED_REMOTE_URL ??
  process.env.PSGIT_TEST_REMOTE_URL ??
  process.env.POWERSYNC_TEST_REMOTE_URL

if (!remoteUrl) {
  console.error('Missing PowerSync remote URL. Set POWERSYNC_SEED_REMOTE_URL or PSGIT_TEST_REMOTE_URL.')
  process.exit(1)
}

const remoteName = process.env.POWERSYNC_SEED_REMOTE_NAME ?? process.env.PSGIT_TEST_REMOTE_NAME ?? 'powersync'
const seedBranch = process.env.POWERSYNC_SEED_BRANCH ?? 'main'
const keepTempRepo = process.env.KEEP_POWERSYNC_SEED_REPO === '1'
const defaultDbPath = resolve(repoRoot, 'tmp', 'powersync-seed.sqlite')
const syncDbPath = process.env.POWERSYNC_SEED_DB_PATH ?? defaultDbPath

const psgitEnv = {
  POWERSYNC_SUPABASE_FUNCTIONS_URL: process.env.POWERSYNC_SUPABASE_FUNCTIONS_URL,
  POWERSYNC_SUPABASE_SERVICE_ROLE_KEY: process.env.POWERSYNC_SUPABASE_SERVICE_ROLE_KEY,
  POWERSYNC_SUPABASE_URL: process.env.POWERSYNC_SUPABASE_URL,
  POWERSYNC_ENDPOINT: process.env.POWERSYNC_ENDPOINT,
  POWERSYNC_TOKEN: process.env.POWERSYNC_TOKEN,
}

async function run(command, args, options = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    })
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
    child.on('error', rejectPromise)
  })
}

async function runGit(args, cwd) {
  await run('git', args, { cwd, env: process.env })
}

async function runPsgit(args, cwd, extraEnv = {}) {
  const binPath = resolve(repoRoot, 'packages/cli/src/bin.ts')
  await run(
    'node',
    ['--import', tsxImport, binPath, ...args],
    {
      cwd,
      env: {
        ...process.env,
        ...psgitEnv,
        ...extraEnv,
      },
    },
  )
}

async function createSeedRepo() {
  const tempRepo = await mkdtemp(join(tmpdir(), 'powersync-seed-'))
  await runGit(['init'], tempRepo)
  await runGit(['config', 'user.email', 'seed@powersync.test'], tempRepo)
  await runGit(['config', 'user.name', 'PowerSync Seed Bot'], tempRepo)

  // First commit
  await writeFile(join(tempRepo, 'README.md'), '# PowerSync Seed Repo\n\nThis data was seeded via psgit.\n')
  await runGit(['add', 'README.md'], tempRepo)
  await runGit(['commit', '-m', 'Initial commit'], tempRepo)

  // Second commit with multiple files to exercise file_changes table
  await mkdir(join(tempRepo, 'src'), { recursive: true })
  await writeFile(
    join(tempRepo, 'src', 'app.ts'),
    "export const greet = (name: string) => `Hello, ${name}!`\n",
  )
  await writeFile(
    join(tempRepo, 'src', 'routes.md'),
    '- /branches\n- /commits\n- /files\n',
  )
  await runGit(['add', 'src/app.ts', 'src/routes.md'], tempRepo)
  await runGit(['commit', '-m', 'Add sample application files'], tempRepo)

  return tempRepo
}

async function pushSeedData(repoDir) {
  await runPsgit(['remote', 'add', 'powersync', remoteUrl], repoDir, {
    REMOTE_NAME: remoteName,
  })

  const pushRef = `HEAD:refs/heads/${seedBranch}`
  console.log(`→ pushing ${pushRef} to ${remoteName}`)
  await runGit(['push', '--force', remoteName, pushRef], repoDir)
}

async function syncLocalSnapshot(repoDir) {
  await mkdir(dirname(syncDbPath), { recursive: true })
  console.log(`→ syncing snapshot to ${syncDbPath}`)
  await runPsgit(['sync', '--remote', remoteName, '--db', syncDbPath], repoDir, {
    REMOTE_NAME: remoteName,
  })
}

async function main() {
  console.log('Seeding PowerSync stack using psgit...')
  const repoDir = await createSeedRepo()
  try {
    await pushSeedData(repoDir)
    await syncLocalSnapshot(repoDir)
    console.log('✅ Seed complete.')
    console.log(`   Remote: ${remoteUrl}`)
    console.log(`   Remote name: ${remoteName}`)
    console.log(`   Seed branch: ${seedBranch}`)
    console.log(`   Local snapshot: ${syncDbPath}`)
  } finally {
    if (keepTempRepo) {
      console.log(`📁 Keeping temp repo at ${repoDir}`)
    } else {
      await rm(repoDir, { recursive: true, force: true })
    }
  }
}

main().catch((error) => {
  console.error('❌ PowerSync seed failed:', error)
  process.exit(1)
})
