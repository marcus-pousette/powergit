import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Buffer } from 'node:buffer'

vi.mock('@shared/core', async () => {
  const actual = await vi.importActual<typeof import('@shared/core')>('@shared/core')
  return {
    ...actual,
    invokeSupabaseEdgeFunction: vi.fn(),
  }
})

import { __internals } from './index.js'
import { invokeSupabaseEdgeFunction } from '@shared/core'

describe('remote helper Supabase integration', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetAllMocks()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('fetches token via Supabase edge function when configured', async () => {
    process.env.POWERSYNC_SUPABASE_URL = 'https://supabase.local'
    process.env.POWERSYNC_SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    ;(invokeSupabaseEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'from-supabase' })

    const token = await __internals.requestSupabaseToken({ endpoint: 'https://ps.example', org: 'acme', repo: 'infra' })
    expect(token).toBe('from-supabase')
    expect(invokeSupabaseEdgeFunction).toHaveBeenCalledWith(
      'powersync-remote-token',
      { remoteUrl: 'https://ps.example/orgs/acme/repos/infra' },
      { url: 'https://supabase.local', serviceRoleKey: 'service-key' },
    )
  })

  it('parses push directives correctly', () => {
    const parsePush = __internals.parsePush
    expect(parsePush(['push', 'abc', 'def'])).toEqual({ src: 'abc', dst: 'def', force: false })
    expect(parsePush(['push', 'abc:def'])).toEqual({ src: 'abc', dst: 'def', force: false })
    expect(parsePush(['push', '+abc', 'def'])).toEqual({ src: 'abc', dst: 'def', force: true })
    expect(parsePush(['push', 'abc', '+def'])).toEqual({ src: 'abc', dst: 'def', force: true })
    expect(parsePush(['push', '+abc:+def'])).toEqual({ src: 'abc', dst: 'def', force: true })
    expect(parsePush(['push'])).toBeNull()
  })

  it('invokes Supabase push function', async () => {
    process.env.POWERSYNC_SUPABASE_URL = 'http://supabase.local'
    process.env.POWERSYNC_SUPABASE_SERVICE_ROLE_KEY = 'service-role'
    process.env.POWERSYNC_SUPABASE_PUSH_FN = 'powersync-push'

    ;(invokeSupabaseEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, results: { 'refs/heads/main': { status: 'ok' } } })

    const { uploadPushPack } = __internals
    const buffer = Buffer.from('packdata')
    const result = await uploadPushPack({ org: 'acme', repo: 'infra' }, [{ src: 'abc', dst: 'refs/heads/main' }], buffer)

    expect(result.ok).toBe(true)
    expect(invokeSupabaseEdgeFunction).toHaveBeenCalledWith('powersync-push', {
      org: 'acme',
      repo: 'infra',
      updates: [{ src: 'abc', dst: 'refs/heads/main' }],
      pack: buffer.toString('base64'),
      packEncoding: 'base64',
    }, { url: 'http://supabase.local', serviceRoleKey: 'service-role' })
  })
})
