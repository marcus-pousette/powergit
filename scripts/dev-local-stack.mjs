#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

const commands = [
  ['supabase', ['start'], { cwd: repoRoot }],
  ['supabase', ['functions', 'deploy'], { cwd: repoRoot }],
]

async function run() {
  for (const [cmd, args, options] of commands) {
    await new Promise((resolvePromise, rejectPromise) => {
      console.log(`→ ${cmd} ${args.join(' ')}`)
      const child = spawn(cmd, args, { stdio: 'inherit', ...options })
      child.on('close', (code) => {
        if (code === 0) resolvePromise()
        else rejectPromise(new Error(`${cmd} exited with code ${code}`))
      })
      child.on('error', rejectPromise)
    })
  }
}

run().catch((error) => {
  console.error('Local stack setup failed:', error)
  process.exit(1)
})

