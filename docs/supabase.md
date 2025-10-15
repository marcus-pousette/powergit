# Supabase Integration

The PowerSync-first architecture stores Git metadata in Supabase while the PowerSync daemon synchronises changes between the local replica and Supabase. The daemon now owns all Supabase connectivity—credential exchange, CRUD uploads, and storage mirroring—so no Supabase edge functions are required anywhere in the toolchain.

## Environment Variables

| Variable | Description |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL used by the explorer (e.g. `https://xyzcompany.supabase.co`). |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key that the browser can embed. |
| `VITE_SUPABASE_SCHEMA` | Optional schema override for browser reads (defaults to `public`). |
| `POWERSYNC_SUPABASE_URL` | Supabase project URL used by the daemon/CLI for server-side access. |
| `POWERSYNC_SUPABASE_SERVICE_ROLE_KEY` | Service role key consumed by the daemon’s Supabase writer. |
| `POWERSYNC_SUPABASE_EMAIL` | Supabase user email used by the CLI/daemon for password-based login in development. |
| `POWERSYNC_SUPABASE_PASSWORD` | Matching Supabase user password; exported automatically by `pnpm dev:stack`. |
| `POWERSYNC_SUPABASE_JWT_SECRET` | The Supabase JWT secret required by the PowerSync service and daemon. |
| `POWERSYNC_DAEMON_DEVICE_URL` | Optional verification URL the daemon prints for device flows (e.g. `http://localhost:5173/auth`). |
| `POWERSYNC_DAEMON_DEVICE_AUTO_LAUNCH` | When `true`, the daemon attempts to open the verification URL in the default browser. |
| `POWERSYNC_DAEMON_DEVICE_TTL_MS` | Override (in milliseconds) for how long a device challenge remains valid (default 5 minutes). |

## Local Development

1. Apply the latest migrations (e.g. `supabase/migrations/20241007090000_powersync_git_tables.sql`) with `supabase db push`. This targets the local stack if it is already running, or your linked Supabase project otherwise.
2. Start the combined Supabase + PowerSync stack:
   ```bash
   pnpm dev:stack
   ```
   The script launches the Supabase containers, bootstraps the PowerSync services, ensures a development Supabase user exists, and writes connection details to `.env.powersync-stack`.
3. Export the generated environment variables:
   ```bash
   source .env.powersync-stack
   ```
   or `pnpm dev:stack -- --print-exports` if you prefer to inspect them first.
4. Start the device flow so `psgit` and the daemon can reuse a Supabase-issued JWT:
   ```bash
   pnpm --filter @pkg/cli login
   ```
   The CLI prints a device code and, when `POWERSYNC_DAEMON_DEVICE_URL` is set, a ready-to-click URL. Visit the URL in a browser (the explorer exposes `/auth?device_code=…` for development), sign in with the Supabase credentials exported by `pnpm dev:stack`, and the daemon will persist the resulting token.

5. Launch the explorer (`pnpm dev`) or other clients. They read PowerSync credentials from your `.env.local` (see `docs/env.local.example`) and talk directly to the PowerSync endpoint; the daemon forwards any mutations to Supabase on your behalf. The explorer automatically completes pending device challenges when the user signs in, so you can re-run `psgit login` later without leaving the browser.

When you are done, run `pnpm dev:stack stop` (or `supabase stop`) to shut everything down.

## Production Notes

- Follow the official [Supabase + PowerSync guide](https://docs.powersync.com/integration-guides/supabase-+-powersync) for hosted environments.
- The daemon requires a Supabase service-role key (or service token) so it can persist refs, commits, and objects without exposing credentials to end users.
- In CI or other headless contexts, set `POWERSYNC_SERVICE_KEY` (or equivalent) so the daemon can authenticate without launching an interactive browser flow.

## Rotating Supabase Auth to RS256 (Optional)

The local stack and CLI default to Supabase’s HS256 tokens. If you later rotate your Supabase project to RS256, follow the official Supabase guidance and make sure PowerSync can fetch the new JWKS. After Supabase serves the RS256 keys, restart the PowerSync service so it reloads the configuration, then confirm that a fresh Supabase login works end-to-end.
