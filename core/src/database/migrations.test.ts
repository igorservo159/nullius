import { beforeEach, expect, test } from 'vitest';
import type { Database } from './database';
import { memoryDatabase } from './memoryDatabase';
import { migrate, schemaVersion, steps } from './migrations';

async function version(db: Database): Promise<number> {
  const [row] = await db.getAllAsync<{ user_version: number }>('PRAGMA user_version', []);
  return row.user_version;
}

async function columns(db: Database, table: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`, []);
  return rows.map((row) => row.name);
}

let db: Database;

beforeEach(() => {
  db = memoryDatabase();
});

test('an empty database ends at the last version with every table', async () => {
  await migrate(db);
  expect(await version(db)).toBe(schemaVersion);
  expect(await columns(db, 'charges')).toEqual(
    expect.arrayContaining(['order_id', 'paid_hash', 'paid_block', 'paid_finalized']),
  );
  expect(await columns(db, 'account_cursors')).toContain('next_block');
  expect(await columns(db, 'bridge_transfers')).toEqual(
    expect.arrayContaining(['hash', 'direction', 'nonce', 'message_hash', 'message_nonce']),
  );
  expect(await columns(db, 'sent_payments')).toEqual(
    expect.arrayContaining([
      'hash',
      'nonce',
      'finalized',
      'gas_used',
      'effective_gas_price',
      'revert_reason',
    ]),
  );
});

test('running it again changes nothing', async () => {
  await migrate(db);
  await migrate(db);
  expect(await version(db)).toBe(schemaVersion);
});

// A phone at version 1 with a paid charge and one waiting: version 2 keeps both, unfinalized.
test('a database at version 1 keeps its charges, unfinalized, at version 2', async () => {
  await db.execAsync(steps[0]);
  await db.execAsync('PRAGMA user_version = 1');
  await db.execAsync(`INSERT INTO charges
    (order_id, chain_id, payments_address, payee, value_wei, salt, created_at,
     paid_hash, paid_block)
    VALUES ('0xc1', 59141, '0xp', '0xpayee', '1000', '0xs1', 10, '0xh1', 77),
           ('0xc2', 59141, '0xp', '0xpayee', '1000', '0xs2', 11, NULL, NULL)`);

  await migrate(db);

  expect(await version(db)).toBe(schemaVersion);
  expect(
    await db.getAllAsync('SELECT order_id, paid_finalized FROM charges ORDER BY order_id', []),
  ).toEqual([
    { order_id: '0xc1', paid_finalized: 0 },
    { order_id: '0xc2', paid_finalized: 0 },
  ]);
});

// The order id does not carry the network: the same charge kept on two contracts is two rows.
test('a charge is keyed by its order id on its network', async () => {
  await migrate(db);
  const insert = `INSERT INTO charges
    (order_id, chain_id, payments_address, payee, value_wei, salt, created_at)
    VALUES ('0xc1', ?, ?, '0xpayee', '1000', '0xs1', 10)`;
  await db.runAsync(insert, [59141, '0xsepolia']);
  await db.runAsync(insert, [59144, '0xlinea']);
  await expect(db.runAsync(insert, [59141, '0xsepolia'])).rejects.toThrow(/UNIQUE/);
  expect(await db.getAllAsync('SELECT chain_id FROM charges ORDER BY chain_id', [])).toEqual([
    { chain_id: 59141 },
    { chain_id: 59144 },
  ]);
});

// A file another build of the app wrote, with tables this one does not know.
test('a database at a version above this app is refused', async () => {
  await db.execAsync('PRAGMA user_version = 7');
  await expect(migrate(db)).rejects.toThrow(
    `the database is at version 7, newer than the ${schemaVersion} this app knows`,
  );
  expect(await version(db)).toBe(7);
});

// A table left under a name the step creates makes it fail halfway through its SQL: the rollback
// must leave the version and the tables as they were.
test('a step that fails leaves the database as it was before that step', async () => {
  await db.execAsync('CREATE TABLE account_cursors (address TEXT)');
  await expect(migrate(db)).rejects.toThrow(/account_cursors/);
  expect(await version(db)).toBe(0);
  expect(await columns(db, 'charges')).toEqual([]);
});
