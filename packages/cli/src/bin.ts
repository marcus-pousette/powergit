#!/usr/bin/env node
import { addPowerSyncRemote, syncPowerSyncRepository, seedDemoRepository } from './index.js'
import {
  loginWithDaemonDevice,
  loginWithDaemonGuest,
  logout as logoutSession,
} from './auth/login.js'

interface LoginCliOptions {
  endpoint?: string
  token?: string
  sessionPath?: string
  mode: 'auto' | 'manual' | 'guest'
  supabaseEmail?: string
  supabasePassword?: string
  supabaseUrl?: string
  supabaseAnonKey?: string
  daemonUrl?: string
}

const [, , cmd, ...rest] = process.argv

async function main() {
  if (cmd === 'remote' && rest[0] === 'add' && rest[1] === 'powersync') {
    const url = rest[2]
    const name = process.env.REMOTE_NAME || 'origin'
    if (!url) {
      console.error('Usage: psgit remote add powersync powersync::https://<endpoint>/orgs/<org>/repos/<repo>')
      process.exit(2)
    }
    await addPowerSyncRemote(process.cwd(), name, url)
    console.log(`Added PowerSync remote (${name}):`, url)
  } else if (cmd === 'sync') {
    const { remoteName } = parseSyncArgs(rest)
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
  } else if (cmd === 'demo-seed') {
    const parsed = parseSeedArgs(rest)
    const result = await seedDemoRepository(parsed)
    console.log('✅ Seeded demo repository via PowerSync remote.')
    console.log(`   Remote: ${result.remoteUrl}`)
    console.log(`   Branch: ${result.branch}`)
    if (parsed.keepWorkingDir) {
      console.log(`   Temp repo kept at: ${result.workingDirectory}`)
    }
    if (!parsed.skipSync && result.syncedDatabase) {
      console.log(`   Local snapshot: ${result.syncedDatabase}`)
    }
  } else if (cmd === 'login') {
    await handleLogin(rest)
  } else if (cmd === 'logout') {
    await handleLogout(rest)
  } else {
    printUsage()
  }
}

