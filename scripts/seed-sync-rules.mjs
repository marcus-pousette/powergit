#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import YAML from 'yaml'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')
const yamlPath = resolve(repoRoot, 'supabase', 'powersync', 'config.yaml')

const defaultDbPort = process.env.SUPABASE_DB_PORT || '55432'
const defaultDbUrl = `postgres://postgres:postgres@127.0.0.1:${defaultDbPort}/postgres`

const supabaseDbUrl =
  process.env.POWERSYNC_DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.SUPABASE_DB_CONNECTION_STRING ||
  process.env.DATABASE_URL ||
  defaultDbUrl

const { Client } = require('pg')

async function fileExists(path) {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

function transformRule(rule, index) {
  const stream = rule?.stream
  if (!stream || typeof stream !== 'string') {
    throw new Error(`sync_rules[${index}].stream must be a non-empty string`)
  }

  const tableName =
    typeof rule?.table === 'string'
      ? rule.table
      : typeof rule?.source?.table === 'string'
        ? rule.source.table
        : null

  if (!tableName) {
    throw new Error(`sync_rules[${index}] must specify a table (table or source.table)`)
  }

  const ruleConfig = rule?.rule && typeof rule.rule === 'object' ? { ...rule.rule } : {}

  if (rule.filter && typeof rule.filter === 'object') {
    ruleConfig.filter = rule.filter
  }

  if (ruleConfig.filter == null) {
    throw new Error(`sync_rules[${index}] must specify a filter (filter or rule.filter)`)
  }

  return {
    stream,
    tableName,
    rule: JSON.stringify(ruleConfig),
  }
}

async function loadYamlRules() {
  if (!(await fileExists(yamlPath))) {
    throw new Error(`Missing PowerSync config at ${yamlPath}`)
  }

  const yamlContents = await fs.readFile(yamlPath, 'utf8')
  const parsed = YAML.parse(yamlContents)

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('PowerSync config is empty or invalid YAML')
  }

  const rules = parsed.sync_rules

  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error('PowerSync config must define at least one sync rule under sync_rules')
  }

  return rules.map(transformRule)
}

async function run() {
  const rules = await loadYamlRules()
  const client = new Client({ connectionString: supabaseDbUrl })
  await client.connect()

  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS powersync')
    await client.query(`
      CREATE TABLE IF NOT EXISTS powersync.streams (
        stream text PRIMARY KEY,
        table_name text NOT NULL,
        rule jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    await client.query('BEGIN')

    for (const { stream, tableName, rule } of rules) {
      await client.query(
        `insert into powersync.streams (stream, table_name, rule)
         values ($1, $2, $3)
         on conflict (stream) do update set
           table_name = excluded.table_name,
           rule = excluded.rule,
           updated_at = now()`,
        [stream, tableName, rule],
      )
    }

    await client.query('COMMIT')
    console.log(`✅ PowerSync stream definitions applied from ${yamlPath}.`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

run().catch((error) => {
  console.error('❌ Failed to seed PowerSync streams:', error)
  process.exit(1)
})
