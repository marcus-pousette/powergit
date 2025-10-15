
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './index.css'
import { PowerSyncProvider } from './ps/powersync'
import { SupabaseAuthProvider } from './ps/auth-context'
import { VaultProvider } from './ps/vault-context'

const router = createRouter({ routeTree })
declare module '@tanstack/react-router' { interface Register { router: typeof router } }

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as typeof window & { __appRouter?: typeof router }).__appRouter = router
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SupabaseAuthProvider>
      <VaultProvider>
        <PowerSyncProvider>
          <RouterProvider router={router} />
        </PowerSyncProvider>
      </VaultProvider>
    </SupabaseAuthProvider>
  </React.StrictMode>,
)
