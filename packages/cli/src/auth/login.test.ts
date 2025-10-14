import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { loginWithExplicitToken, loginWithSupabasePassword, logout } from './login.js'

const tempRoots: string[] = []

describe('cli auth login', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function createSessionPath() {
    const dir = await mkdtemp(join(tmpdir(), 'psgit-auth-test-'))
    tempRoots.push(dir)
    return join(dir, 'session.json')
  }

  it('stores manual credentials', async () => {
    const sessionPath = await createSessionPath()
    const fakeToken = [
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })).toString('base64url'),
      'signature',
    ].join('.')

    const result = await loginWithExplicitToken({
      endpoint: 'https://api.example.dev',
      token: fakeToken,
      sessionPath,
    })

    expect(result.credentials.endpoint).toBe('https://api.example.dev')
    const stored = JSON.parse(await readFile(sessionPath, 'utf8'))
    expect(stored.token).toBe(fakeToken)
    expect(typeof stored.expiresAt).toBe('string')
  })

  it('retrieves credentials via Supabase password login', async () => {
    const sessionPath = await createSessionPath()
    const fakeToken = [
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 1800 })).toString('base64url'),
      'signature',
    ].join('.')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({ access_token: fakeToken }),
    } as unknown as Response)

    const result = await loginWithSupabasePassword({
      endpoint: 'https://powersync.dev',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      supabaseEmail: 'user@example.com',
      supabasePassword: 'password123',
      sessionPath,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/auth/v1/token?grant_type=password',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'anon-key',
        }),
      }),
    )
    expect(result.credentials.endpoint).toBe('https://powersync.dev')
    const stored = JSON.parse(await readFile(sessionPath, 'utf8'))
    expect(stored.endpoint).toBe('https://powersync.dev')

    fetchMock.mockRestore()
  })

  it('clears stored session on logout', async () => {
    const sessionPath = await createSessionPath()
    await loginWithExplicitToken({
      endpoint: 'https://api.example.dev',
      token: 'abc.def.ghi',
      sessionPath,
    })

    await logout({ sessionPath })
    await expect(readFile(sessionPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
