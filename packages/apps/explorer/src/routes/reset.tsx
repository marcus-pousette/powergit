import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen'
import { signOut, updateCurrentUserPassword } from '@ps/supabase'
import { useSupabaseAuth } from '@ps/auth-context'

export const Route = createFileRoute('/reset-password' as any)({
  component: ResetPasswordRoute,
})

export function ResetPasswordRoute() {
  const { status } = useSupabaseAuth()
  const navigate = Route.useNavigate()
  const [completed, setCompleted] = React.useState(false)

  const handleSubmit = React.useCallback(
    async (password: string) => {
      await updateCurrentUserPassword(password)
      setCompleted(true)
      void navigate({ to: '/' })
    },
    [navigate],
  )

  const handleCancel = React.useCallback(async () => {
    await signOut().catch(() => undefined)
    void navigate({ to: '/auth' })
  }, [navigate])

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-500">
        <span className="text-sm font-medium">Preparing reset form…</span>
      </div>
    )
  }

  if (!completed && status === 'unauthenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-center">
        <div className="max-w-md space-y-3 rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow">
          <h2 className="text-lg font-semibold text-slate-900">Password reset link expired</h2>
          <p className="text-sm text-slate-600">Request a new reset email before trying again.</p>
          <button
            type="button"
            className="btn w-full"
            onClick={() => {
              void navigate({ to: '/auth' })
            }}
          >
            Return to sign in
          </button>
        </div>
      </div>
    )
  }

  return <ResetPasswordScreen onSubmit={handleSubmit} onCancel={handleCancel} />
}

export { ResetPasswordRoute as ResetPasswordRouteComponent }
