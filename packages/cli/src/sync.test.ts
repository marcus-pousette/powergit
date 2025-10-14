import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('simple-git', () => ({
  default: vi.fn(),
}))

vi.mock('./auth/session.js', () => ({
  loadStoredCredentials: vi.fn(),
  isCredentialExpired: vi.fn(),
}))

vi.mock('@shared/core', async () => {
  const actual = await vi.importActual<typeof import('@shared/core')>('@shared/core')
  const mockClient = vi.fn()
  return {
    ...actual,
    PowerSyncRemoteClient: mockClient,
  }
})

import simpleGit from 'simple-git'
import { PowerSyncRemoteClient } from '@shared/core'
import { loadStoredCredentials, isCredentialExpired } from './auth/session.js'
import { syncPowerSyncRepository } from './index.js'

const simpleGitMock = simpleGit as unknown as Mock
const loadStoredCredentialsMock = loadStoredCredentials as unknown as Mock
const isCredentialExpiredMock = isCredentialExpired as unknown as Mock
const PowerSyncRemoteClientMock = PowerSyncRemoteClient as unknown as Mock

const mockGetRepoSummary = vi.fn()

describe('syncPowerSyncRepository', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    simpleGitMock.mockReset()
    PowerSyncRemoteClientMock.mockReset()
    mockGetRepoSummary.mockReset()
    loadStoredCredentialsMock.mockReset()
    isCredentialExpiredMock.mockReset()

    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    PowerSyncRemoteClientMock.mockImplementation(() => ({
      getRepoSummary: mockGetRepoSummary,
    }))

    global.fetch = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch
  })

  afterEach(() => {
    warnSpy.mockRestore()
    delete (global as any).fetch
  })

  it('fetches summary via daemon and returns counts', async () => {
    const gitApi = {
      getRemotes: vi.fn(async () => [
        {
          name: 'origin',
          refs: {
            fetch: 'powersync::https://api.example.com/orgs/acme/repos/infra',
            push: 'powersync::https://api.example.com/orgs/acme/repos/infra',
          },
        },
      ]),
    }
    simpleGitMock.mockReturnValue(gitApi)

    loadStoredCredentialsMock.mockResolvedValue({
      endpoint: 'https://daemon.example.com',
      token: 'token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    isCredentialExpiredMock.mockReturnValue(false)
    mockGetRepoSummary.mockResolvedValue({
      orgId: 'acme',
      repoId: 'infra',
      counts: { refs: 2, commits: 5, file_changes: 9, objects: 4 },
    })

    const result = await syncPowerSyncRepository('/tmp/repo')

    expect(loadStoredCredentialsMock).toHaveBeenCalled()
    expect(isCredentialExpiredMock).toHaveBeenCalled()
    expect(PowerSyncRemoteClientMock).toHaveBeenCalledWith({
      endpoint: 'http://127.0.0.1:5030',
      fetchImpl: expect.any(Function),
      pathRouting: 'segments',
    })
    expect(mockGetRepoSummary).toHaveBeenCalledWith('acme', 'infra')
    expect(result).toEqual({
      org: 'acme',
      repo: 'infra',
      endpoint: 'https://api.example.com',
      counts: { refs: 2, commits: 5, file_changes: 9, objects: 4 },
      databasePath: null,
    })
  })

  it('uses custom remote name and daemon URL', async () => {
    const gitApi = {
      getRemotes: vi.fn(async () => [
        {
          name: 'powersync-upstream',
          refs: { fetch: 'powersync::https://svc.example.dev/orgs/team/repos/runtime' },
        },
      ]),
    }
    simpleGitMock.mockReturnValue(gitApi)

    loadStoredCredentialsMock.mockResolvedValue({
      endpoint: 'https://daemon.example.com',
      token: 'token',
    })
    isCredentialExpiredMock.mockReturnValue(false)
    mockGetRepoSummary.mockResolvedValue({
      orgId: 'team',
      repoId: 'runtime',
      counts: { refs: 1, commits: 0, file_changes: 0, objects: 0 },
    })

    const result = await syncPowerSyncRepository('/tmp/repo', {
      remoteName: 'powersync-upstream',
      daemonUrl: 'http://localhost:9999',
    })

    expect(result.org).toBe('team')
    expect(result.repo).toBe('runtime')
    expect(PowerSyncRemoteClientMock).toHaveBeenCalledWith({
      endpoint: 'http://localhost:9999',
      fetchImpl: expect.any(Function),
      pathRouting: 'segments',
    })
  })

  it('throws when the requested remote is missing', async () => {
    const gitApi = { getRemotes: vi.fn(async () => []) }
    simpleGitMock.mockReturnValue(gitApi)

    await expect(syncPowerSyncRepository('/tmp/repo')).rejects.toThrow(/Missing Git remote "origin"/)
  })
})
