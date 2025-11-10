#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [, , ...cliArgs] = process.argv
if (cliArgs.length === 0) {
  console.error('[run-with-local-env] Missing command to execute. Usage: node run-with-local-env.mjs <cmd> [args...]')
  process.exit(1)
}

const envPath = resolve(process.cwd(), '.env.local')
if (existsSync(envPath)) {
  try {
    const content = readFileSync(envPath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      const key = trimmed.slice(0, idx).trim()
      if (!key) continue
      let value = trimmed.slice(idx + 1)
      value = value.trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) {
        process.env[key] = value
      }
    }
  } catch (error) {
    console.warn('[run-with-local-env] Failed to load .env.local:', error.message ?? error)
  }
}

const [command, ...args] = cliArgs
const child = spawn(command, args, { stdio: 'inherit', env: process.env })
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
  } else {
    process.exit(code ?? 0)
  }
})
child.on('error', (error) => {
  console.error('[run-with-local-env] Failed to launch', command, error)
  process.exit(1)
})
