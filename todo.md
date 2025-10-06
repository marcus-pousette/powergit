# PowerSync Git Monorepo — Execution Log

## Current Status
- Supabase integration is still end-to-end for the remote helper push path: `uploadPushPack` forwards Git packs to the `powersync-push` edge function via `invokeSupabaseEdgeFunction`, and callers can override the function host with `POWERSYNC_SUPABASE_FUNCTIONS_URL` (used by tests + local stubs). Local stack script now starts a PowerSync container alongside Supabase (`pnpm dev:stack`).
- Shared package exposes `PowerSyncRemoteClient` with async token provider support; CLI/remote helper compiles and their unit + integration suites pass (`pnpm --filter @pkg/remote-helper test`).
- Explorer app has stream hooks and optional Supabase-backed connector. Local `.env` now includes Supabase vars and `VITE_POWERSYNC_DISABLED` toggle to run without backend.
- Vitest unit coverage exists for shared utilities, remote helper token fetch/push, and stream helpers. Test matrix via `pnpm test` currently green.
- `DEV_SETUP.md` now has a concise quick-start, day-to-day command table, and cleaned testing notes to help onboard faster.
- Explorer vendored TanStack DB packages are wired up; branches, commits, and file routes now use `useLiveQuery` against real PowerSync collections, and `pnpm --filter @app/explorer typecheck` passes with the new adapters.
- Workspace now overrides all TanStack DB packages to the vendored sources; ambient type shims are gone, and Vite resolves `@tanstack/powersync-db-collection` without Git tarballs.
- Playwright smoke tests now seed deterministic repo fixtures through the PowerSync dev bridge after navigation; `pnpm --filter @app/explorer test:e2e` runs green.
- `@pkg/cli` commands now have e2e coverage (temp `/tmp/psgit-e2e-*` repos for remote add/update/help/sync flows) plus lightweight unit tests that stub `simple-git` to assert remote updates and the new PowerSync sync workflow.

## In-Flight / Blocked
- Supabase documentation lives in `docs/supabase.md`, but explorer README references only; ensure CLI + remote helper docs link back.
- PowerSync edge functions still POST to stub endpoints; need to wire real PowerSync backend/S3 storage and update config guidance now that push is flowing.
- Live query routes lean on lightweight type assertions until upstream `@tanstack/db` exposes stronger inference for PowerSync collections; keep tracking the PR and remove casts once released.
- Playwright coverage is still smoke-level; consider layering additional flows (e.g., repo selector, activity timeline) now that fixture seeding is stable.
- CLI sync relies on local PowerSync + Supabase services when targeting the dev stack; keep an eye on Supabase CLI/Docker updates that might break scripted startup.

## Next Steps
1. Expand Playwright coverage with deterministic fixtures for refs/commits/files lists (likely by injecting a seeded PowerSync DB or mocking TanStack queries).
2. Extract the PowerSync schema tables from `packages/apps/explorer/src/ps/schema.ts` into `@pkg/shared` so both explorer and CLI reuse the same definitions.
3. Add progress indicators + streaming logs to `psgit sync` (e.g., show per-stream completion or bytes transferred) so long-running orgs have feedback.
4. Flesh out Supabase edge function examples (maybe under `supabase/functions/`). Include instructions in README for deploying them locally and in production.
5. Stand up real storage + PowerSync ingress for the Supabase functions (pack uploads currently sinkhole) and document required env wiring now that CLI push works via `POWERSYNC_SUPABASE_FUNCTIONS_URL` overrides.
6. Follow up on TanStack DB typings so we can drop the remaining type casts in explorer routes; confirm once the PR ships or consider thin local wrappers to preserve inference.
7. Add more Vitest coverage: e.g., connector Supabase upload path (mock `getCrudBatch`), `PowerSyncRemoteClient.fetchPack` behavior with JSON pack fallback.

Share this file with the next agent for continuity.
