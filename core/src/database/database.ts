// The SQLite database as `core/` needs it, whichever engine is behind it.

/**
 * A value bound to a `?`: text, a number, or null for SQL's NULL.
 */
export type SqlValue = string | number | null;

/**
 * Three methods, shaped like expo-sqlite's `SQLiteDatabase`. `mobile/src/adapters.js` passes the
 * expo-sqlite one, and the tests pass `node:sqlite` behind the same three methods
 * (`memoryDatabase.ts`).
 */
export interface Database {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<unknown>;
  getAllAsync<Row>(source: string, params: SqlValue[]): Promise<Row[]>;
}
