import type { PowerSyncDatabase } from '@powersync/node';
import { RAW_TABLE_SPECS } from '@shared/core/powersync/raw-tables';

type RawRow = Record<string, unknown>;

function firstRowFromResult(result: unknown): RawRow | null {
  const rows = (result as { rows?: unknown })?.rows;
  if (!rows) return null;
  if (typeof (rows as { item?: unknown }).item === 'function') {
    return ((rows as { item: (index: number) => RawRow }).item(0)) ?? null;
  }
  if (Array.isArray(rows)) {
    return (rows as RawRow[])[0] ?? null;
  }
  return null;
}

function parseCountRow(row: RawRow | null): number {
  if (!row) return 0;
  const candidates = ['count', 'COUNT'];
  for (const key of candidates) {
    const value = row[key];
    if (value !== undefined) {
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    }
  }
  const [fallback] = Object.values(row);
  const num = Number(fallback);
  return Number.isFinite(num) ? num : 0;
}

export async function ensureRawTables(database: PowerSyncDatabase, options: { verbose?: boolean } = {}): Promise<void> {
  await database.writeTransaction(async (tx) => {
    try {
      await tx.execute('SELECT powersync_disable_drop_view()');
    } catch (error) {
      if (options.verbose) {
        console.warn('[powersync-daemon] raw table migration: disable hook not available', error);
      }
    }

    const untypedCheck = await tx.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ps_untyped' LIMIT 1",
    );
    const hasUntyped = firstRowFromResult(untypedCheck) !== null;
    if (!hasUntyped && options.verbose) {
      console.debug('[powersync-daemon] raw table migration: ps_untyped table not found; continuing without data copy');
    }

    const entries = Object.entries(RAW_TABLE_SPECS) as Array<
      [keyof typeof RAW_TABLE_SPECS, (typeof RAW_TABLE_SPECS)[keyof typeof RAW_TABLE_SPECS]]
    >;

    for (const [type, spec] of entries) {
      const columnNames = spec.put.params
        .map((param) => {
          if (param && typeof param === 'object' && 'Column' in param) {
            return param.Column;
          }
          return null;
        })
        .filter((column): column is string => typeof column === 'string' && column.length > 0);

      if (columnNames.length === 0) continue;

      const existingEntity = await tx.execute(
        'SELECT type FROM sqlite_master WHERE name = ? LIMIT 1',
        [spec.tableName],
      );
      const existingType = firstRowFromResult(existingEntity)?.type;
      if (existingType === 'view') {
        let dropped = false;
        try {
          await tx.execute('SELECT powersync_drop_view(?)', [spec.tableName]);
          dropped = true;
        } catch {
          // fall back to raw DROP VIEW if helper not available
        }
        if (!dropped) {
          await tx.execute(`DROP VIEW IF EXISTS ${spec.tableName}`);
        }
        if (options.verbose) {
          console.debug('[powersync-daemon] raw table migration dropped stale view', { table: spec.tableName });
        }
      }

      let prepared = true;
      for (const statement of spec.createStatements) {
        try {
          await tx.execute(statement);
        } catch (createError) {
          prepared = false;
          console.warn('[powersync-daemon] raw table migration could not ensure table', {
            table: spec.tableName,
            error: createError,
          });
          break;
        }
      }
      if (!prepared) continue;

      let count = 0;
      if (hasUntyped) {
        const countResult = await tx.execute('SELECT COUNT(*) AS count FROM ps_untyped WHERE type = ?', [type]);
        count = parseCountRow(firstRowFromResult(countResult));
        if (!Number.isFinite(count) || count <= 0) {
          continue;
        }
      } else {
        continue;
      }

      const selectExpressions = columnNames.map((column) => `json_extract(data, '$.${column}')`).join(', ');
      const insertSql = `
        INSERT INTO ${spec.tableName} (id, ${columnNames.join(', ')})
        SELECT id, ${selectExpressions}
        FROM ps_untyped
        WHERE type = ?
        ON CONFLICT(id) DO NOTHING
      `;

      try {
        await tx.execute(insertSql, [type]);
        await tx.execute('DELETE FROM ps_untyped WHERE type = ?', [type]);
        if (options.verbose) {
          console.debug('[powersync-daemon] migrated raw table rows', { table: spec.tableName, count });
        }
      } catch (tableError) {
        console.warn('[powersync-daemon] raw table migration failed for table', {
          table: spec.tableName,
          type,
          error: tableError,
        });
      }
    }
  });
}
