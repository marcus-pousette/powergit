import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as React from 'react'
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'

const AUTH_MOCK = {
  status: 'authenticated' as const,
  session: {
    user: {
      id: 'user-test',
    },
  },
  isConfigured: true,
  error: null,
  refresh: async () => undefined,
}

async function loadVaultModule() {
  vi.doMock('./auth-context', () => ({
    useSupabaseAuth: () => AUTH_MOCK,
  }))
  return import('./vault-context')
}

describe('VaultProvider', () => {
  beforeEach(() => {
    cleanup()
    vi.resetModules()
    localStorage.clear()
    vi.stubEnv('VITE_POWERSYNC_REQUIRE_VAULT', 'true')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unmock('./auth-context')
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it('requires setup when no vault exists', async () => {
    const { VaultProvider, useVault } = await loadVaultModule()
    const wrapper: React.FC<React.PropsWithChildren> = ({ children }) => <VaultProvider>{children}</VaultProvider>
    const { result } = renderHook(() => useVault(), { wrapper })

    await waitFor(() => {
      expect(result.current.status).toBe('needsSetup')
      expect(result.current.hasVault).toBe(false)
      expect(result.current.unlocked).toBe(false)
    })
  })

  it('creates, unlocks, locks, and clears the vault', async () => {
    const { VaultProvider, useVault } = await loadVaultModule()
    const wrapper: React.FC<React.PropsWithChildren> = ({ children }) => <VaultProvider>{children}</VaultProvider>
    const { result } = renderHook(() => useVault(), { wrapper })

    await waitFor(() => {
      expect(result.current.status).toBe('needsSetup')
    })

    const passphrase = 'super-secret-passphrase'
    await act(async () => {
      await result.current.createVault(passphrase)
    })

    await waitFor(() => {
      expect(result.current.hasVault).toBe(true)
      expect(['locked', 'unlocked']).toContain(result.current.status)
    })

    const rawRecord = localStorage.getItem(`psgit.vault.${AUTH_MOCK.session.user.id}`)
    expect(rawRecord).toBeTruthy()
    const record = rawRecord ? JSON.parse(rawRecord) : null
    expect(record).toMatchObject({
      version: 1,
      createdAt: expect.any(String),
    })
    expect(record?.verifier).toBeDefined()
    expect(record?.verifier).not.toBe(passphrase)

    // Ensure the vault is locked before attempting unlock tests
    if (result.current.status !== 'locked') {
      await act(async () => {
        await result.current.lockVault()
      })

      await waitFor(() => {
        expect(result.current.status).toBe('locked')
        expect(result.current.unlocked).toBe(false)
      })
    }

    // Unlock with wrong passphrase should fail
    await expect(result.current.unlockVault('wrong-passphrase')).rejects.toThrow('Incorrect passphrase.')

    // Unlock with correct passphrase
    await act(async () => {
      await result.current.unlockVault(passphrase)
    })
    expect(result.current.status).toBe('unlocked')
    expect(result.current.unlocked).toBe(true)

    // Lock again
    await act(async () => {
      await result.current.lockVault()
    })

    expect(result.current.status).toBe('locked')
    expect(result.current.unlocked).toBe(false)

    // Unlock once more with the correct passphrase
    await act(async () => {
      await result.current.unlockVault(passphrase)
    })
    expect(result.current.status).toBe('unlocked')

    // Clear the vault
    await act(async () => {
      await result.current.clearVault()
    })

    await waitFor(() => {
      expect(result.current.status).toBe('needsSetup')
      expect(localStorage.getItem(`psgit.vault.${AUTH_MOCK.session.user.id}`)).toBeNull()
    })
  })
})
