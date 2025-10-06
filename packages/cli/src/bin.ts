#!/usr/bin/env node
import { addPowerSyncRemote, syncPowerSyncRepository } from './index.js'

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
    const { remoteName, dbPath } = parseSyncArgs(rest)
    const result = await syncPowerSyncRepository(process.cwd(), {
      remoteName,
      dbPath,
    })
    console.log(`Synced PowerSync repo ${result.org}/${result.repo}`)
    console.log(`  Endpoint: ${result.endpoint}`)
    console.log(`  Database: ${result.databasePath}`)
    console.log(
      `  Rows: ${result.counts.refs} refs, ${result.counts.commits} commits, ${result.counts.file_changes} file changes`,
    )
  } else {
    printUsage()
  }
}

function parseSyncArgs(args: string[]) {
  let remoteName = process.env.REMOTE_NAME || 'origin'
  let dbPath: string | undefined
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
    } else if (arg === '--db' || arg === '--database') {
      const next = args[++i]
      if (!next) {
        console.error('Missing value for --db')
        process.exit(2)
      }
      dbPath = next
    } else if (arg.startsWith('--db=')) {
      dbPath = arg.split('=', 2)[1]
    } else if (!arg.startsWith('-') && !positionalConsumed) {
      remoteName = arg
      positionalConsumed = true
    } else {
      console.error(`Unknown option: ${arg}`)
      printUsage()
      process.exit(2)
    }
  }

  return { remoteName, dbPath }
}

function printUsage() {
  console.log('psgit commands:')
  console.log('  psgit remote add powersync powersync::https://<endpoint>/orgs/<org>/repos/<repo>')
  console.log('  psgit sync [--remote <name>] [--db <path>]')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
