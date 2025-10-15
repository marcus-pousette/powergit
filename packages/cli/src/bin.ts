#!/usr/bin/env node
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { addPowerSyncRemote, syncPowerSyncRepository, seedDemoRepository } from './index.js'
import {
  loginWithDaemonDevice,
  loginWithDaemonGuest,
  logout as logoutSession,
} from './auth/login.js'

interface LoginCommandArgs {
  manual?: boolean
  guest?: boolean
  auto?: boolean
  token?: string
  endpoint?: string
  session?: string
  daemonUrl?: string
  supabaseEmail?: string
  supabasePassword?: string
  supabaseUrl?: string
  supabaseAnonKey?: string
}

interface DemoSeedCommandArgs {
  remoteUrl?: string | null
  remoteName?: string | null
  branch?: string | null
  skipSync?: boolean
  keepRepo?: boolean
  repoDir?: string | null
}

interface LogoutCommandArgs {
  session?: string
  daemonUrl?: string
}

async function runRemoteAddCommand(args: { url: string; remote?: string | null }) {
  const remoteName = args.remote ?? process.env.REMOTE_NAME ?? 'origin'
  await addPowerSyncRemote(process.cwd(), remoteName, args.url)
  console.log(`Added PowerSync remote (${remoteName}): ${args.url}`)
}

async function runSyncCommand(args: { remote?: string | null }) {
  const remoteName = args.remote ?? process.env.REMOTE_NAME ?? 'origin'
  const result = await syncPowerSyncRepository(process.cwd(), {
    remoteName,
  })
  console.log(`Synced PowerSync repo ${result.org}/${result.repo}`)
  console.log(`  Endpoint: ${result.endpoint}`)
  if (result.databasePath) {
    console.log(`  Snapshot: ${result.databasePath}`)
  }
  console.log(
    `  Rows: ${result.counts.refs} refs, ${result.counts.commits} commits, ${result.counts.file_changes} file changes, ${result.counts.objects} objects`,
  )
}

async function runDemoSeedCommand(args: DemoSeedCommandArgs) {
  const options: Parameters<typeof seedDemoRepository>[0] = {
    remoteUrl: args.remoteUrl ?? undefined,
    remoteName: args.remoteName ?? undefined,
    branch: args.branch ?? undefined,
    skipSync: Boolean(args.skipSync),
    keepWorkingDir: args.keepRepo ?? Boolean(args.repoDir),
    workingDir: args.repoDir ?? undefined,
  }

  const result = await seedDemoRepository(options)
  console.log('✅ Seeded demo repository via PowerSync remote.')
  console.log(`   Remote: ${result.remoteUrl}`)
  console.log(`   Branch: ${result.branch}`)
  if (options.keepWorkingDir && result.workingDirectory) {
    console.log(`   Temp repo kept at: ${result.workingDirectory}`)
  }
  if (!options.skipSync && result.syncedDatabase) {
    console.log(`   Local snapshot: ${result.syncedDatabase}`)
  }
}

