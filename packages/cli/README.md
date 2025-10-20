# PowerSync Git CLI (`psgit`)

`psgit` is a lightweight helper that keeps your local Git repository pointed at the PowerSync remote helper while delegating all PowerSync connectivity work to the background daemon. With both the CLI and the `git-remote-powersync` binary on your `PATH`, standard `git push`/`git fetch` commands flow over PowerSync with no extra flags, and `psgit sync` gives you a quick way to ask the daemon how many refs/commits/file changes/objects it currently has for a repo.

## Install

Grab the published package from npm (replace `npm` with `pnpm` or `yarn` if you prefer another package manager):

```bash
npm install -g @pkg/cli
```

If you don’t want a global install, you can run it ad-hoc:

```bash
npx @pkg/cli remote add powersync powersync::https://<endpoint>/orgs/<org_slug>/repos/<repo_slug>
```

> **Heads up**
> The CLI configures Git to use the PowerSync remote helper. Make sure the helper is also installed—e.g. `npm install -g @pkg/remote-helper` so the executable `git-remote-powersync` is on your `PATH`.

## Authenticate once with `psgit login`

Before running commands that talk to PowerSync (for example `psgit sync`), sign in so the CLI can reuse the access token across invocations:

```bash
psgit login
```

By default this logs in to Supabase using the email/password exported by `pnpm dev:stack`. The resulting Supabase JWT is cached under `~/.psgit/session.json` and automatically reused by the CLI.

Need to stash a token manually (for CI or when you already have one)?

```bash
psgit login --manual --endpoint https://powersync.example.com --token <JWT>
```

When you want to discard credentials, run `psgit logout` to delete the cache file.

## Add a PowerSync remote in seconds

From the root of any Git repository, run:

```bash
psgit remote add powersync powersync::https://<endpoint>/orgs/<org_slug>/repos/<repo_slug>
```

What this does:

- Checks whether a remote named `origin` already exists (you can override the name; see below).
- Adds the remote if missing, or updates its URL if you've pointed it elsewhere.
- Prints a confirmation so you know which endpoint was configured.

You can verify the remote with standard Git tooling:

```bash
git remote -v
```

### Choose a different remote name

Set the `REMOTE_NAME` environment variable to target a custom remote (for example, leave your existing `origin` alone and populate `powersync` instead):

```bash
REMOTE_NAME=powersync psgit remote add powersync powersync::https://<endpoint>/orgs/<org_slug>/repos/<repo_slug>
```

### CI / ephemeral usage

When you’re scripting inside CI, grab the CLI via `npx`/`pnpm dlx` so you don’t have to manage a global install:

```bash
pnpm dlx @pkg/cli remote add powersync powersync::https://<endpoint>/orgs/<org_slug>/repos/<repo_slug>
```

## Developing the CLI locally

If you’re contributing to the CLI itself, clone the repository and work from source:

```bash
pnpm install
pnpm --filter @pkg/cli run build
```

Helpful scripts:

- `pnpm --filter @pkg/cli run typecheck` – static checks via `tsc`
- `pnpm --filter @pkg/cli test` – Vitest suite (unit + e2e)
- `pnpm --filter @pkg/cli run build` – transpile to `dist/` and ensure the binary stays executable

Whenever you expand the CLI with new commands, remember to document them here and add coverage under `packages/cli/tests/`.

## Inspect PowerSync metadata quickly

Once a repository has a PowerSync remote configured you can ask the daemon for the current counts of refs, commits, file changes, and objects that it is tracking for that repo:

```bash
psgit sync
```

### Flags

- `--remote` / `-r` – pick a non-default remote name (defaults to `origin` or `REMOTE_NAME` env var).

The command ensures the daemon is running (starting it if auto-start is enabled), reuses the cached credentials from `psgit login`, and makes a lightweight RPC call to the daemon. The daemon responds with counts derived from its PowerSync tables (`refs`, `commits`, `file_changes`, `objects`), so the CLI no longer creates or maintains its own SQLite database file.

> **When do I need Docker Compose?**
>
> Only when you run PowerSync locally. If you are targeting a hosted PowerSync endpoint, `psgit sync` works as-is. For local development, use the Supabase-powered stack (`pnpm dev:stack`) which shells out to the Supabase CLI; the CLI spins up the required Docker containers for PowerSync + Supabase under the hood. See `docs/supabase.md` for the full walkthrough and required environment variables.

### Stack-backed end-to-end test

When you have the local PowerSync + Supabase stack running (for example via `pnpm dev:stack` or your own Docker Compose deployment), you can run an additional Vitest suite that exercises `psgit sync` against the live services. Provide the connection details through environment variables so the test can discover the stack:

| Variable | Purpose |
| --- | --- |
| `PSGIT_TEST_REMOTE_URL` | PowerSync remote URL (e.g. `powersync::https://localhost:8080/orgs/acme/repos/infra`). *Required to enable the test.* |
| `PSGIT_TEST_REMOTE_NAME` | Git remote name to target (defaults to `powersync`). |
| `PSGIT_TEST_SUPABASE_URL` | Supabase REST URL (used for password login). |
| `PSGIT_TEST_SUPABASE_EMAIL` | Supabase user email used for HS256 login. |
| `PSGIT_TEST_SUPABASE_PASSWORD` | Supabase user password used for HS256 login. |
| `PSGIT_TEST_ENDPOINT` | Explicit PowerSync endpoint override (optional).
| `POWERSYNC_DATABASE_URL` | Connection string to the Supabase Postgres instance for seeding stream definitions (defaults to `postgres://postgres:postgres@127.0.0.1:55432/postgres`). |

With the stack up and variables exported, run the tests:

```bash
pnpm --filter @pkg/cli test
```

If a required variable is missing, the suite fails fast with a descriptive error so you never accidentally run the stub-only path.
