import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const execFileAsync = promisify(execFile)

type RefRecord = { name: string; target_sha: string }

type StoredState = {
  pack: Buffer | null
  refs: Map<string, string>
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function createStubServer(org: string, repo: string, state: StoredState) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'POST' && url.pathname === '/functions/v1/powersync-push') {
      console.error('[stub] received push request')
      const body = await readJsonBody(req) as {
        updates?: Array<{ src: string; dst: string }>
        pack?: string
      }
      const updates = body.updates ?? []
      if (body.pack) {
        state.pack = Buffer.from(body.pack, 'base64')
      }
      for (const update of updates) {
        if (!update?.dst || !update?.src) continue
        state.refs.set(update.dst, update.src)
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        ok: true,
        results: Object.fromEntries(updates.map((u) => [u.dst, { status: 'ok' }])),
      }))
      return
    }

    if (req.method === 'GET' && url.pathname === `/orgs/${org}/repos/${repo}/refs`) {
      console.error('[stub] list refs')
      const refs: RefRecord[] = Array.from(state.refs.entries()).map(([name, target_sha]) => ({
        name,
        target_sha,
      }))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        refs: refs.map((ref) => ({
          org_id: org,
          repo_id: repo,
          name: ref.name,
          target_sha: ref.target_sha,
          updated_at: new Date().toISOString(),
        })),
        head: refs.length ? { target: refs[0]?.target_sha } : undefined,
      }))
      return
    }

    if (req.method === 'POST' && url.pathname === `/orgs/${org}/repos/${repo}/git/fetch`) {
      console.error('[stub] fetch pack request')
      const pack = state.pack
      if (!pack) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'no-pack-available' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ pack: pack.toString('base64'), packEncoding: 'base64' }))
      return
    }

    res.statusCode = 404
    res.end()
  })
}

async function runGit(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return execFileAsync('git', args, { cwd, env })
}

const requireForTests = createRequire(import.meta.url)
const tsxEsmPath = requireForTests.resolve('tsx/esm')

async function createHelperExecutable(dir: string): Promise<string> {
  const helperPath = join(dir, 'git-remote-powersync')
  const entry = fileURLToPath(new URL('./bin.ts', import.meta.url))
    const script = [
      '#!/usr/bin/env node',
      "const { pathToFileURL } = require('node:url');",
      '(async () => {',
      `  await import(${JSON.stringify(tsxEsmPath)});`,
      `  await import(pathToFileURL(${JSON.stringify(entry)}).href);`,
      '})().catch((error) => {',
      "  console.error(error)",
      "  process.exit(1)",
      '});',
      '',
    ].join('\n')
  await writeFile(helperPath, script, { mode: 0o755 })
  return helperPath
}
describe('git push/fetch via PowerSync remote helper', () => {
  const org = 'acme'
  const repo = 'hello-world'
  let helperDir: string
  let repoDir: string
  let cloneDir: string
  let serverClose: (() => Promise<void>) | null = null
  let powersyncEndpoint: string
  let powersyncRemoteUrl: string
  const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url))
  let env: NodeJS.ProcessEnv
  let stored: StoredState

  beforeAll(async () => {
    stored = { pack: null, refs: new Map() }
    const server = createStubServer(org, repo, stored)
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address()
    if (!address || typeof address !== 'object') {
      throw new Error('Failed to bind stub server')
    }
    const port = address.port
  serverClose = () => new Promise((resolveFn) => server.close(() => resolveFn()))
  powersyncEndpoint = `http://127.0.0.1:${port}`
  powersyncRemoteUrl = `powersync::${powersyncEndpoint}/orgs/${org}/repos/${repo}`

    helperDir = await mkdtemp(join(tmpdir(), 'powersync-helper-'))
    await createHelperExecutable(helperDir)

    const debugLogPath = join(helperDir, 'helper-debug.log')
    env = {
      ...process.env,
      PATH: `${helperDir}:${process.env.PATH ?? ''}`,
  POWERSYNC_SUPABASE_URL: powersyncEndpoint,
  POWERSYNC_SUPABASE_FUNCTIONS_URL: `${powersyncEndpoint}/functions/v1`,
  POWERSYNC_SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  POWERSYNC_REMOTE_TOKEN: 'test-token',
  NODE_PATH: [join(workspaceRoot, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(':'),
  POWERSYNC_HELPER_DEBUG_LOG: debugLogPath,
      GIT_TRACE: '1',
      GIT_TRACE_PACKET: '1',
    }

    repoDir = await mkdtemp(join(tmpdir(), 'powersync-repo-'))
    await runGit(['init'], repoDir, env)
    await runGit(['config', 'user.email', 'ci@example.com'], repoDir, env)
    await runGit(['config', 'user.name', 'CI Bot'], repoDir, env)

    const readmePath = join(repoDir, 'README.md')
    await writeFile(readmePath, '# Hello PowerSync\n')
    await runGit(['add', 'README.md'], repoDir, env)
    await runGit(['commit', '-m', 'Initial import'], repoDir, env)

  await runGit(['remote', 'add', 'powersync', powersyncRemoteUrl], repoDir, env)
  })

  afterAll(async () => {
    if (serverClose) await serverClose()
    // if (helperDir) await rm(helperDir, { recursive: true, force: true })
    if (repoDir) await rm(repoDir, { recursive: true, force: true })
    if (cloneDir) await rm(cloneDir, { recursive: true, force: true })
  })

  it('pushes commits and fetches them into a fresh repo', async () => {
    const commitSha = (await runGit(['rev-parse', 'HEAD'], repoDir, env)).stdout.trim()

    console.error('[test] before push')
    await runGit(['push', 'powersync', 'HEAD:refs/heads/main'], repoDir, env)
    console.error('[test] after push')
    expect(stored.pack).not.toBeNull()
    expect(stored.refs.get('refs/heads/main')).toBe(commitSha)

    cloneDir = await mkdtemp(join(tmpdir(), 'powersync-clone-'))
    await runGit(['init'], cloneDir, env)
    await runGit(['config', 'user.email', 'ci@example.com'], cloneDir, env)
    await runGit(['config', 'user.name', 'CI Bot'], cloneDir, env)
    await runGit(['remote', 'add', 'powersync', powersyncRemoteUrl], cloneDir, env)

  console.error('[test] before fetch')
    await runGit(['fetch', 'powersync', 'refs/heads/main:refs/remotes/powersync/main'], cloneDir, env)
  console.error('[test] after fetch')
    const fetchedSha = (await runGit(['rev-parse', 'refs/remotes/powersync/main'], cloneDir, env)).stdout.trim()
    expect(fetchedSha).toBe(commitSha)

    await runGit(['checkout', '-b', 'main', fetchedSha], cloneDir, env)
    const readme = await readFile(join(cloneDir, 'README.md'), 'utf8')
    expect(readme).toContain('Hello PowerSync')
  }, 20_000)
})
