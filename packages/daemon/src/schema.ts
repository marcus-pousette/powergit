import { Schema, Table, column } from '@powersync/node';
import { buildPowerSyncSchema, RAW_TABLES_FOR_SCHEMA } from '@shared/core';

const { schema } = buildPowerSyncSchema<Schema, Table<any>, Pick<typeof column, 'text' | 'integer'>>({
  createSchema: (tableMap) => new Schema(tableMap as Record<string, Table<any>>),
  createTable: (columns, options) => new Table(columns, options),
  column: {
    text: column.text,
    integer: column.integer,
  },
});

schema.withRawTables(RAW_TABLES_FOR_SCHEMA);

export const AppSchema = schema;
