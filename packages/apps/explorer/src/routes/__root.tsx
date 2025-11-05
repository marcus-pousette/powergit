
import * as React from 'react'
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { useStatus } from '@powersync/react'
import { signOut } from '@ps/supabase'
import { isDaemonPreferred, notifyDaemonLogout } from '@ps/daemon-client'
import { useSupabaseAuth } from '@ps/auth-context'
import { StatusViewport } from '../ui/status-provider'

export const Route = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { status: authStatus, session } = useSupabaseAuth()
  const status = useStatus()
  const [signingOut, setSigningOut] = React.useState(false)
  const preferDaemon = React.useMemo(() => isDaemonPreferred(), [])
  const isAuthRoute = React.useMemo(() => {
    const path = location.pathname ?? ''
    return path.startsWith('/auth') || path.startsWith('/reset-password')
  }, [location.pathname])
  const pathname = location.pathname ?? ''

  React.useEffect(() => {
    if (authStatus === 'unauthenticated' && !isAuthRoute && pathname !== '/auth') {
      void navigate({ to: '/auth', replace: true })
    }
  }, [authStatus, isAuthRoute, pathname, navigate])

  if (isAuthRoute) {
    return <Outlet />
  }

  if (authStatus === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-500">
        <span className="text-sm font-medium">Loading session…</span>
      </div>
    )
  }

  if (authStatus === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-red-50 px-4 text-center text-red-700">
        <div className="max-w-md space-y-3 rounded-2xl border border-red-200 bg-white px-6 py-8 shadow">
          <h2 className="text-lg font-semibold">Authentication failed</h2>
          <p className="text-sm">Reload the page or try signing in again.</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigate({ to: '/auth' })
            }}
          >
            Go to sign in
          </button>
        </div>
      </div>
    )
  }

  if (authStatus !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-500">
        <span className="text-sm font-medium">Redirecting to sign in…</span>
      </div>
    )
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      if (preferDaemon) {
        const ok = await notifyDaemonLogout().catch((error) => {
          console.warn('[Explorer] failed to notify daemon logout', error)
          return false
        })
        if (!ok) {
          console.warn('[Explorer] daemon logout notification was not acknowledged')
        }
      }
      await signOut()
      void navigate({ to: '/auth' })
    } catch (error) {
      console.error('[Explorer] failed to sign out', error)
    } finally {
      setSigningOut(false)
    }
  }

  const userLabel = session?.user?.email ?? session?.user?.id ?? 'Signed in'
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Repo Explorer</h1>
          <div className="text-sm text-gray-500">
            {status.connected ? 'Connected' : 'Offline'}
            {!status.hasSynced ? ' · syncing…' : ''}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <nav className="space-x-4">
            <Link to="/" className="[&.active]:font-semibold">
              Home
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{userLabel}</span>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => {
                void handleSignOut()
              }}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>
      <StatusViewport />
      <Outlet />
    </div>
  )
}
