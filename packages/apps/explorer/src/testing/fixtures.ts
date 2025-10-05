export interface BranchFixture {
  name: string
  target_sha: string | null
  updated_at?: string | null
}

export interface CommitFixture {
  sha: string
  author_name: string
  author_email?: string | null
  authored_at?: string | null
  message?: string | null
  tree_sha?: string | null
}

export interface FileChangeFixture {
  commit_sha: string
  path: string
  additions: number
  deletions: number
}

export interface RepoFixturePayload {
  orgId: string
  repoId: string
  branches?: Array<BranchFixture>
  commits?: Array<CommitFixture>
  fileChanges?: Array<FileChangeFixture>
}
