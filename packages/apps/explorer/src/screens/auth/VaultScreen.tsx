import * as React from 'react'

export interface VaultScreenProps {
  hasVault: boolean
  status: 'loading' | 'needsSetup' | 'locked' | 'unlocked'
  onCreateVault: (passphrase: string) => Promise<void>
  onUnlockVault: (passphrase: string) => Promise<void>
  onSignOut: () => Promise<void> | void
  onClearVault?: () => Promise<void> | void
}

export const VaultScreen: React.FC<VaultScreenProps> = ({
  hasVault,
  status,
  onCreateVault,
  onUnlockVault,
  onSignOut,
  onClearVault,
}) => {
  const [passphrase, setPassphrase] = React.useState('')
  const [confirmPassphrase, setConfirmPassphrase] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)

  React.useEffect(() => {
    setPassphrase('')
    setConfirmPassphrase('')
    setError(null)
    setLoading(false)
  }, [status])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!passphrase) {
      setError('Passphrase required.')
      return
    }

    if (!hasVault || status === 'needsSetup') {
      if (passphrase.length < 12) {
        setError('Use at least 12 characters for a new vault.')
        return
      }
      if (!confirmPassphrase) {
        setError('Confirm your passphrase.')
        return
      }
      if (passphrase !== confirmPassphrase) {
        setError('Passphrases do not match.')
        return
      }
    }

    setLoading(true)
    try {
      if (!hasVault || status === 'needsSetup') {
        await onCreateVault(passphrase)
      } else {
        await onUnlockVault(passphrase)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Vault operation failed.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const heading = hasVault ? 'Unlock your workspace vault' : 'Create your workspace vault'
  const description = hasVault
    ? 'Enter the passphrase you set for this device to decrypt replicated data.'
    : 'Choose a passphrase to protect local secrets before we connect to PowerSync.'

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen w-full items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-3xl">
          <div className="card px-8 py-10">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5">
                <h1 className="text-2xl font-semibold text-slate-900" data-testid="vault-heading">
                  {heading}
                </h1>
                <p className="text-sm text-slate-500">{description}</p>
              </div>
              <div className="flex gap-2">
                {hasVault && onClearVault ? (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => {
                      if (confirm('Remove the local vault? You will need to create a new one next time.')) {
                        void onClearVault()
                      }
                    }}
                  >
                    Clear vault
                  </button>
                ) : null}
                <button type="button" className="btn-secondary text-xs" onClick={() => void onSignOut()} data-testid="vault-sign-out-button">
                  Sign out
                </button>
              </div>
            </div>
            {status === 'loading' ? (
              <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 py-8 text-sm text-slate-500">
                Preparing vault…
              </div>
            ) : (
              <>
                {error ? (
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
                ) : null}
                <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {hasVault ? 'Passphrase' : 'Choose a passphrase'}
                    </label>
                    <input
                      className="input h-12"
                      type={showConfirm ? 'text' : 'password'}
                      value={passphrase}
                      onChange={(event) => setPassphrase(event.target.value)}
                      placeholder={hasVault ? 'Passphrase' : 'Choose a strong passphrase'}
                      data-testid="vault-passphrase-input"
                    />
                  </div>
                  {!hasVault ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
                        <span>Confirm passphrase</span>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-blue-600"
                          onClick={() => setShowConfirm((prev) => !prev)}
                        >
                          {showConfirm ? 'Hide passphrases' : 'Show passphrases'}
                        </button>
                      </div>
                      <input
                        className="input h-12"
                        type={showConfirm ? 'text' : 'password'}
                        value={confirmPassphrase}
                        onChange={(event) => setConfirmPassphrase(event.target.value)}
                        placeholder="Confirm passphrase"
                        data-testid="vault-confirm-passphrase-input"
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                    <button type="submit" className="btn w-full" disabled={loading} data-testid="vault-submit-button">
                      {loading ? (hasVault ? 'Unlocking…' : 'Creating…') : hasVault ? 'Unlock vault' : 'Create vault'}
                    </button>
                    {hasVault ? (
                      <button
                        type="button"
                        className="btn-secondary w-full"
                        onClick={() => setPassphrase('')}
                        disabled={loading}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
