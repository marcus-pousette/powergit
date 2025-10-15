import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { VaultScreen } from '../screens/auth/VaultScreen'
import { useVault } from '@ps/vault-context'
import { useSupabaseAuth } from '@ps/auth-context'
import { signOut } from '@ps/supabase'

export const Route = createFileRoute('/vault' as any)({
  component: VaultRoute,
})

export function VaultRoute() {
  const navigate = Route.useNavigate()
  const { status: authStatus } = useSupabaseAuth()
  const { status, hasVault, createVault, unlockVault, lockVault, clearVault } = useVault()

  React.useEffect(() => {
    if (authStatus !== 'authenticated') {
      void navigate({ to: '/auth' })
    }
  }, [authStatus, navigate])

  React.useEffect(() => {
    if (status === 'unlocked') {
      void navigate({ to: '/' })
    }
  }, [status, navigate])

  if (status === 'unlocked') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-500">
        <span className="text-sm font-medium">Vault unlocked. Redirecting…</span>
      </div>
    )
  }

  return (
    <VaultScreen
      hasVault={hasVault}
      status={status}
      onCreateVault={createVault}
      onUnlockVault={unlockVault}
      onClearVault={clearVault}
      onSignOut={async () => {
        await lockVault()
        await signOut()
        await navigate({ to: '/auth' })
      }}
    />
  )
}

export { VaultRoute as VaultRouteComponent }
