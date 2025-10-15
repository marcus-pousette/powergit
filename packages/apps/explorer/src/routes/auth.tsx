import * as React from 'react'
import { createFileRoute, useLocation } from '@tanstack/react-router'
import { AuthScreen } from '../screens/auth/AuthScreen'
import {
  isAnonymousSignInSupported,
  isSupabaseConfigured,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithPassword,
  signUpWithPassword,
  signOut,
} from '@ps/supabase'
import { useSupabaseAuth } from '@ps/auth-context'

export const Route = createFileRoute('/auth' as any)({
  component: AuthRoute,
})

export function AuthRoute() {
  const { status, isConfigured, error } = useSupabaseAuth()
  const navigate = Route.useNavigate()
  const allowGuest = React.useMemo(() => isAnonymousSignInSupported(), [])
  const location = useLocation()
  const deviceFlowActive = React.useMemo(() => {
    const search = location.search ?? ''
    if (!search) return false
    const params = new URLSearchParams(search)
    if (params.has('device_code')) return true
    if (params.has('challenge')) return true
    if (params.has('state')) return true
    return false
  }, [location.search])
  const [signingOut, setSigningOut] = React.useState(false)
  const redirectedRef = React.useRef(false)

  const handleSignOut = React.useCallback(async () => {
    setSigningOut(true)
    try {
      await signOut()
    } catch (err) {
      console.error('[AuthRoute] failed to sign out', err)
    } finally {
      setSigningOut(false)
    }
  }, [])

  React.useEffect(() => {
    if (!deviceFlowActive && status === 'authenticated') {
      if (!redirectedRef.current) {
        redirectedRef.current = true
        void navigate({ to: '/', replace: true })
      }
    } else {
      redirectedRef.current = false
    }
  }, [status, navigate, deviceFlowActive])

  if (!isConfigured && !isSupabaseConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-center">
        <div className="max-w-md space-y-3 rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow">
          <h2 className="text-xl font-semibold text-slate-900">Supabase environment missing</h2>
          <p className="text-sm text-slate-600">
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your explorer environment to enable
            authentication.
          </p>
        </div>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-500">
        <span className="text-sm font-medium">Checking session…</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-center">
        <div className="max-w-md space-y-3 rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-red-700 shadow">
          <h2 className="text-lg font-semibold">Authentication unavailable</h2>
          <p className="text-sm">{error?.message ?? 'Failed to initialise Supabase session.'}</p>
        </div>
      </div>
    )
  }

  if (status === 'authenticated' && deviceFlowActive) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-center">
        <div className="max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white px-6 py-8 text-slate-700 shadow">
          <h2 className="text-lg font-semibold text-slate-900">Daemon login in progress</h2>
          <p className="text-sm">
            You&rsquo;re already signed in. We&rsquo;ll reuse this session to finish the CLI login automatically. Keep this tab open until the CLI reports success.
          </p>
          <p className="text-xs text-slate-500">
            Need to switch accounts? Sign out below and sign back in with the desired credentials.
          </p>
          <button
            type="button"
            className="btn-secondary w-full text-sm"
            onClick={() => {
              void handleSignOut()
            }}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <AuthScreen
      allowGuest={allowGuest}
      onSignIn={signInWithPassword}
      onSignUp={signUpWithPassword}
      onResetPassword={sendPasswordResetEmail}
      onGuestSignIn={allowGuest ? signInAnonymously : undefined}
    />
  )
}

export { AuthRoute as AuthRouteComponent }
