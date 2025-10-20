export const REPO_STREAM_SUFFIXES = ['refs', 'commits', 'file_changes', 'objects'] as const;
export type RepoStreamSuffix = typeof REPO_STREAM_SUFFIXES[number];

const STREAM_TEMPLATE_PREFIX = 'orgs/{org_id}/repos/{repo_id}';

const TEMPLATE_MAP: Record<RepoStreamSuffix, string> = {
  refs: `${STREAM_TEMPLATE_PREFIX}/refs`,
  commits: `${STREAM_TEMPLATE_PREFIX}/commits`,
  file_changes: `${STREAM_TEMPLATE_PREFIX}/file_changes`,
  objects: `${STREAM_TEMPLATE_PREFIX}/objects`,
};

export const REPO_STREAM_TEMPLATES = TEMPLATE_MAP;

export interface RepoStreamTarget {
  id: string;
  parameters: { org_id: string; repo_id: string };
}

export function buildRepoStreamTargets(org: string, repo: string): RepoStreamTarget[] {
  const orgId = org.trim();
  const repoId = repo.trim();
  const params = { org_id: orgId, repo_id: repoId };
  return REPO_STREAM_SUFFIXES.map((suffix) => ({
    id: TEMPLATE_MAP[suffix],
    parameters: { ...params },
  }));
}

export function formatStreamKey(target: RepoStreamTarget): string {
  const params = target.parameters ?? null;
  if (!params || Object.keys(params).length === 0) {
    return target.id;
  }
  const query = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value ?? ''))}`)
    .join('&');
  return `${target.id}?${query}`;
}
