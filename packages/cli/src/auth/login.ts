import { extractJwtMetadata } from './token.js'
import { clearStoredCredentials, saveStoredCredentials, type StoredCredentials } from './session.js'

export interface LoginOptions {
  endpoint?: string
  token?: string
  sessionPath?: string
  verbose?: boolean
  supabaseEmail?: string
  supabasePassword?: string
  supabaseUrl?: string
  supabaseAnonKey?: string
}

export interface LoginResult {
  credentials: StoredCredentials
  source: 'manual' | 'supabase-password'
}

function inferSupabaseUrl(explicit?: string): string | undefined {
  if (explicit) return explicit
  return process.env.POWERSYNC_SUPABASE_URL ?? process.env.PSGIT_TEST_SUPABASE_URL ?? process.env.SUPABASE_URL
}

function inferSupabaseAnonKey(explicit?: string): string | undefined {
  if (explicit) return explicit
  return process.env.POWERSYNC_SUPABASE_ANON_KEY ?? process.env.PSGIT_TEST_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
}

function inferSupabaseEmail(explicit?: string): string | undefined {
  if (explicit) return explicit
  return process.env.POWERSYNC_SUPABASE_EMAIL ?? process.env.PSGIT_TEST_SUPABASE_EMAIL
}

function inferSupabasePassword(explicit?: string): string | undefined {
  if (explicit) return explicit
  return process.env.POWERSYNC_SUPABASE_PASSWORD ?? process.env.PSGIT_TEST_SUPABASE_PASSWORD
}

export async function loginWithExplicitToken(options: LoginOptions): Promise<LoginResult> {
  const endpoint = options.endpoint ?? process.env.POWERSYNC_ENDPOINT ?? process.env.PSGIT_TEST_ENDPOINT
  const token = options.token ?? process.env.POWERSYNC_TOKEN ?? process.env.PSGIT_TEST_REMOTE_TOKEN
  if (!endpoint || !token) {
    throw new Error('Endpoint and token are required. Provide --endpoint/--token or set POWERSYNC_ENDPOINT + POWERSYNC_TOKEN.')
  }

  const metadata = extractJwtMetadata(token)
  const credentials: StoredCredentials = {
    endpoint,
    token,
    expiresAt: metadata.expiresAt,
    obtainedAt: metadata.issuedAt ?? new Date().toISOString(),
  }
  await saveStoredCredentials(credentials, options.sessionPath)
  return { credentials, source: 'manual' }
}

export async function loginWithSupabasePassword(options: LoginOptions = {}): Promise<LoginResult> {
  const supabaseUrl = inferSupabaseUrl(options.supabaseUrl)
  const supabaseAnonKey = inferSupabaseAnonKey(options.supabaseAnonKey)
  const email = inferSupabaseEmail(options.supabaseEmail)
  const password = inferSupabasePassword(options.supabasePassword)
  const endpoint = options.endpoint ?? process.env.POWERSYNC_ENDPOINT ?? process.env.PSGIT_TEST_ENDPOINT

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL and anon key are required for Supabase login. Set POWERSYNC_SUPABASE_URL and POWERSYNC_SUPABASE_ANON_KEY.')
  }
  if (!email || !password) {
    throw new Error('Supabase email and password are required. Use --supabase-email/--supabase-password or set POWERSYNC_SUPABASE_EMAIL/POWERSYNC_SUPABASE_PASSWORD.')
  }
  if (!endpoint) {
    throw new Error('PowerSync endpoint is required. Set POWERSYNC_ENDPOINT or provide --endpoint.')
  }

  const tokenUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Supabase login failed (${response.status} ${response.statusText}) ${text}`)
  }

  const result = (await response.json().catch(() => ({}))) as { access_token?: string }
  const token = result?.access_token
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Supabase login response did not include an access_token.')
  }

  const metadata = extractJwtMetadata(token)
  const credentials: StoredCredentials = {
    endpoint,
    token,
    expiresAt: metadata.expiresAt,
    obtainedAt: metadata.issuedAt ?? new Date().toISOString(),
  }

  await saveStoredCredentials(credentials, options.sessionPath)
  return { credentials, source: 'supabase-password' }
}

export async function logout(options: { sessionPath?: string } = {}) {
  await clearStoredCredentials(options.sessionPath)
}
