// @ts-nocheck

/* Manual stub for TanStack Router route tree */
import { createRootRoute, createRoute } from '@tanstack/react-router'
import * as Root from './routes/__root'
import { AuthRouteComponent } from './routes/auth'
import { HomeComponent } from './routes/index'
import { OrgActivityComponent } from './routes/org.$orgId.index'
import { RepoOverviewComponent } from './routes/org.$orgId.repo.$repoId.index'
import { BranchesComponent } from './routes/org.$orgId.repo.$repoId.branches'
import { CommitsComponent } from './routes/org.$orgId.repo.$repoId.commits'
import { FilesComponent } from './routes/org.$orgId.repo.$repoId.files'
import { ResetPasswordRouteComponent } from './routes/reset'

const rootRoute = createRootRoute({ component: Root.Route })
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomeComponent })
const authRoute = createRoute({ getParentRoute: () => rootRoute, path: 'auth', component: AuthRouteComponent })
const orgIndex = createRoute({ getParentRoute: () => rootRoute, path: 'org/$orgId/', component: OrgActivityComponent })
const repoIndex = createRoute({ getParentRoute: () => rootRoute, path: 'org/$orgId/repo/$repoId/', component: RepoOverviewComponent })
const repoBranches = createRoute({ getParentRoute: () => rootRoute, path: 'org/$orgId/repo/$repoId/branches', component: BranchesComponent })
const repoCommits = createRoute({ getParentRoute: () => rootRoute, path: 'org/$orgId/repo/$repoId/commits', component: CommitsComponent })
const repoFiles = createRoute({ getParentRoute: () => rootRoute, path: 'org/$orgId/repo/$repoId/files', component: FilesComponent })
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'reset-password',
  component: ResetPasswordRouteComponent,
})

export const routeTree = rootRoute.addChildren([
  indexRoute,
  authRoute,
  orgIndex,
  repoIndex,
  repoBranches,
  repoCommits,
  repoFiles,
  resetPasswordRoute,
])
