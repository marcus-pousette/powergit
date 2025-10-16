import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CrudEntry, CrudTransaction } from '@powersync/common';
import type { AbstractPowerSyncDatabase, PowerSyncDatabase } from '@powersync/node';

export interface SupabaseWriterConfig {
  url: string;
  serviceRoleKey: string;
  schema?: string;
}

export interface SupabaseWriterOptions {
  database?: PowerSyncDatabase;
  config: SupabaseWriterConfig;
}

interface TableMetadata {
  table: string;
  conflictTarget: string;
}

const TABLES: Record<string, TableMetadata> = {
  refs: { table: 'raw_refs', conflictTarget: 'id' },
  commits: { table: 'raw_commits', conflictTarget: 'id' },
  file_changes: { table: 'raw_file_changes', conflictTarget: 'id' },
  objects: { table: 'raw_objects', conflictTarget: 'id' },
};

export class SupabaseWriter {
  private readonly database?: PowerSyncDatabase;
  private readonly supabase: SupabaseClient;

  constructor(options: SupabaseWriterOptions) {
    this.database = options.database;
    this.supabase = createClient(options.config.url, options.config.serviceRoleKey, {
      auth: { persistSession: false },
      db: { schema: options.config.schema ?? 'public' },
      global: {
        headers: {
          Authorization: `Bearer ${options.config.serviceRoleKey}`,
        },
      },
    }) as SupabaseClient;
  }

  async uploadPending(db?: AbstractPowerSyncDatabase): Promise<void> {
    const targetDb = (db as PowerSyncDatabase | undefined) ?? this.database;
    if (!targetDb) {
      throw new Error('SupabaseWriter requires a database instance');
    }

    while (true) {
      const tx = await targetDb.getNextCrudTransaction();
      if (!tx) break;

      try {
        await this.applyTransaction(tx);
        await tx.complete();
      } catch (error) {
        console.error('[powersync-daemon] supabase upload failed', error);
        throw error;
      }
    }
  }

  private async applyTransaction(tx: CrudTransaction): Promise<void> {
    if (!Array.isArray(tx.crud) || tx.crud.length === 0) {
      return;
    }

    const grouped = new Map<string, CrudEntry[]>();
    for (const entry of tx.crud) {
      if (!entry?.table) continue;
      const target = grouped.get(entry.table) ?? [];
      target.push(entry);
      grouped.set(entry.table, target);
    }

    for (const [tableName, entries] of grouped.entries()) {
      const metadata = TABLES[tableName];
      if (!metadata) {
        console.warn(`[powersync-daemon] skipping Supabase sync for unknown table ${tableName}`);
        continue;
      }

      const upserts = new Map<string, Record<string, unknown>>();
      const deletes = new Map<string, Record<string, unknown>>();

      for (const entry of entries) {
        const row = this.buildRow(entry);
        if (!row) continue;

        if (entry.op === 'DELETE') {
          deletes.set(String(row.id), row);
        } else {
          upserts.set(String(row.id), row);
        }
      }

      const upsertRows = Array.from(upserts.values());
      if (upsertRows.length > 0) {
        await this.applyUpserts(metadata.table, metadata.conflictTarget, upsertRows);
      }

      const deleteRows = Array.from(deletes.values());
      if (deleteRows.length > 0) {
        await this.applyDeletes(metadata.table, deleteRows);
      }
    }
  }

  private buildRow(entry: CrudEntry): Record<string, unknown> | null {
    const source =
      entry.op === 'DELETE'
        ? entry.previousValues ?? entry.opData
        : entry.opData ?? entry.previousValues;
    const base: Record<string, unknown> = source && typeof source === 'object' ? { ...source } : {};
    if (typeof base.id !== 'string' && entry.id) {
      base.id = entry.id;
    }
    if (typeof base.id !== 'string') return null;
    return base;
  }

  private async applyUpserts(table: string, conflictTarget: string, rows: Record<string, unknown>[]): Promise<void> {
    const sanitized = rows.map((row) => {
      const copy = { ...row };
      if (copy.created_at instanceof Date) {
        copy.created_at = (copy.created_at as Date).toISOString();
      }
      if (copy.updated_at instanceof Date) {
        copy.updated_at = (copy.updated_at as Date).toISOString();
      }
      return copy;
    });

    const { error } = await this.supabase.from(table).upsert(sanitized, { onConflict: conflictTarget });
    if (error) {
      throw new Error(`Supabase upsert failed for ${table}: ${error.message}`);
    }
  }

  private async applyDeletes(table: string, rows: Record<string, unknown>[]): Promise<void> {
    const ids = rows
      .map((row) => (typeof row.id === 'string' ? row.id : null))
      .filter((id): id is string => Boolean(id));

    if (ids.length === 0) {
      return;
    }

    const { error } = await this.supabase
      .from(table)
      .delete()
      .in('id', ids);
    if (error) {
      throw new Error(`Supabase delete failed for ${table}: ${error.message}`);
    }
  }
}