async function runLoginCommand(args: LoginCommandArgs) {
  let mode: 'auto' | 'manual' | 'guest' = 'auto'
  if (args.manual) mode = 'manual'
  if (args.guest) mode = 'guest'
  if (args.auto) mode = 'auto'

  if (mode === 'manual') {
    if (!args.token) {
      throw new Error('Manual login requires --token.')
    }
    const { baseUrl, status } = await loginWithDaemonGuest({
      daemonUrl: args.daemonUrl,
      endpoint: args.endpoint,
      token: args.token,
      metadata: { source: 'manual' },
    })
    if (!status) {
      throw new Error(`Daemon at ${baseUrl} did not return an auth status.`)
    }
    if (status.status !== 'ready') {
      const reason = status.reason ? ` (${status.reason})` : ''
      throw new Error(`Daemon reported ${status.status}${reason}.`)
    }
    console.log('✅ PowerSync daemon accepted manual token.')
    console.log(`   Endpoint: ${args.endpoint ?? 'auto'}`)
    if (status.expiresAt) {
      console.log(`   Expires: ${status.expiresAt}`)
    }
    return
  }

  if (mode === 'guest') {
    const { baseUrl, status } = await loginWithDaemonGuest({
      daemonUrl: args.daemonUrl,
      endpoint: args.endpoint,
      token: args.token,
    })
    if (!status) {
      throw new Error(`Daemon at ${baseUrl} did not return an auth status.`)
    }
    if (status.status === 'ready') {
      console.log('✅ Daemon joined as guest.')
      if (status.expiresAt) {
        console.log(`   Expires: ${status.expiresAt}`)
      }
      return
    }
    if (status.status === 'pending') {
      console.log('Daemon reports authentication pending. Complete the guest provisioning and rerun `psgit login --guest`.')
      if (status.reason) {
        console.log(`Reason: ${status.reason}`)
      }
      process.exit(1)
    }
    const reason = status.reason ? ` (${status.reason})` : ''
    throw new Error(`Daemon guest login failed with status ${status.status}${reason}.`)
  }

  if (
    args.supabaseEmail != null ||
    args.supabasePassword != null ||
    args.supabaseUrl != null ||
    args.supabaseAnonKey != null
  ) {
    console.warn('[psgit] Supabase credential flags are no longer supported; routing login through daemon device flow.')
  }

  const loginResult = await loginWithDaemonDevice({
    daemonUrl: args.daemonUrl,
    endpoint: args.endpoint,
  })

  const explainChallenge = (prefix: string) => {
    const challenge = loginResult.challenge
    if (!challenge) return
    console.log(prefix)
    if (challenge.verificationUrl) {
      console.log(`   Open: ${challenge.verificationUrl}`)
    }
    console.log(`   Device code: ${challenge.challengeId}`)
    if (challenge.expiresAt) {
      console.log(`   Expires: ${challenge.expiresAt}`)
    }
  }

  const initialStatus = loginResult.initialStatus
  if (initialStatus?.status === 'pending' && initialStatus.reason) {
    console.log(`Daemon requested interactive login: ${initialStatus.reason}`)
  }
  if (initialStatus?.status === 'pending') {
    explainChallenge('To finish authentication:')
  }

  const finalStatus = loginResult.finalStatus
  if (!finalStatus) {
    throw new Error('Daemon did not provide an auth status. Check daemon logs for details.')
  }

  if (finalStatus.status === 'ready') {
    console.log('✅ PowerSync daemon authenticated successfully.')
    if (finalStatus.expiresAt) {
      console.log(`   Expires: ${finalStatus.expiresAt}`)
    }
    return
  }

  if (finalStatus.status === 'error' || finalStatus.status === 'auth_required') {
    const reason = finalStatus.reason ? ` (${finalStatus.reason})` : ''
    throw new Error(`Daemon reported ${finalStatus.status}${reason}.`)
  }

  if (loginResult.timedOut) {
    const reason = finalStatus.reason ? ` (${finalStatus.reason})` : ''
    explainChallenge('Authentication is still pending; complete the flow in your browser or Explorer.')
    throw new Error(`Timed out waiting for daemon authentication${reason}.`)
  }

  console.log('Daemon authentication still pending. Complete the browser/device flow and rerun `psgit login`.')
  if (finalStatus.reason) {
    console.log(`Reason: ${finalStatus.reason}`)
  }
  explainChallenge('Pending device challenge:')
  process.exit(1)
}

async function runLogoutCommand(args: LogoutCommandArgs) {
  await logoutSession({ sessionPath: args.session, daemonUrl: args.daemonUrl })
  console.log('✅ Cleared stored PowerSync credentials.')
}

function printUsage() {
  console.log('psgit commands:')
  console.log('  psgit remote add powersync powersync::https://<endpoint>/orgs/<org>/repos/<repo>')
  console.log('  psgit sync [--remote <name>]')
  console.log('  psgit demo-seed [--remote-url <url>] [--remote <name>] [--branch <branch>] [--skip-sync] [--keep-repo]')
  console.log('  psgit login [--guest] [--manual --token <jwt>] [--endpoint <url>] [--daemon-url <url>]')
  console.log('  psgit logout [--daemon-url <url>]')
}

