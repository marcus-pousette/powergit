
import * as React from 'react'
import { PowerSyncDatabase, SyncClientImplementation, WASQLiteOpenFactory, WASQLiteVFS } from '@powersync/web'
import { PowerSyncContext } from '@powersync/react'
import { AppSchema } from './schema'
import { Connector } from './connector'
import { initTestFixtureBridge } from './test-fixture-bridge'
import { useSupabaseAuth } from './auth-context'
import {
  completeDaemonDeviceLogin,
  extractDeviceChallenge,
  fetchDaemonAuthStatus,
  isDaemonPreferred,
  obtainPowerSyncToken,
  type DaemonAuthStatus,
} from './daemon-client'
import { getAccessToken } from './supabase'


const isPowerSyncDisabled = import.meta.env.VITE_POWERSYNC_DISABLED === 'true'
const isMultiTabCapable = typeof SharedWorker !== 'undefined'

function readEnvString(name: string): string | null {
  const env = import.meta.env as Record<string, string | undefined>
  const value = env[name]
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export interface DaemonAuthSnapshot {
  enabled: boolean
  status: DaemonAuthStatus | null
}

const DaemonAuthContext = React.createContext<DaemonAuthSnapshot>({ enabled: false, status: null })

export function useDaemonAuthSnapshot(): DaemonAuthSnapshot {
  return React.useContext(DaemonAuthContext)
}

function resolveVfs(): WASQLiteVFS {
  const hasOpfs =
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { storage?: StorageManager }).storage?.getDirectory === 'function' &&
    typeof SharedArrayBuffer !== 'undefined'

  if (hasOpfs) {
    return WASQLiteVFS.OPFSCoopSyncVFS
  }

  if (typeof indexedDB !== 'undefined') {
    return WASQLiteVFS.IDBBatchAtomicVFS
  }

  return WASQLiteVFS.AccessHandlePoolVFS
}

export function createPowerSync() {
  const supportsWorker = typeof Worker !== 'undefined'
  const flags = { enableMultiTabs: isMultiTabCapable, useWebWorker: supportsWorker && isMultiTabCapable }
  return new PowerSyncDatabase({
    schema: AppSchema,
    database: new WASQLiteOpenFactory({
      dbFilename: 'repo-explorer.db',
      vfs: resolveVfs(),
      flags,
    }),
    flags,
  })
}

export const PowerSyncProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const powerSync = React.useMemo(() => createPowerSync(), [])
  const { status, session } = useSupabaseAuth()
  const accessToken = session?.access_token ?? null
  const preferDaemon = isDaemonPreferred()
  const [daemonStatus, setDaemonStatus] = React.useState<DaemonAuthStatus | null>(null)
  const [daemonReady, setDaemonReady] = React.useState(false)
  const closeDatabase = React.useCallback(() => {
    return powerSync.close({ disconnect: true }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (message.toLowerCase().includes('closed')) return
      console.warn('[PowerSync] failed to close database', error)
    })
  }, [powerSync])

  React.useEffect(() => {
    return () => {
      void closeDatabase()
    }
  }, [closeDatabase])

  React.useEffect(() => {
    if (!preferDaemon) {
      setDaemonStatus(null)
      setDaemonReady(false)
      return
    }
    if (isPowerSyncDisabled) return

    let disposed = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (disposed) return
      const status = await fetchDaemonAuthStatus()
      const nextReady = status?.status === 'ready'
      if (!disposed) {
        setDaemonStatus(status)
        setDaemonReady((prev) => (prev === nextReady ? prev : nextReady))
      }
      const delay = nextReady ? 10_000 : 3_000
      timeoutId = setTimeout(() => {
        void poll()
      }, delay)
    }

    void poll()

    return () => {
      disposed = true
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [preferDaemon])

  React.useEffect(() => {
    if (isPowerSyncDisabled) return
    if (status === 'error') return
    if (status !== 'authenticated') return
    if (!preferDaemon && !accessToken) return
    if (preferDaemon && !daemonReady) return

    let disposed = false
    const connector = new Connector({
      getToken: async () => {
        const token = await obtainPowerSyncToken()
        if (!token) {
          if (preferDaemon) {
            throw new Error('PowerSync token unavailable from daemon. Ensure the daemon is running and authenticated.')
          }
          throw new Error('PowerSync token unavailable. Check Supabase session or configure VITE_POWERSYNC_TOKEN.')
        }
        return token
      },
    })

    const connect = async () => {
      try {
        await powerSync.init()
        await powerSync.connect(connector, { clientImplementation: SyncClientImplementation.RUST })
      } catch (error) {
        if (!disposed) {
          console.error('[PowerSync] failed to connect', error)
        }
      }
    }

    void connect()

    return () => {
      disposed = true
      void closeDatabase()
    }
  }, [powerSync, status, accessToken, closeDatabase, preferDaemon, daemonReady])

  React.useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __powersyncDb?: PowerSyncDatabase }).__powersyncDb = powerSync
    return () => {
      delete (window as unknown as { __powersyncDb?: PowerSyncDatabase }).__powersyncDb
    }
  }, [powerSync])

  React.useEffect(() => {
    if (import.meta.env.DEV) {
      console.debug('[PowerSyncProvider] initializing test fixture bridge')
    }
    initTestFixtureBridge()
  }, [])

  const daemonSnapshot = React.useMemo<DaemonAuthSnapshot>(
    () => ({ enabled: preferDaemon, status: daemonStatus }),
    [preferDaemon, daemonStatus],
  )

  const pendingDeviceRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!preferDaemon) {
      pendingDeviceRef.current = null
      return
    }
    const challenge = extractDeviceChallenge(daemonStatus)
    if (!challenge) {
      pendingDeviceRef.current = null
      return
    }
    if (pendingDeviceRef.current === challenge.challengeId) {
      return
    }
    pendingDeviceRef.current = challenge.challengeId

    let cancelled = false
    const complete = async () => {
      const token = await getAccessToken()
      if (!token) {
        pendingDeviceRef.current = null
        return
      }
      const endpoint = readEnvString('VITE_POWERSYNC_ENDPOINT')
      const ok = await completeDaemonDeviceLogin({
        challengeId: challenge.challengeId,
        token,
        endpoint,
        expiresAt: challenge.expiresAt ?? null,
      })
      if (!ok && !cancelled) {
        pendingDeviceRef.current = null
      }
    }

    void complete()

    return () => {
      cancelled = true
    }
  }, [preferDaemon, daemonStatus, session?.access_token])

  return (
    <DaemonAuthContext.Provider value={daemonSnapshot}>
      <PowerSyncContext.Provider value={powerSync}>{children}</PowerSyncContext.Provider>
    </DaemonAuthContext.Provider>
  )
}
