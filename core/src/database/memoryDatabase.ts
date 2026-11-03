// A `Database` for the tests: `node:sqlite` in memory, behind the three methods. Not exported
// from the package; the phone uses expo-sqlite.

import { DatabaseSync } from 'node:sqlite';
import type { Database, SqlValue } from './database';

/**
 * A new, empty database on every call, so no test sees what another wrote. `node:sqlite` is
 * synchronous; `async` is what turns each result into the `Promise` expo-sqlite would return.
 */
export function memoryDatabase(): Database {
  const db = new DatabaseSync(':memory:');
  return {
    async execAsync(source) {
      db.exec(source);
    },
    async runAsync(source, params) {
      return db.prepare(source).run(...params);
    },
    async getAllAsync<Row>(source: string, params: SqlValue[]) {
      return db.prepare(source).all(...params) as Row[];
    },
  };
}
