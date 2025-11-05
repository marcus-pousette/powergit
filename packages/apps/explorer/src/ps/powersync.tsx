
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
import { RAW_TABLE_SPECS } from '@shared/core/powersync/raw-tables'
import { useAppNotices } from '../ui/notices'
import { useStatusRegistry } from '../ui/status-provider'

declare global {
  interface Window {
    __powersyncForceEnable?: boolean
    __powersyncForceDisable?: boolean
  }
}

function resolvePowerSyncDisabled(): boolean {
  const envDisabled = import.meta.env.VITE_POWERSYNC_DISABLED === 'true'
  const globalValue =
    typeof globalThis === 'object' && globalThis
      ? (globalThis as typeof globalThis & { __powersyncForceEnable?: unknown; __powersyncForceDisable?: unknown })
      : null
  if (globalValue) {
    if (globalValue.__powersyncForceEnable === true) {
      return false
    }
    if (globalValue.__powersyncForceDisable === true) {
      return true
    }
  }
  return envDisabled
}

const isPowerSyncDisabled = resolvePowerSyncDisabled()
const isMultiTabCapable = false

const PLACEHOLDER_VALUES = new Set([
  'dev-token-placeholder',
  'anon-placeholder',
  'service-role-placeholder',
  'powersync-remote-placeholder',
])

function isPlaceholder(value: string | undefined | null): boolean {
  if (!value) return true
  const trimmed = value.trim()
  if (!trimmed) return true
  if (PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return true
  if (/^https?:\/\/localhost(?::\d+)?\/?$/i.test(trimmed) && trimmed.includes('8090')) return true
  return false
}

function readEnvString(name: string): string | null {
  const env = import.meta.env as Record<string, string | undefined>
  const value = env[name]
  if (isPlaceholder(value)) return null
  return value!.trim()
}

let pendingPowerSyncClose: Promise<unknown> | null = null

async function waitForPendingPowerSyncClose(): Promise<void> {
  if (!pendingPowerSyncClose) return
  try {
    await pendingPowerSyncClose
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug('[PowerSync] pending close rejected', error)
    }
  }
}

type RawMigrationResultRow = Record<string, unknown>

function firstRowFromResult(result: unknown): RawMigrationResultRow | null {
  const rows = (result as { rows?: unknown })?.rows
  if (!rows) return null
  if (typeof (rows as { item?: unknown }).item === 'function') {
    return ((rows as { item: (index: number) => RawMigrationResultRow }).item(0)) ?? null
  }
  if (Array.isArray(rows)) {
    return (rows as Array<RawMigrationResultRow>)[0] ?? null
  }
  return null
}

function parseCountRow(row: RawMigrationResultRow | null): number {
  if (!row) return 0
  const candidates = ['count', 'COUNT']
  for (const key of candidates) {
    const value = row[key]
    if (value !== undefined) {
      const num = Number(value)
      return Number.isFinite(num) ? num : 0
    }
  }
  const [fallback] = Object.values(row)
  const num = Number(fallback)
  return Number.isFinite(num) ? num : 0
}

