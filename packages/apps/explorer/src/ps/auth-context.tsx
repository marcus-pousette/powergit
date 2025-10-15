import * as React from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSession, getSupabase, isSupabaseConfigured } from './supabase'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error'

export interface SupabaseAuthSnapshot {
  status: AuthStatus
  session: Session | null
  isConfigured: boolean
  error: Error | null
}

interface SupabaseAuthContextValue extends SupabaseAuthSnapshot {
  refresh: () => Promise<void>
}

const defaultSnapshot: SupabaseAuthSnapshot = {
  status: 'loading',
  session: null,
  isConfigured: false,
  error: null,
}

const SupabaseAuthContext = React.createContext<SupabaseAuthContextValue>({
  ...defaultSnapshot,
  refresh: async () => undefined,
})

export const SupabaseAuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [snapshot, setSnapshot] = React.useState<SupabaseAuthSnapshot>(() => ({
    ...defaultSnapshot,
    isConfigured: isSupabaseConfigured(),
  }))

  const refresh = React.useCallback(async () => {
    const client = getSupabase()
    if (!client) {
      setSnapshot({
        status: 'unauthenticated',
        session: null,
        isConfigured: false,
        error: null,
      })
      return
    }

    setSnapshot((prev) => ({ ...prev, status: 'loading', error: null, isConfigured: true }))

    let hadError = false
    const session = await getSession().catch((error) => {
      console.warn('[Explorer] failed to refresh Supabase session', error)
      setSnapshot({
        status: 'error',
        session: null,
        isConfigured: true,
        error: error instanceof Error ? error : new Error(String(error)),
      })
      hadError = true
      return null
    })

    if (hadError) return

    setSnapshot((prev) => ({
      ...prev,
      status: session ? 'authenticated' : 'unauthenticated',
      session,
      error: null,
      isConfigured: true,
    }))
  }, [])

  React.useEffect(() => {
    const client = getSupabase()
    if (!client) {
      setSnapshot({
        status: 'unauthenticated',
        session: null,
        isConfigured: false,
        error: null,
      })
      return
    }

    let disposed = false

    const init = async () => {
      let hadError = false
      const session = await getSession().catch((error) => {
        console.warn('[Explorer] failed to load Supabase session', error)
        if (!disposed) {
          setSnapshot({
            status: 'error',
            session: null,
            isConfigured: true,
            error: error instanceof Error ? error : new Error(String(error)),
          })
        }
        hadError = true
        return null
      })

      if (disposed || hadError) return

      setSnapshot({
        status: session ? 'authenticated' : 'unauthenticated',
        session,
        isConfigured: true,
        error: null,
      })
    }

    void init()

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (disposed) return
      setSnapshot({
        status: session ? 'authenticated' : 'unauthenticated',
        session,
        isConfigured: true,
        error: null,
      })
    })

    return () => {
      disposed = true
      subscription.unsubscribe()
    }
  }, [])

  const value = React.useMemo<SupabaseAuthContextValue>(
    () => ({
      ...snapshot,
      refresh,
    }),
    [snapshot, refresh],
  )

  return <SupabaseAuthContext.Provider value={value}>{children}</SupabaseAuthContext.Provider>
}

export function useSupabaseAuth(): SupabaseAuthContextValue {
  return React.useContext(SupabaseAuthContext)
}