function parseLoginArgs(args: string[]): LoginCliOptions {
  const options: LoginCliOptions = { mode: 'auto' }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    switch (arg) {
      case '--endpoint':
        options.endpoint = args[++i]
        break
      case '--token':
        options.token = args[++i]
        options.mode = 'manual'
        break
      case '--session':
        options.sessionPath = args[++i]
        break
      case '--daemon-url':
        options.daemonUrl = args[++i]
        break
      case '--supabase-email':
        options.supabaseEmail = args[++i]
        break
      case '--supabase-password':
        options.supabasePassword = args[++i]
        break
      case '--supabase-url':
        options.supabaseUrl = args[++i]
        break
      case '--supabase-anon-key':
        options.supabaseAnonKey = args[++i]
        break
      case '--guest':
        options.mode = 'guest'
        break
      case '--manual':
        options.mode = 'manual'
        break
      case '--auto':
        options.mode = 'auto'
        break
      case '--help':
      case '-h':
        printLoginUsage()
        process.exit(0)
        break
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option: ${arg}`)
          printLoginUsage()
          process.exit(2)
        }
        break
    }
  }

  if (options.mode === 'manual' && !options.token) {
    console.error('Manual login requires --token (and optionally --endpoint).')
    process.exit(2)
  }

  return options
}

async function handleLogin(args: string[]) {
  const options = parseLoginArgs(args)

  if (options.mode === 'manual') {
    if (!options.token) {
      console.error('Manual login requires --token.')
      process.exit(2)
    }
    const { baseUrl, status } = await loginWithDaemonGuest({
      daemonUrl: options.daemonUrl,
      endpoint: options.endpoint,
      token: options.token,
      metadata: { source: 'manual' },
    })
    if (!status) {
      throw new Error(`Daemon at ${baseUrl} did not return an auth status.`)
    }
    if (status.status !== 'ready') {
      throw new Error(
        `Daemon reported ${status.status} while processing manual token${
          status.reason ? ` (${status.reason})` : ''
        }.`,
      )
    }
    console.log('✅ PowerSync daemon accepted manual token.')
    console.log(`   Endpoint: ${options.endpoint ?? 'auto'}`)
    if (status.expiresAt) {
      console.log(`   Expires:  ${status.expiresAt}`)
    }
    return
  }

  if (options.mode === 'guest') {
    const { baseUrl, status } = await loginWithDaemonGuest({
      daemonUrl: options.daemonUrl,
      endpoint: options.endpoint,
      token: options.token,
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
    options.supabaseEmail ||
    options.supabasePassword ||
    options.supabaseUrl ||
    options.supabaseAnonKey
  ) {
    console.warn('[psgit] Supabase credential flags are no longer supported; routing login through daemon device flow.')
  }

  const loginResult = await loginWithDaemonDevice({
    daemonUrl: options.daemonUrl,
    endpoint: options.endpoint,
  })

  const explainChallenge = (prefix: string, challenge = loginResult.challenge) => {
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

async function handleLogout(args: string[]) {
  let sessionPath: string | undefined
  let daemonUrl: string | undefined
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--session') {
      sessionPath = args[++i]
    } else if (arg === '--daemon-url') {
      daemonUrl = args[++i]
    } else if (arg === '--help' || arg === '-h') {
      printLogoutUsage()
      process.exit(0)
    } else if (arg.startsWith('--')) {
      console.error(`Unknown option: ${arg}`)
      printLogoutUsage()
      process.exit(2)
    }
  }

  await logoutSession({ sessionPath, daemonUrl })
  console.log('✅ Cleared stored PowerSync credentials.')
}

function parseSyncArgs(args: string[]) {
  let remoteName = process.env.REMOTE_NAME || 'origin'
  let positionalConsumed = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--remote' || arg === '-r') {
      const next = args[++i]
      if (!next) {
        console.error('Missing value for --remote')
        process.exit(2)
      }
      remoteName = next
    } else if (arg.startsWith('--remote=')) {
      remoteName = arg.split('=', 2)[1] ?? remoteName
    } else if (!arg.startsWith('-') && !positionalConsumed) {
      remoteName = arg
      positionalConsumed = true
    } else {
      console.error(`Unknown option: ${arg}`)
      printUsage()
      process.exit(2)
    }
  }

  return { remoteName }
}

function parseSeedArgs(args: string[]) {
  const options: Parameters<typeof seedDemoRepository>[0] = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--remote-url':
      case '--url':
        options.remoteUrl = args[++i]
        break
      case '--remote':
      case '-r':
        options.remoteName = args[++i]
        break
      case '--branch':
        options.branch = args[++i]
        break
      case '--skip-sync':
        options.skipSync = true
        break
      case '--keep-repo':
        options.keepWorkingDir = true
        break
      case '--repo-dir':
        options.workingDir = args[++i]
        options.keepWorkingDir = true
        break
      case '--help':
      case '-h':
        printSeedUsage()
        process.exit(0)
        break
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option: ${arg}`)
          printSeedUsage()
          process.exit(2)
        }
        break
    }
  }

  return options
}

function printUsage() {
  console.log('psgit commands:')
  console.log('  psgit remote add powersync powersync::https://<endpoint>/orgs/<org>/repos/<repo>')
  console.log('  psgit sync [--remote <name>]')
  console.log('  psgit demo-seed [--remote-url <url>] [--remote <name>] [--branch <branch>] [--skip-sync] [--keep-repo]')
  console.log('  psgit login [--guest] [--manual --token <jwt>] [--endpoint <url>] [--daemon-url <url>]')
  console.log('  psgit logout [--daemon-url <url>]')
}

function printLoginUsage() {
  console.log('Usage: psgit login [options]')
  console.log('  --manual                 Provide an explicit PowerSync token via --token.')
  console.log('  --guest                  Request guest access via the daemon.')
  console.log('  --token <jwt>            PowerSync access token forwarded to the daemon (manual mode).')
  console.log('  --endpoint <url>         Override PowerSync endpoint hint for the daemon.')
  console.log('  --daemon-url <url>       Override daemon URL (default http://127.0.0.1:5030).')
  console.log('  --session <path>         Override legacy credential cache path (deprecated).')
  console.log('  --manual / --auto        Force manual or automatic (device) mode.')
}

function printLogoutUsage() {
  console.log('Usage: psgit logout [--session <path>] [--daemon-url <url>]')
}

function printSeedUsage() {
  console.log('Usage: psgit demo-seed [options]')
  console.log('  --remote-url <url>     Override remote URL (defaults to POWERSYNC_SEED_REMOTE_URL).')
  console.log('  --remote, -r <name>    Override remote name (defaults to powersync).')
  console.log('  --branch <branch>      Branch to push (default main).')
  console.log('  --skip-sync            Skip local PowerSync sync after push.')
  console.log('  --keep-repo            Keep the temporary Git repository on disk.')
  console.log('  --repo-dir <path>      Use an explicit working directory and keep it after completion.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
