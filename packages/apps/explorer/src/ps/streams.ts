
import * as React from 'react'
import { usePowerSync } from '@powersync/react'
import type { PowerSyncDatabase, SyncStreamSubscription } from '@powersync/web'

const STREAM_NAMES = ['refs', 'commits', 'file_changes', 'objects'] as const
const isPowerSyncDisabled = import.meta.env.VITE_POWERSYNC_DISABLED === 'true'

export const DEFAULT_REPO_SLUGS = resolveDefaultRepos(import.meta.env.VITE_POWERSYNC_DEFAULT_REPOS)

async function subscribeToStreams(ps: PowerSyncDatabase, streamIds: readonly string[]) {
  await ps.waitForReady().catch(() => undefined)
  const subscriptions: SyncStreamSubscription[] = []
  try {
    for (const streamId of streamIds) {
      const stream = ps.syncStream(streamId)
      const subscription = await stream.subscribe()
      subscriptions.push(subscription)
    }
  } catch (error) {
    subscriptions.forEach((subscription) => subscription.unsubscribe())
    throw error
  }
  return subscriptions
}

export async function openRepo(ps: PowerSyncDatabase, orgId: string, repoId: string) {
  const streamIds = STREAM_NAMES.map((name) => `orgs/${orgId}/repos/${repoId}/${name}`)
  return subscribeToStreams(ps, streamIds)
}

export async function openOrg(ps: PowerSyncDatabase, orgId: string, repoIds: readonly string[]) {
  const targets = resolveRepoTargets(repoIds)
  const subscriptions = await Promise.all(targets.map((repoId) => openRepo(ps, orgId, repoId)))
  return subscriptions.flat()
}

export function useRepoStreams(orgId: string, repoId: string) {
  const ps = usePowerSync() as PowerSyncDatabase | null

  React.useEffect(() => {
    if (!ps || !repoId || isPowerSyncDisabled) return undefined
    let disposed = false
    let active: SyncStreamSubscription[] = []

    const task = async () => {
      try {
        active = await openRepo(ps, orgId, repoId)
      } catch (error) {
        if (!disposed) console.error('[PowerSync] failed to subscribe repo stream', error)
      }
    }

    void task()

    return () => {
      disposed = true
      active.forEach((subscription) => subscription.unsubscribe())
    }
  }, [ps, orgId, repoId])
}

export function useOrgStreams(orgId: string, repoIds: readonly string[]) {
  const ps = usePowerSync() as PowerSyncDatabase | null
  const key = React.useMemo(() => normalizeRepoList(repoIds).join('|'), [repoIds])

  React.useEffect(() => {
    if (!ps || isPowerSyncDisabled) return undefined
    const targets = resolveRepoTargets(repoIds)
    if (targets.length === 0) return undefined

    let disposed = false
    let active: SyncStreamSubscription[] = []

    const task = async () => {
      try {
        active = await Promise.all(targets.map((repoId) => openRepo(ps, orgId, repoId))).then((rows) => rows.flat())
      } catch (error) {
        if (!disposed) console.error('[PowerSync] failed to subscribe org streams', error)
      }
    }

    void task()

    return () => {
      disposed = true
      active.forEach((subscription) => subscription.unsubscribe())
    }
  }, [ps, orgId, key])
}

export function normalizeRepoList(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export function resolveDefaultRepos(raw?: string): string[] {
  const parsed = normalizeRepoList(raw ? raw.split(',') : [])
  if (parsed.length > 0) return parsed
  return ['infra']
}

export function resolveRepoTargets(input: readonly string[]): string[] {
  const fromInput = normalizeRepoList(input)
  if (fromInput.length > 0) return fromInput
  return DEFAULT_REPO_SLUGS
}