function buildCli() {
  const defaultRemote = process.env.REMOTE_NAME ?? 'origin'

  return yargs(hideBin(process.argv))
    .scriptName('psgit')
    .usage(
      'psgit commands:\n' +
        '  psgit remote add powersync powersync::https://<endpoint>/orgs/<org>/repos/<repo>\n' +
        '  psgit sync [--remote <name>]\n' +
        '  psgit demo-seed [--remote-url <url>] [--remote <name>] [--branch <branch>] [--skip-sync] [--keep-repo]\n' +
        '  psgit login [--guest] [--manual --token <jwt>] [--endpoint <url>] [--daemon-url <url>]\n' +
        '  psgit logout [--daemon-url <url>]',
    )
    .command(
      'remote add powersync <url>',
      'Add or update a PowerSync remote',
      (y) =>
        y
          .positional('url', {
            type: 'string',
            describe: 'PowerSync remote URL (powersync::https://…)',
          })
          .option('remote', {
            alias: 'r',
            type: 'string',
            describe: 'Git remote name',
            default: defaultRemote,
          }),
      async (argv) => {
        await runRemoteAddCommand({ url: argv.url as string, remote: (argv.remote as string) ?? defaultRemote })
      },
    )
    .command(
      'sync',
      'Synchronise the local repository snapshot',
      (y) =>
        y.option('remote', {
          alias: 'r',
          type: 'string',
          describe: 'Git remote name',
          default: defaultRemote,
        }),
      async (argv) => {
        await runSyncCommand({ remote: (argv.remote as string) ?? defaultRemote })
      },
    )
    .command(
      'demo-seed',
      'Seed a demo repository via the PowerSync remote helper',
      (y) =>
        y
          .option('remote-url', {
            alias: 'url',
            type: 'string',
            describe: 'PowerSync remote URL override',
          })
          .option('remote', {
            alias: 'r',
            type: 'string',
            describe: 'Git remote name override',
          })
          .option('branch', {
            type: 'string',
            describe: 'Branch to push (default main)',
          })
          .option('skip-sync', {
            type: 'boolean',
            describe: 'Skip the follow-up PowerSync sync after pushing',
            default: false,
          })
          .option('keep-repo', {
            type: 'boolean',
            describe: 'Keep the temporary Git repository on disk',
            default: false,
          })
          .option('repo-dir', {
            type: 'string',
            describe: 'Explicit working directory (implies --keep-repo)',
          }),
      async (argv) => {
        await runDemoSeedCommand({
          remoteUrl: (argv['remote-url'] as string | undefined) ?? (argv.url as string | undefined) ?? null,
          remoteName: (argv.remote as string | undefined) ?? null,
          branch: (argv.branch as string | undefined) ?? null,
          skipSync: argv['skip-sync'] as boolean | undefined,
          keepRepo: argv['keep-repo'] as boolean | undefined,
          repoDir: (argv['repo-dir'] as string | undefined) ?? null,
        })
      },
    )
    .command(
      'login',
      'Authenticate the PowerSync daemon',
      (y) =>
        y
          .option('manual', {
            type: 'boolean',
            describe: 'Provide an explicit PowerSync token',
          })
          .option('guest', {
            type: 'boolean',
            describe: 'Join as a guest user (anonymous token)',
          })
          .option('auto', {
            type: 'boolean',
            describe: 'Force device/browser flow (default)',
          })
          .option('token', {
            type: 'string',
            describe: 'PowerSync JWT',
          })
          .option('endpoint', {
            type: 'string',
            describe: 'PowerSync endpoint override',
          })
          .option('session', {
            type: 'string',
            describe: 'Legacy credential cache path',
          })
          .option('daemon-url', {
            type: 'string',
            describe: 'PowerSync daemon base URL',
          })
          .option('supabase-email', {
            type: 'string',
            describe: 'Supabase email (deprecated)',
          })
          .option('supabase-password', {
            type: 'string',
            describe: 'Supabase password (deprecated)',
          })
          .option('supabase-url', {
            type: 'string',
            describe: 'Supabase URL (deprecated)',
          })
          .option('supabase-anon-key', {
            type: 'string',
            describe: 'Supabase anon key (deprecated)',
          }),
      async (argv) => {
        await runLoginCommand({
          manual: argv.manual as boolean | undefined,
          guest: argv.guest as boolean | undefined,
          auto: argv.auto as boolean | undefined,
          token: argv.token as string | undefined,
          endpoint: argv.endpoint as string | undefined,
          session: argv.session as string | undefined,
          daemonUrl: argv['daemon-url'] as string | undefined,
          supabaseEmail: argv['supabase-email'] as string | undefined,
          supabasePassword: argv['supabase-password'] as string | undefined,
          supabaseUrl: argv['supabase-url'] as string | undefined,
          supabaseAnonKey: argv['supabase-anon-key'] as string | undefined,
        })
      },
    )
    .command(
      'logout',
      'Clear cached PowerSync credentials',
      (y) =>
        y
          .option('session', {
            type: 'string',
            describe: 'Legacy credential cache path',
          })
          .option('daemon-url', {
            type: 'string',
            describe: 'PowerSync daemon base URL',
          }),
      async (argv) => {
        await runLogoutCommand({
          session: argv.session as string | undefined,
          daemonUrl: argv['daemon-url'] as string | undefined,
        })
      },
    )
    .command(
      '$0',
      false,
      () => {},
      () => {
        printUsage()
        process.exit(0)
      },
    )
    .strict()
    .wrap(null)
    .showHelpOnFail(false)
    .help('help', false)
    .alias('h', 'help')
    .version(false)
    .fail((msg, err) => {
      if (err) throw err
      if (msg) {
        console.error(msg)
      }
      printUsage()
      process.exit(2)
    })
}

async function main() {
  await buildCli().parseAsync()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
