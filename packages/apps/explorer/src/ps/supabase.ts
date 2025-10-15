import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

let cachedClient: SupabaseClient | null = null

function readEnv(name: string): string | null {
  const env = import.meta.env as Record<string, string | undefined>
  const value = env[name]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getInjectedSupabase(): SupabaseClient | null {
  const globalObj = globalThis as typeof globalThis & { __supabaseMock?: SupabaseClient }
  if (globalObj.__supabaseMock) {
    return globalObj.__supabaseMock
  }
  return null
}

export function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient

  const injected = getInjectedSupabase()
  if (injected) {
    cachedClient = injected
    return cachedClient
  }

  const url = readEnv('VITE_SUPABASE_URL')
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')
  if (!url || !anonKey) return null
  if (!cachedClient) {
    cachedClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  }
  return cachedClient
}

export async function getSession(): Promise<Session | null> {
  const client = getSupabase()
  if (!client) return null
  const { data, error } = await client.auth.getSession()
  if (error) {
    console.warn('[Explorer] failed to fetch Supabase session', error)
    return null
  }
  return data.session ?? null
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getSession()
  return session?.access_token ?? null
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user?.id ?? null
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const client = getSupabase()
  if (!client) throw new Error('Supabase is not configured for this environment.')
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signUpWithPassword(email: string, password: string): Promise<void> {
  const client = getSupabase()
  if (!client) throw new Error('Supabase is not configured for this environment.')
  const { error } = await client.auth.signUp({ email, password })
  if (error) throw error
}

export async function sendPasswordResetEmail(email: string): Promise<void> {
  const client = getSupabase()
  if (!client) throw new Error('Supabase is not configured for this environment.')
  const redirectTo = readEnv('VITE_SUPABASE_RESET_REDIRECT_URL') ?? undefined
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) throw error
}

export async function updateCurrentUserPassword(newPassword: string): Promise<void> {
  const client = getSupabase()
  if (!client) throw new Error('Supabase is not configured for this environment.')
  const { error } = await client.auth.updateUser({ password: newPassword })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  const client = getSupabase()
  if (!client) return
  const { error } = await client.auth.signOut()
  if (error) throw error
}

export async function signInAnonymously(): Promise<void> {
  const client = getSupabase()
  if (!client) throw new Error('Supabase is not configured for this environment.')
  const auth: unknown = (client as unknown as { auth?: unknown }).auth
  const signInFn = auth && typeof (auth as { signInAnonymously?: unknown }).signInAnonymously === 'function'
    ? (auth as { signInAnonymously: () => Promise<{ error: unknown }> }).signInAnonymously
    : null
  if (!signInFn) {
    const error = new Error('Anonymous sign-in is not enabled for this Supabase project.')
    ;(error as Error & { code?: string }).code = 'ANON_UNAVAILABLE'
    throw error
  }
  const { error } = await signInFn()
  if (error) throw error as Error
}

export function isSupabaseConfigured(): boolean {
  if (getInjectedSupabase()) return true
  return Boolean(readEnv('VITE_SUPABASE_URL') && readEnv('VITE_SUPABASE_ANON_KEY'))
}

export function isAnonymousSignInSupported(): boolean {
  const client = getSupabase()
  if (!client) return false
  const auth: unknown = (client as unknown as { auth?: unknown }).auth
  const signInFn = auth && typeof (auth as { signInAnonymously?: unknown }).signInAnonymously === 'function'
  return Boolean(signInFn)
}

declare global {
  interface Window {
    __supabaseMock?: SupabaseClient
  }

  // eslint-disable-next-line no-var
  var __supabaseMock: SupabaseClient | undefined
}

export {}
