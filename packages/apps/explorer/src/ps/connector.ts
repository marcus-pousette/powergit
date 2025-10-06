
import type { PowerSyncBackendConnector, PowerSyncCredentials, AbstractPowerSyncDatabase } from '@powersync/web'
import { getSupabaseClient, invokeSupabaseFunction } from './supabase'

interface SupabaseCredentialResponse {
  endpoint: string
  token: string
}

const DEFAULT_UPLOAD_FUNCTION = (import.meta.env.VITE_SUPABASE_POWERSYNC_UPLOAD_FN as string | undefined) ?? 'powersync-upload'
const DEFAULT_CREDENTIAL_FUNCTION = (import.meta.env.VITE_SUPABASE_POWERSYNC_CREDS_FN as string | undefined) ?? 'powersync-creds'

export class Connector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials> {
    const supabase = getSupabaseClient()
    if (supabase) {
      const credentials = await invokeSupabaseFunction<SupabaseCredentialResponse>(DEFAULT_CREDENTIAL_FUNCTION)
      return credentials
    }
    return {
      endpoint: import.meta.env.VITE_POWERSYNC_ENDPOINT || 'https://YOUR-POWERSYNC-ENDPOINT',
      token: import.meta.env.VITE_POWERSYNC_TOKEN || 'DEV_TOKEN_PLACEHOLDER',
    }
  }

  async uploadData(db: AbstractPowerSyncDatabase) {
    const supabase = getSupabaseClient()
    if (!supabase) return
    while (true) {
      const batch = await db.getCrudBatch().catch((error) => {
        console.warn('[PowerSync] failed to fetch CRUD batch for upload', error)
        return null
      })

      if (!batch) break

      const operations = batch.crud.map((entry) => entry.toJSON())

      if (operations.length === 0) {
        try {
          await batch.complete()
        } catch (error) {
          console.warn('[PowerSync] failed to acknowledge empty CRUD batch', error)
          throw error
        }
        if (!batch.haveMore) break
        continue
      }

      try {
        await invokeSupabaseFunction(DEFAULT_UPLOAD_FUNCTION, { operations })
        await batch.complete()
      } catch (error) {
        console.error('[PowerSync] failed to upload CRUD batch via Supabase', error)
        throw error
      }

      if (!batch.haveMore) break
    }
  }
}