async function performRawTableMigration(database: PowerSyncDatabase): Promise<void> {
  if (import.meta.env.DEV) {
    console.debug('[PowerSync] ensuring raw tables (browser)')
  }
  await database.writeTransaction(async (tx) => {
    const untypedCheck = await tx.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ps_untyped' LIMIT 1",
    )
    const hasUntyped = firstRowFromResult(untypedCheck) !== null
    const entries = Object.entries(RAW_TABLE_SPECS) as Array<
      [keyof typeof RAW_TABLE_SPECS, (typeof RAW_TABLE_SPECS)[keyof typeof RAW_TABLE_SPECS]]
    >

    for (const [type, spec] of entries) {
      const columnNames = spec.put.params
        .map((param) => {
          if (param && typeof param === 'object' && 'Column' in param) {
            return param.Column
          }
          return null
        })
        .filter((column): column is string => typeof column === 'string' && column.length > 0)

      if (columnNames.length === 0) continue

      const existingEntity = await tx.execute(
        'SELECT type FROM sqlite_master WHERE name = ? LIMIT 1',
        [spec.tableName],
      )
      const existingType = firstRowFromResult(existingEntity)?.type
      if (existingType === 'view') {
        let dropped = false
        try {
          await tx.execute('SELECT powersync_drop_view(?)', [spec.tableName])
          dropped = true
        } catch {
          // fall back to raw DROP VIEW if helper not available
        }
        if (!dropped) {
          await tx.execute(`DROP VIEW IF EXISTS ${spec.tableName}`)
        }
        if (import.meta.env.DEV) {
          console.debug('[PowerSync] raw table migration dropped stale view', { table: spec.tableName })
        }
      }

      let prepared = true
      for (const statement of spec.createStatements) {
        try {
          await tx.execute(statement)
        } catch (createError) {
          prepared = false
          console.warn('[PowerSync] raw table migration could not ensure table', {
            table: spec.tableName,
            error: createError,
          })
          break
        }
      }
      if (!prepared) continue

      if (import.meta.env.DEV) {
        console.debug('[PowerSync] ensured raw table structure', {
          table: spec.tableName,
        })
      }

      if (!hasUntyped) {
        continue
      }

      const countResult = await tx.execute('SELECT COUNT(*) AS count FROM ps_untyped WHERE type = ?', [type])
      const count = parseCountRow(firstRowFromResult(countResult))
      if (!Number.isFinite(count) || count <= 0) continue

      const selectExpressions = columnNames.map((column) => `json_extract(data, '$.${column}')`).join(', ')
      const insertSql = `
        INSERT INTO ${spec.tableName} (id, ${columnNames.join(', ')})
        SELECT id, ${selectExpressions}
        FROM ps_untyped
        WHERE type = ?
        ON CONFLICT(id) DO NOTHING
      `

      try {
        await tx.execute(insertSql, [type])
        await tx.execute('DELETE FROM ps_untyped WHERE type = ?', [type])
        if (import.meta.env.DEV) {
          console.debug('[PowerSync] migrated raw table rows', { table: spec.tableName, count })
        }
      } catch (tableError) {
        console.warn('[PowerSync] raw table migration failed for table', {
          table: spec.tableName,
          type,
          error: tableError,
        })
      }
    }
  })
}

function isSchemaMismatchError(error: unknown): boolean {
  if (!error) return false
  const message = error instanceof Error ? error.message : String(error)
  if (!message) return false
  const normalized = message.toLowerCase()
  return normalized.includes('powersync_drop_view') || normalized.includes('powersync_replace_schema')
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
  const flags = {
    enableMultiTabs: false,
    useWebWorker: supportsWorker && isMultiTabCapable,
    externallyUnload: true,
  }
  const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: new WASQLiteOpenFactory({
      dbFilename: 'repo-explorer.db',
      vfs: resolveVfs(),
      flags,
    }),
    flags,
  })
  if (import.meta.env.DEV) {
    const originalClose = db.close.bind(db)
    db.close = async (...args) => {
      console.debug('[PowerSync] PowerSyncDatabase.close invoked', new Error().stack)
      return originalClose(...args)
    }
  }
  return db
}

