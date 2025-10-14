import type { PowerSyncDatabase } from '@powersync/node';
import { RAW_TABLE_CREATE_STATEMENTS } from '@shared/core';

export async function ensureLocalSchema(database: PowerSyncDatabase): Promise<void> {
  await database.writeTransaction(async (tx) => {
    for (const statements of Object.values(RAW_TABLE_CREATE_STATEMENTS)) {
      for (const statement of statements) {
        await tx.execute(statement);
      }
    }
  });
}
