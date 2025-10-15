import * as React from 'react'
import { useSupabaseAuth } from './auth-context'

export type VaultStatus = 'loading' | 'needsSetup' | 'locked' | 'unlocked'

export interface VaultContextValue {
  status: VaultStatus
  hasVault: boolean
  unlocked: boolean
  createVault: (passphrase: string) => Promise<void>
  unlockVault: (passphrase: string) => Promise<void>
  lockVault: () => Promise<void>
  clearVault: () => Promise<void>
}

type VaultRecord = {
  version: number
  verifier: string
  createdAt: string
}

type InternalState = {
  status: VaultStatus
  record: VaultRecord | null
  hasVault: boolean
  activeVerifier: string | null
}

const STORAGE_PREFIX = 'psgit.vault.'

function resolveVaultRequirement(): boolean {
  if (typeof window !== 'undefined') {
    const override = (window as typeof window & { __powersyncRequireVault?: unknown }).__powersyncRequireVault
    if (typeof override === 'boolean') {
      return override
    }
  }
  return (import.meta.env.VITE_POWERSYNC_REQUIRE_VAULT ?? 'true') !== 'false'
}

async function hashPassphrase(passphrase: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(passphrase)
      const digest = await window.crypto.subtle.digest('SHA-256', data)
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
    } catch (error) {
      console.warn('[Vault] WebCrypto hashing failed, falling back to basic encoding', error)
    }
  }

  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    try {
      return window.btoa(unescape(encodeURIComponent(passphrase)))
    } catch (error) {
      console.warn('[Vault] btoa hashing failed, falling back to plain string', error)
    }
  }

  return passphrase
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch (error) {
    console.warn('[Vault] localStorage unavailable', error)
    return null
  }
}

const DisabledVaultContextValue: VaultContextValue = {
  status: 'unlocked',
  hasVault: false,
  unlocked: true,
  async createVault() {
    console.info('[Vault] createVault skipped (vault disabled)')
  },
  async unlockVault() {
    console.info('[Vault] unlockVault skipped (vault disabled)')
  },
  async lockVault() {
    console.info('[Vault] lockVault skipped (vault disabled)')
  },
  async clearVault() {
    console.info('[Vault] clearVault skipped (vault disabled)')
  },
}

const VaultContext = React.createContext<VaultContextValue>(DisabledVaultContextValue)

export const VaultProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { status: authStatus, session } = useSupabaseAuth()
  const userId = session?.user?.id ?? null
  const vaultRequired = React.useMemo(() => resolveVaultRequirement(), [])

  const [state, setState] = React.useState<InternalState>({
    status: vaultRequired ? 'loading' : 'unlocked',
    record: null,
    hasVault: false,
    activeVerifier: null,
  })

  const storageKey = userId ? `${STORAGE_PREFIX}${userId}` : null

  React.useEffect(() => {
    if (!vaultRequired) return
    if (authStatus !== 'authenticated' || !userId) {
      setState((prev) => ({
        ...prev,
        status: 'loading',
        record: null,
        hasVault: false,
        activeVerifier: null,
      }))
      return
    }

    const storage = getStorage()
    if (!storage) {
      setState({
        status: 'locked',
        record: null,
        hasVault: true,
        activeVerifier: null,
      })
      return
    }

    const raw = storageKey ? storage.getItem(storageKey) : null
    if (!raw) {
      setState({
        status: 'needsSetup',
        record: null,
        hasVault: false,
        activeVerifier: null,
      })
      return
    }

    try {
      const record = JSON.parse(raw) as VaultRecord
      if (!record?.verifier) {
        storage.removeItem(storageKey!)
        setState({
          status: 'needsSetup',
          record: null,
          hasVault: false,
          activeVerifier: null,
        })
        return
      }
      setState((prev) => {
        const sameVault = prev.record?.verifier === record.verifier
        const hasActiveUnlock = prev.activeVerifier && prev.activeVerifier === record.verifier
        if (hasActiveUnlock) {
          return {
            status: 'unlocked',
            record,
            hasVault: true,
            activeVerifier: prev.activeVerifier,
          }
        }
        return {
          status: 'locked',
          record,
          hasVault: true,
          activeVerifier: sameVault ? prev.activeVerifier : null,
        }
      })
    } catch (error) {
      console.warn('[Vault] Invalid vault record, clearing', error)
      storage.removeItem(storageKey!)
      setState({
        status: 'needsSetup',
        record: null,
        hasVault: false,
        activeVerifier: null,
      })
    }
  }, [authStatus, userId, storageKey])

  const createVault = React.useCallback(
    async (passphrase: string) => {
      if (!vaultRequired) return
      if (!storageKey) {
        throw new Error('Vault is unavailable until authentication completes.')
      }
      const storage = getStorage()
      if (!storage) {
        throw new Error('Local storage is not available. Enable storage access to create a vault.')
      }
      if (state.record) {
        throw new Error('Vault already exists. Unlock or clear it before creating a new one.')
      }

      const verifier = await hashPassphrase(passphrase)
      const record: VaultRecord = {
        version: 1,
        verifier,
        createdAt: new Date().toISOString(),
      }
      storage.setItem(storageKey, JSON.stringify(record))
      setState({
        status: 'unlocked',
        record,
        hasVault: true,
        activeVerifier: verifier,
      })
    },
    [vaultRequired, state.record, storageKey],
  )

  const unlockVault = React.useCallback(
    async (passphrase: string) => {
      if (!vaultRequired) return
      if (state.status === 'unlocked') return
      if (!state.record) {
        throw new Error('Vault has not been created yet.')
      }
      const verifier = await hashPassphrase(passphrase)
      if (verifier !== state.record.verifier) {
        throw new Error('Incorrect passphrase.')
      }
      setState((prev) => ({
        ...prev,
        status: 'unlocked',
        activeVerifier: verifier,
      }))
    },
    [vaultRequired, state],
  )

  const lockVault = React.useCallback(async () => {
    if (!vaultRequired) return
    setState((prev) => {
      if (!prev.record) {
        return {
          status: 'needsSetup',
          record: null,
          hasVault: false,
          activeVerifier: null,
        }
      }
      return {
        ...prev,
        status: 'locked',
        activeVerifier: null,
      }
    })
  }, [vaultRequired])

  const clearVault = React.useCallback(async () => {
    if (!vaultRequired) return
    const storage = getStorage()
    if (storage && storageKey) {
      storage.removeItem(storageKey)
    }
    setState({
      status: 'needsSetup',
      record: null,
      hasVault: false,
      activeVerifier: null,
    })
  }, [vaultRequired, storageKey])

  const value = React.useMemo<VaultContextValue>(() => {
    if (!vaultRequired) {
      return DisabledVaultContextValue
    }
    return {
      status: state.status,
      hasVault: state.hasVault,
      unlocked: state.status === 'unlocked',
      createVault,
      unlockVault,
      lockVault,
      clearVault,
    }
  }, [vaultRequired, state, createVault, unlockVault, lockVault, clearVault])

  React.useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') {
      return
    }
    const global = window as typeof window & { __vaultControls?: VaultContextValue }
    global.__vaultControls = {
      ...value,
    }
    return () => {
      delete global.__vaultControls
    }
  }, [value])

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVault(): VaultContextValue {
  return React.useContext(VaultContext)
}