export const PowerSyncProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const powerSync = React.useMemo(() => createPowerSync(), [])
  const { status, session } = useSupabaseAuth()
  const accessToken = session?.access_token ?? null
  const preferDaemon = isDaemonPreferred()
  const { showNotice, dismissNoticeByKey } = useAppNotices()
  const { publishStatus, dismissStatus } = useStatusRegistry()
  const [daemonStatus, setDaemonStatus] = React.useState<DaemonAuthStatus | null>(null)
  const [daemonReady, setDaemonReady] = React.useState(false)
  const [rawTablesReady, setRawTablesReady] = React.useState(false)
  const closeDatabase = React.useCallback(() => {
    if (import.meta.env.DEV) {
      console.debug('[PowerSync] closeDatabase invoked')
    }
    const closePromise = powerSync.close({ disconnect: true }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (message.toLowerCase().includes('closed')) return
      console.warn('[PowerSync] failed to close database', error)
    })
    pendingPowerSyncClose = closePromise.finally(() => {
      if (pendingPowerSyncClose === closePromise) {
        pendingPowerSyncClose = null
      }
    })
    return closePromise
  }, [powerSync])

  const pendingCloseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const CLOSE_DEBOUNCE_MS = 3000

  React.useEffect(() => {
    if (pendingCloseTimerRef.current) {
      clearTimeout(pendingCloseTimerRef.current)
      pendingCloseTimerRef.current = null
    }
    return () => {
      if (pendingCloseTimerRef.current) {
        clearTimeout(pendingCloseTimerRef.current)
      }
      pendingCloseTimerRef.current = setTimeout(() => {
        pendingCloseTimerRef.current = null
        void closeDatabase()
      }, CLOSE_DEBOUNCE_MS)
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

  const rawTableMigratedRef = React.useRef(false)

  const runRawTableMigration = React.useCallback(async () => {
    await waitForPendingPowerSyncClose()
    try {
      await powerSync.init()
    } catch (error) {
      console.warn('[PowerSync] init failed before raw table migration', error)
      throw error
    }
    await performRawTableMigration(powerSync)
  }, [powerSync])

  React.useEffect(() => {
    if (!preferDaemon) {
      dismissNoticeByKey('daemon-status')
      dismissStatus('daemon-auth')
      return
    }

    const status = daemonStatus
    if (!status) {
      const message = (
        <div className="space-y-1">
          <p>The explorer could not reach the local PowerSync daemon. Start it to enable Git sync features.</p>
          <p className="text-xs text-slate-600">
            Try running <code>pnpm --filter @app/explorer dev</code> or <code>pnpm --filter @svc/daemon start</code>.
          </p>
        </div>
      )
      showNotice({
        key: 'daemon-status',
        variant: 'error',
        title: 'PowerSync daemon unavailable',
        message,
        dismissible: true,
      })
      publishStatus({
        key: 'daemon-auth',
        tone: 'error',
        message,
        order: 10,
      })
      return
    }

    if (status.status === 'ready') {
      dismissNoticeByKey('daemon-status')
      dismissStatus('daemon-auth')
      return
    }

    if (status.status === 'pending') {
      const challenge = extractDeviceChallenge(status)
      const message = (
        <div className="space-y-1">
          <div>{status.reason ?? 'Waiting for daemon authentication to complete…'}</div>
          {challenge ? (
            <div className="text-xs text-slate-600">
              Device code: <code>{challenge.challengeId}</code>
              {challenge.verificationUrl ? (
                <>
                  {' '}
                  ·{' '}
                  <a href={challenge.verificationUrl} target="_blank" rel="noreferrer" className="underline">
                    Open verification URL
                  </a>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      )
      showNotice({
        key: 'daemon-status',
        variant: 'warning',
        title: 'PowerSync daemon waiting for login',
        message,
        dismissible: true,
      })
      publishStatus({
        key: 'daemon-auth',
        tone: 'warning',
        message,
        order: 10,
      })
      return
    }

    if (status.status === 'auth_required') {
      const message = (
        <div className="space-y-1">
          <div>{status.reason ?? 'Run `psgit login --guest` or complete the daemon sign-in flow to proceed.'}</div>
        </div>
      )
      showNotice({
        key: 'daemon-status',
        variant: 'warning',
        title: 'PowerSync daemon requires authentication',
        message,
        dismissible: true,
      })
      publishStatus({
        key: 'daemon-auth',
        tone: 'error',
        message,
        order: 10,
      })
      return
    }

    if (status.status === 'error') {
      const message = status.reason ?? 'The daemon reported an error while fetching credentials.'
      showNotice({
        key: 'daemon-status',
        variant: 'error',
        title: 'PowerSync daemon error',
        message,
        dismissible: true,
      })
      publishStatus({
        key: 'daemon-auth',
        tone: 'error',
        message,
        order: 10,
      })
      return
    }

    dismissStatus('daemon-auth')
  }, [
    daemonStatus,
    dismissNoticeByKey,
    dismissStatus,
    preferDaemon,
    publishStatus,
    showNotice,
  ])

  React.useEffect(() => {
    if (isPowerSyncDisabled) {
      setRawTablesReady(true)
      return
    }
    if (import.meta.env.DEV) {
      console.debug('[PowerSync] raw table migration effect invoked', {
        alreadyMigrated: rawTableMigratedRef.current,
      })
    }
    if (rawTableMigratedRef.current) {
      setRawTablesReady(true)
      return
    }
    rawTableMigratedRef.current = true

    let cancelled = false
    const migrate = async () => {
      try {
        setRawTablesReady(false)
        await runRawTableMigration()
      } catch (error) {
        if (!cancelled) {
          console.error('[PowerSync] raw table migration failed', error)
        }
      } finally {
        if (!cancelled) {
          setRawTablesReady(true)
        }
      }
    }

    void migrate()

    return () => {
      cancelled = true
    }
  }, [runRawTableMigration])

  React.useEffect(() => {
    if (isPowerSyncDisabled) return
    if (status === 'error') return
    if (status !== 'authenticated') return
    if (!preferDaemon && !accessToken) return
    if (preferDaemon && !daemonReady) return
    if (!rawTablesReady) return

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

    const connect = async (attempt = 0): Promise<void> => {
      try {
        if (import.meta.env.DEV) {
          console.debug('[PowerSyncProvider] connecting', { preferDaemon, daemonReady, hasAccessToken: !!accessToken })
        }
        await waitForPendingPowerSyncClose()
        await powerSync.init()
        await powerSync.connect(connector, { clientImplementation: SyncClientImplementation.RUST })
        if (import.meta.env.DEV) {
          const options = powerSync.connectionOptions
          console.debug('[PowerSyncProvider] connect resolved', {
            status: powerSync.currentStatus.toJSON(),
            connectionOptions: options ?? null,
          })
        }
      } catch (error) {
        if (!disposed) {
          if (attempt === 0 && isSchemaMismatchError(error)) {
            console.warn('[PowerSync] schema mismatch detected; clearing local cache and retrying')
            try {
              await powerSync.writeTransaction(async (tx) => {
                for (const spec of Object.values(RAW_TABLE_SPECS)) {
                  try {
                    await tx.execute(`DROP TABLE IF EXISTS ${spec.tableName}`)
                  } catch (dropTableError) {
                    console.warn('[PowerSync] failed to drop local table during schema recovery', {
                      table: spec.tableName,
                      error: dropTableError,
                    })
                  }
                }
              })
            } catch (dropError) {
              console.warn('[PowerSync] raw table cleanup prior to schema recovery failed', dropError)
            }
            const disconnectAndClear = (powerSync as unknown as {
              disconnectAndClear?: (options: { clearLocal?: boolean }) => Promise<void>
            }).disconnectAndClear
            if (typeof disconnectAndClear === 'function') {
              try {
                await disconnectAndClear.call(powerSync, { clearLocal: true })
              } catch (clearError) {
                console.error('[PowerSync] failed to clear local database after schema mismatch', clearError)
              }
            } else {
              try {
                await powerSync.close({ disconnect: true })
              } catch (closeError) {
                console.error('[PowerSync] failed to close database after schema mismatch', closeError)
              }
            }
            try {
              await runRawTableMigration()
            } catch (migrationError) {
              console.error('[PowerSync] raw table migration failed during schema recovery', migrationError)
            }
            if (!disposed) {
              await connect(attempt + 1)
            }
            return
          }
          console.error('[PowerSync] failed to connect', error)
        }
      }
    }

    void connect()

    return () => {
      disposed = true
    }
  }, [powerSync, status, accessToken, closeDatabase, preferDaemon, daemonReady, rawTablesReady, runRawTableMigration])

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

  React.useEffect(() => {
    if (!import.meta.env.DEV) return
    const dispose = powerSync.registerListener({
      statusChanged: (status) => {
        try {
          console.debug('[PowerSync][status]', status.toJSON())
        } catch {
          console.debug('[PowerSync][status]', status)
        }
      },
    })
    return () => {
      dispose?.()
    }
  }, [powerSync])

  React.useEffect(() => {
    if (!import.meta.env.DEV) return
    const logger = powerSync.logger as unknown as {
      [key: string]: ((...args: unknown[]) => void) | undefined
    }
    if (!logger) return
    const methods: Array<keyof typeof logger> = ['trace', 'debug', 'info', 'warn', 'error']
    const restore: Array<() => void> = []
    for (const method of methods) {
      const original = typeof logger[method] === 'function' ? (logger[method] as (...args: unknown[]) => void) : null
      if (!original) continue
      logger[method] = (...args: unknown[]) => {
        console.debug(`[PowerSync][sdk][${String(method)}]`, ...args)
        if (method === 'error') {
          args.forEach((arg, index) => {
            console.debug('[PowerSync][sdk][error-arg]', index, arg)
            const errors = (arg as { errors?: unknown }).errors
            if (Array.isArray(errors) && errors.length > 0) {
              console.debug('[PowerSync][sdk][aggregate]', index, errors)
            }
            const cause = (arg as { cause?: unknown }).cause
            if (cause) {
              console.debug('[PowerSync][sdk][cause]', index, cause)
            }
          })
        }
        original.apply(logger, args as [])
      }
      restore.push(() => {
        logger[method] = original
      })
    }
    return () => {
      restore.forEach((fn) => fn())
    }
  }, [powerSync])

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
      {rawTablesReady && powerSync ? (
        <PowerSyncContext.Provider value={powerSync}>{children}</PowerSyncContext.Provider>
      ) : null}
    </DaemonAuthContext.Provider>
  )
}
