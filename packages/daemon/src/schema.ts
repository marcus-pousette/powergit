import { Schema } from '@powersync/node';
import { RAW_TABLES_FOR_SCHEMA } from '@shared/core/powersync/raw-tables';

export const AppSchema = (() => {
  const schema = new Schema({});
  schema.withRawTables(RAW_TABLES_FOR_SCHEMA);
  return schema;
})();
