
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './index.css'
import { PowerSyncProvider } from './ps/powersync'
import { SupabaseAuthProvider } from './ps/auth-context'

const router = createRouter({ routeTree })
declare module '@tanstack/react-router' { interface Register { router: typeof router } }

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as typeof window & { __appRouter?: typeof router }).__appRouter = router
}

const app = (
  <SupabaseAuthProvider>
    <PowerSyncProvider>
      <RouterProvider router={router} />
    </PowerSyncProvider>
  </SupabaseAuthProvider>
)

const root = import.meta.env.VITE_DISABLE_STRICT_MODE === 'true' ? (
  app
) : (
  <React.StrictMode>{app}</React.StrictMode>
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  root,
)
