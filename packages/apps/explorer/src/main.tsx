
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './index.css'
import { PowerSyncProvider } from './ps/powersync'

const router = createRouter({ routeTree })
declare module '@tanstack/react-router' { interface Register { router: typeof router } }

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as typeof window & { __appRouter?: typeof router }).__appRouter = router
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PowerSyncProvider>
      <RouterProvider router={router} />
    </PowerSyncProvider>
  </React.StrictMode>,
)
