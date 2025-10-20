export type RawTableParam = 'Id' | { Column: string }

export interface RawTableDefinition {
  tableName: string
  createStatements: string[]
  put: { sql: string; params: RawTableParam[] }
  delete: { sql: string; params: RawTableParam[] }
}

const sql = (input: string): string =>
  input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')

export const RAW_TABLE_SPECS: Record<'refs' | 'commits' | 'file_changes' | 'objects', RawTableDefinition> = {
  refs: {
    tableName: 'refs',
    createStatements: [
      sql(`
        CREATE TABLE IF NOT EXISTS refs (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          repo_id TEXT NOT NULL,
          name TEXT NOT NULL,
          target_sha TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `),
      sql('CREATE INDEX IF NOT EXISTS idx_refs_org_repo ON refs(org_id, repo_id)'),
      sql('CREATE UNIQUE INDEX IF NOT EXISTS idx_refs_org_repo_name ON refs(org_id, repo_id, name)'),
    ],
    put: {
      sql: sql(`
        INSERT INTO refs (id, org_id, repo_id, name, target_sha, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          org_id = excluded.org_id,
          repo_id = excluded.repo_id,
          name = excluded.name,
          target_sha = excluded.target_sha,
          updated_at = excluded.updated_at
      `),
      params: [
        'Id',
        { Column: 'org_id' },
        { Column: 'repo_id' },
        { Column: 'name' },
        { Column: 'target_sha' },
        { Column: 'updated_at' },
      ],
    },
    delete: { sql: 'DELETE FROM refs WHERE id = ?', params: ['Id'] },
  },
  commits: {
    tableName: 'commits',
    createStatements: [
      sql(`
        CREATE TABLE IF NOT EXISTS commits (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          repo_id TEXT NOT NULL,
          sha TEXT NOT NULL,
          author_name TEXT NOT NULL,
          author_email TEXT NOT NULL,
          authored_at TEXT NOT NULL,
          message TEXT NOT NULL,
          tree_sha TEXT NOT NULL
        )
      `),
      sql('CREATE INDEX IF NOT EXISTS idx_commits_org_repo ON commits(org_id, repo_id)'),
      sql('CREATE UNIQUE INDEX IF NOT EXISTS idx_commits_org_repo_sha ON commits(org_id, repo_id, sha)'),
      sql('CREATE INDEX IF NOT EXISTS idx_commits_author_email ON commits(author_email)'),
    ],
    put: {
      sql: sql(`
        INSERT INTO commits (id, org_id, repo_id, sha, author_name, author_email, authored_at, message, tree_sha)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          org_id = excluded.org_id,
          repo_id = excluded.repo_id,
          sha = excluded.sha,
          author_name = excluded.author_name,
          author_email = excluded.author_email,
          authored_at = excluded.authored_at,
          message = excluded.message,
          tree_sha = excluded.tree_sha
      `),
      params: [
        'Id',
        { Column: 'org_id' },
        { Column: 'repo_id' },
        { Column: 'sha' },
        { Column: 'author_name' },
        { Column: 'author_email' },
        { Column: 'authored_at' },
        { Column: 'message' },
        { Column: 'tree_sha' },
      ],
    },
    delete: { sql: 'DELETE FROM commits WHERE id = ?', params: ['Id'] },
  },
  file_changes: {
    tableName: 'file_changes',
    createStatements: [
      sql(`
        CREATE TABLE IF NOT EXISTS file_changes (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          repo_id TEXT NOT NULL,
          commit_sha TEXT NOT NULL,
          path TEXT NOT NULL,
          additions INTEGER NOT NULL,
          deletions INTEGER NOT NULL
        )
      `),
      sql('CREATE INDEX IF NOT EXISTS idx_file_changes_org_repo ON file_changes(org_id, repo_id)'),
      sql('CREATE INDEX IF NOT EXISTS idx_file_changes_path ON file_changes(path)'),
      sql('CREATE UNIQUE INDEX IF NOT EXISTS idx_file_changes_commit_path ON file_changes(org_id, repo_id, commit_sha, path)'),
    ],
    put: {
      sql: sql(`
        INSERT INTO file_changes (id, org_id, repo_id, commit_sha, path, additions, deletions)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          org_id = excluded.org_id,
          repo_id = excluded.repo_id,
          commit_sha = excluded.commit_sha,
          path = excluded.path,
          additions = excluded.additions,
          deletions = excluded.deletions
      `),
      params: [
        'Id',
        { Column: 'org_id' },
        { Column: 'repo_id' },
        { Column: 'commit_sha' },
        { Column: 'path' },
        { Column: 'additions' },
        { Column: 'deletions' },
      ],
    },
    delete: { sql: 'DELETE FROM file_changes WHERE id = ?', params: ['Id'] },
  },
  objects: {
    tableName: 'objects',
    createStatements: [
      sql(`
        CREATE TABLE IF NOT EXISTS objects (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          repo_id TEXT NOT NULL,
          pack_oid TEXT NOT NULL,
          pack_bytes TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `),
      sql('CREATE INDEX IF NOT EXISTS idx_objects_org_repo_created ON objects(org_id, repo_id, created_at)'),
      sql('CREATE UNIQUE INDEX IF NOT EXISTS idx_objects_oid ON objects(org_id, repo_id, pack_oid)'),
    ],
    put: {
      sql: sql(`
        INSERT INTO objects (id, org_id, repo_id, pack_oid, pack_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          org_id = excluded.org_id,
          repo_id = excluded.repo_id,
          pack_oid = excluded.pack_oid,
          pack_bytes = excluded.pack_bytes,
          created_at = excluded.created_at
      `),
      params: [
        'Id',
        { Column: 'org_id' },
        { Column: 'repo_id' },
        { Column: 'pack_oid' },
        { Column: 'pack_bytes' },
        { Column: 'created_at' },
      ],
    },
    delete: { sql: 'DELETE FROM objects WHERE id = ?', params: ['Id'] },
  },
}

export const RAW_TABLES_FOR_SCHEMA = {
  refs: {
    put: RAW_TABLE_SPECS.refs.put,
    delete: RAW_TABLE_SPECS.refs.delete,
  },
  commits: {
    put: RAW_TABLE_SPECS.commits.put,
    delete: RAW_TABLE_SPECS.commits.delete,
  },
  file_changes: {
    put: RAW_TABLE_SPECS.file_changes.put,
    delete: RAW_TABLE_SPECS.file_changes.delete,
  },
  objects: {
    put: RAW_TABLE_SPECS.objects.put,
    delete: RAW_TABLE_SPECS.objects.delete,
  },
} satisfies Record<string, { put: { sql: string; params: RawTableParam[] }; delete: { sql: string; params: RawTableParam[] } }>

export const RAW_TABLE_CREATE_STATEMENTS = {
  refs: RAW_TABLE_SPECS.refs.createStatements,
  commits: RAW_TABLE_SPECS.commits.createStatements,
  file_changes: RAW_TABLE_SPECS.file_changes.createStatements,
  objects: RAW_TABLE_SPECS.objects.createStatements,
} satisfies Record<string, string[]>

export type RawTableKey = keyof typeof RAW_TABLE_SPECS
