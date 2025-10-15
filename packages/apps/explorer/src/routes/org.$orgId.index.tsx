
import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useCollections } from '@tsdb/collections'
import { useOrgStreams } from '@ps/streams'
import type { Database } from '@ps/schema'

export const Route = createFileRoute('/org/$orgId/' as any)({
  component: OrgActivity,
})

export function OrgActivity() {
  const { orgId } = Route.useParams()
  const { refs } = useCollections()
  type RefRow = Pick<Database['refs'], 'org_id' | 'repo_id' | 'name' | 'target_sha' | 'updated_at'>
  const { data: rows = [] } = useLiveQuery(
    (q) =>
      q
        .from({ r: refs })
        .where(({ r }) => eq(r.org_id, orgId))
        .select(({ r }) => ({
          org_id: r.org_id,
          repo_id: r.repo_id,
          name: r.name,
          target_sha: r.target_sha,
          updated_at: r.updated_at,
        })),
    [refs, orgId],
  ) as { data: Array<RefRow> }

  const repoIds = React.useMemo(() => {
    if (rows.length === 0) return [] as string[]
    return Array.from(new Set(rows.map((ref) => ref.repo_id ?? '').filter(Boolean)))
  }, [rows])
  useOrgStreams(orgId, repoIds)

  const grouped = React.useMemo(() => {
    const map = new Map<
      string,
      {
        branches: Array<{
          name: string | null
          targetSha: string | null
          updatedAt: string | null
        }>
      }
    >()
    for (const row of rows) {
      const repoId = row.repo_id ?? ''
      if (!repoId) continue
      const entry = map.get(repoId) ?? { branches: [] }
      entry.branches.push({
        name: row.name ?? null,
        targetSha: row.target_sha ?? null,
        updatedAt: row.updated_at ?? null,
      })
      map.set(repoId, entry)
    }
    return Array.from(map.entries()).map(([repoId, value]) => ({
      repoId,
      branches: value.branches.sort((a, b) => {
        const safeA = a.updatedAt ?? ''
        const safeB = b.updatedAt ?? ''
        if (safeA === safeB) return 0
        return safeA > safeB ? -1 : 1
      }),
    }))
  }, [rows])

  const isLoading = rows.length === 0

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Org: {orgId} — Activity</h2>
      {isLoading ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-center text-sm text-slate-500">
          Loading repository refs…
        </div>
      ) : (
        <ul className="space-y-3">
          {grouped.map((repo) => (
            <li key={repo.repoId} className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-baseline justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{repo.repoId}</h3>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Tracked branches</p>
                </div>
                <Link
                  className="text-sm font-medium text-blue-600 hover:text-blue-500"
                  to="/org/$orgId/repo/$repoId"
                  params={{ orgId, repoId: repo.repoId }}
                >
                  Open repo →
                </Link>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-slate-600">
                {repo.branches.map((branch, index) => (
                  <li key={`${branch.name ?? 'branch'}-${index}`} className="flex items-center justify-between rounded bg-slate-50 px-3 py-2">
                    <div>
                      <div className="font-medium text-slate-800">{branch.name ?? '(unnamed ref)'}</div>
                      <div className="text-xs text-slate-500">
                        {branch.updatedAt ? new Date(branch.updatedAt).toLocaleString() : '—'}
                      </div>
                    </div>
                    <span className="font-mono text-xs text-slate-500">{branch.targetSha?.slice(0, 7) ?? '———'}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export { OrgActivity as OrgActivityComponent }
