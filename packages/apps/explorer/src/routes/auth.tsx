import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AuthScreen } from '../screens/auth/AuthScreen'
import {
  isAnonymousSignInSupported,
  isSupabaseConfigured,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithPassword,
  signUpWithPassword,
} from '@ps/supabase'
import { useSupabaseAuth } from '@ps/auth-context'

export const Route = createFileRoute('/auth' as any)({
  component: AuthRoute,
})

export function AuthRoute() {
  const { status, isConfigured, error } = useSupabaseAuth()
  const navigate = Route.useNavigate()
  const allowGuest = React.useMemo(() => isAnonymousSignInSupported(), [])
  const redirectedRef = React.useRef(false)

  React.useEffect(() => {
    if (status === 'authenticated') {
      if (!redirectedRef.current) {
        redirectedRef.current = true
        void navigate({ to: '/', replace: true })
      }
    } else {
      redirectedRef.current = false
    }
  }, [status, navigate])

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
