import type { PowerSyncBackendConnector, PowerSyncCredentials, AbstractPowerSyncDatabase } from '@powersync/web'

export class Connector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials> {
    return {
      endpoint: import.meta.env.VITE_POWERSYNC_ENDPOINT || 'https://YOUR-POWERSYNC-ENDPOINT',
      token: import.meta.env.VITE_POWERSYNC_TOKEN || 'DEV_TOKEN_PLACEHOLDER',
    }
  }

  async uploadData(db: AbstractPowerSyncDatabase) {
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

      throw new Error(
        'PowerSync explorer attempted to upload CRUD operations, but no upload handler is configured. Local mutations are not supported without a daemon-managed writer.',
      )
    }
  }
}
