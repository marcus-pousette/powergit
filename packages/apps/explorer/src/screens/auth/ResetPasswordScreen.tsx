import * as React from 'react'

export interface ResetPasswordScreenProps {
  onSubmit: (password: string) => Promise<void>
  onCancel: () => void | Promise<void>
}

export const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({ onSubmit, onCancel }) => {
  const [password, setPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccessMessage(null)

    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await onSubmit(password)
      setSuccessMessage('Password updated. You can close this window or return to the explorer.')
      setPassword('')
      setConfirmPassword('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update password.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen w-full items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md">
          <div className="card space-y-6 px-8 py-10">
            <header className="space-y-2 text-center">
              <h2 className="text-2xl font-semibold text-slate-900">Set a new password</h2>
              <p className="text-sm text-slate-500">Choose a new password to finish resetting your account.</p>
            </header>
            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            ) : null}
            {successMessage ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700" role="status">
                {successMessage}
              </div>
            ) : null}
            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="flex flex-col gap-2 text-left">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">New password</span>
                <input
                  className="input h-12"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="New password"
                />
              </label>
              <label className="flex flex-col gap-2 text-left">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Confirm password</span>
                <input
                  className="input h-12"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Confirm password"
                />
              </label>
              <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                <button type="submit" className="btn w-full" disabled={loading}>
                  {loading ? 'Updating…' : 'Update password'}
                </button>
                <button
                  type="button"
                  className="btn-secondary w-full"
                  onClick={() => {
                    void onCancel()
                  }}
                  disabled={loading}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

