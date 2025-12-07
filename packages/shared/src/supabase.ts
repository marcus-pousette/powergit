import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseServerConfig {
  url?: string
  serviceRoleKey?: string
  schema?: string
}

let cachedServerClient: SupabaseClient | null = null

export function getServerSupabaseClient(config?: SupabaseServerConfig): SupabaseClient | null {
  if (cachedServerClient && !config) return cachedServerClient
  const url = config?.url ?? process.env.SUPABASE_URL
  const key = config?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  cachedServerClient = createClient(url, key, {
    db: { schema: config?.schema ?? process.env.SUPABASE_DB_SCHEMA ?? 'public' },
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${key}` } },
  }) as SupabaseClient
  return cachedServerClient
}
