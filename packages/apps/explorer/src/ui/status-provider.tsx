import * as React from 'react'

export type StatusTone = 'info' | 'success' | 'warning' | 'error'

export interface StatusEntry {
  key: string
  tone: StatusTone
  message: React.ReactNode
  order?: number
}

interface StatusContextValue {
  entries: StatusEntry[]
  publish: (entry: StatusEntry) => void
  dismiss: (key: string) => void
}

const StatusContext = React.createContext<StatusContextValue | null>(null)

export function StatusProvider({ children }: { children: React.ReactNode }) {
  const [entriesMap, setEntriesMap] = React.useState<Map<string, StatusEntry>>(new Map())

  const publish = React.useCallback((entry: StatusEntry) => {
    setEntriesMap((previous) => {
      const next = new Map(previous)
      next.set(entry.key, entry)
      return next
    })
  }, [])

  const dismiss = React.useCallback((key: string) => {
    setEntriesMap((previous) => {
      if (!previous.has(key)) return previous
      const next = new Map(previous)
      next.delete(key)
      return next
    })
  }, [])

  const entries = React.useMemo(() => {
    return Array.from(entriesMap.values()).sort((a, b) => {
      const orderDelta = (a.order ?? 0) - (b.order ?? 0)
      if (orderDelta !== 0) return orderDelta
      return a.key.localeCompare(b.key)
    })
  }, [entriesMap])

  const value = React.useMemo<StatusContextValue>(
    () => ({
      entries,
      publish,
      dismiss,
    }),
    [dismiss, entries, publish],
  )

  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>
}

export function useStatusRegistry(): {
  publishStatus: (entry: StatusEntry) => void
  dismissStatus: (key: string) => void
} {
  const context = React.useContext(StatusContext)
  if (!context) {
    throw new Error('useStatusRegistry must be used within a StatusProvider')
  }
  return React.useMemo(
    () => ({
      publishStatus: context.publish,
      dismissStatus: context.dismiss,
    }),
    [context.dismiss, context.publish],
  )
}

export function useStatuses(): StatusEntry[] {
  const context = React.useContext(StatusContext)
  if (!context) {
    throw new Error('useStatuses must be used within a StatusProvider')
  }
  return context.entries
}

export function StatusViewport({ className }: { className?: string }) {
  const entries = useStatuses()
  if (entries.length === 0) {
    return null
  }
  const containerClass = ['space-y-3', className].filter(Boolean).join(' ')
  return (
    <div className={containerClass} data-testid="status-viewport">
      {entries.map((entry) => (
        <div
          key={entry.key}
          className={`rounded-lg border px-4 py-3 text-sm ${
            entry.tone === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : entry.tone === 'warning'
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : entry.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-slate-200 bg-slate-50 text-slate-700'
          }`}
          data-testid={`status-entry-${entry.key}`}
        >
          {entry.message}
        </div>
      ))}
    </div>
  )
}
