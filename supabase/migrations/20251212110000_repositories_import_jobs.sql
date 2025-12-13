-- Repository registry + import jobs for PowerGit explorer.

-- Repositories
create table if not exists public.repositories (
  id text primary key,
  org_id text not null,
  repo_id text not null,
  repo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  default_branch text,
  last_status text,
  last_import_job_id text
);

create unique index if not exists repositories_org_repo_idx on public.repositories (org_id, repo_id);
create index if not exists repositories_updated_idx on public.repositories (updated_at desc);

-- Import jobs
create table if not exists public.import_jobs (
  id text primary key,
  org_id text not null,
  repo_id text not null,
  repo_url text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  branch text,
  default_branch text,
  error text,
  workflow_url text,
  source text
);

create index if not exists import_jobs_org_repo_idx on public.import_jobs (org_id, repo_id);
create index if not exists import_jobs_status_idx on public.import_jobs (status);
create index if not exists import_jobs_updated_idx on public.import_jobs (updated_at desc);

alter table public.repositories enable row level security;
alter table public.import_jobs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'repositories' and policyname = 'allow_all_repositories_rw') then
    create policy allow_all_repositories_rw on public.repositories for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'import_jobs' and policyname = 'allow_all_import_jobs_rw') then
    create policy allow_all_import_jobs_rw on public.import_jobs for all using (true) with check (true);
  end if;
end$$;

