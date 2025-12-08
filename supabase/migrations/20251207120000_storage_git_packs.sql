-- Ensure git pack storage works for authenticated users without a service role key.
-- Idempotent: safely re-runable.

-- Create the bucket if missing and mark it public (public flag controls signed URL requirements, not RLS).
insert into storage.buckets (id, name, public)
values ('git-packs', 'git-packs', true)
on conflict (id) do update set public = excluded.public;

-- Policies: allow authenticated users full access to git-packs objects.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'git_packs_auth_read'
  ) then
    create policy git_packs_auth_read
      on storage.objects
      for select
      using (bucket_id = 'git-packs' and auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'git_packs_auth_write'
  ) then
    create policy git_packs_auth_write
      on storage.objects
      for insert
      with check (bucket_id = 'git-packs' and auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'git_packs_auth_update'
  ) then
    create policy git_packs_auth_update
      on storage.objects
      for update
      using (bucket_id = 'git-packs' and auth.role() = 'authenticated')
      with check (bucket_id = 'git-packs' and auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'git_packs_auth_delete'
  ) then
    create policy git_packs_auth_delete
      on storage.objects
      for delete
      using (bucket_id = 'git-packs' and auth.role() = 'authenticated');
  end if;
end$$;
