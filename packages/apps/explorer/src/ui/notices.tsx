import * as React from 'react'

type NoticeVariant = 'info' | 'success' | 'warning' | 'error'

export interface NoticeOptions {
  key?: string
  title?: string
  message: React.ReactNode
  variant?: NoticeVariant
  dismissible?: boolean
  autoDismissMs?: number | null
}

interface Notice extends NoticeOptions {
  id: string
  variant: NoticeVariant
  dismissible: boolean
}

interface NoticeContextValue {
  notices: Notice[]
  showNotice: (options: NoticeOptions) => string
  dismissNotice: (id: string) => void
  dismissNoticeByKey: (key: string) => void
}

const NoticeContext = React.createContext<NoticeContextValue | null>(null)

const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

export function NoticeProvider({ children }: { children: React.ReactNode }) {
  const [notices, setNotices] = React.useState<Notice[]>([])

  const dismissNotice = React.useCallback((id: string) => {
    setNotices((previous) => previous.filter((notice) => notice.id !== id))
  }, [])

  const dismissNoticeByKey = React.useCallback((key: string) => {
    setNotices((previous) => previous.filter((notice) => notice.key !== key))
  }, [])

  const showNotice = React.useCallback(
    (options: NoticeOptions) => {
      const id = options.key
        ? options.key
        : options.dismissible === false && options.autoDismissMs == null
        ? options.title ?? createId()
        : createId()

      setNotices((previous) => {
        const variant: NoticeVariant = options.variant ?? 'info'
        const dismissible = options.dismissible !== false
        const existingIndex = options.key
          ? previous.findIndex((notice) => notice.key === options.key)
          : previous.findIndex((notice) => notice.id === id)

        const nextNotice: Notice = {
          id,
          key: options.key,
          title: options.title,
          message: options.message,
          variant,
          dismissible,
          autoDismissMs: options.autoDismissMs ?? null,
        }

        if (existingIndex >= 0) {
          const clone = previous.slice()
          clone[existingIndex] = nextNotice
          return clone
        }
        return [...previous, nextNotice]
      })

      if (options.autoDismissMs && options.autoDismissMs > 0) {
        setTimeout(() => {
          dismissNotice(options.key ?? id)
        }, options.autoDismissMs)
      }

      return id
    },
    [dismissNotice],
  )

  const value = React.useMemo<NoticeContextValue>(
    () => ({
      notices,
      showNotice,
      dismissNotice,
      dismissNoticeByKey,
    }),
    [dismissNotice, dismissNoticeByKey, notices, showNotice],
  )

  return (
    <NoticeContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-3 px-4 sm:items-end sm:px-6">
        {notices.map((notice) => (
          <div
            key={notice.id}
            className={`pointer-events-auto w-full max-w-sm rounded-md border px-4 py-3 shadow transition ${
              notice.variant === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : notice.variant === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : notice.variant === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-slate-200 bg-white text-slate-800'
            }`}
            role="status"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                {notice.title ? <div className="font-semibold text-sm">{notice.title}</div> : null}
                <div className="text-sm leading-relaxed">{notice.message}</div>
              </div>
              {notice.dismissible ? (
                <button
                  type="button"
                  className="rounded p-1 text-xs text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                  onClick={() => {
                    if (notice.key) {
                      dismissNoticeByKey(notice.key)
                    } else {
                      dismissNotice(notice.id)
                    }
                  }}
                  aria-label="Dismiss notification"
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  )
}

export function useAppNotices() {
  const context = React.useContext(NoticeContext)
  if (!context) {
    throw new Error('useAppNotices must be used within a NoticeProvider')
  }
  return context
}
