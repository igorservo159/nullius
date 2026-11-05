// The schema of the phone's database, as an ordered list of steps; `PRAGMA user_version`, a
// number kept in the database file itself, says how many of them already ran there.

import type { Database } from './database';

/**
 * Each step takes the database from one version to the next: step `i` (counting from 0) brings
 * it to version `i + 1`. A step a phone may already have run is never edited; a change to the
 * schema is a new step at the end. Exported for the tests that build a database at an older
 * version.
 */
export const steps: string[] = [
  // Version 1, the four tables.
  //
  // Every amount in wei is TEXT, in decimal: SQLite's INTEGER holds 64 signed bits, which in wei
  // stops at about 9.22 ETH. Block numbers, nonces, gas and gas prices are INTEGER: they fit in
  // 64 bits, and in the 2^53 a JavaScript number holds exactly, with room to spare. Every row
  // carries its chain, and the tables of the app's contract its contract too, so a list shows
  // only the network in use. A CHECK on a status makes a misspelt one fail at the write instead
  // of being kept; SQLite has no boolean, so `finalized` is 0 or 1.
  //
  // `charges`: the charges a payee generated, or rebuilt from the chain once paid. Its key is the
  // order id on its network: the order id alone does not carry the network. `paid_hash` and
  // `paid_block` are null while it waits, and the CHECK keeps the two together.
  //
  // `sent_payments`: the payments an account sent, kept from the moment they were signed. Its key
  // is the transaction's hash, so two payments of one order id are two rows. `queued` is deduced,
  // not seen: no receipt, and a nonce above the account's count of mined transactions.
  // `revert_reason` is the guard that fired, or `unknown` when the node could not say; only a
  // reverted row has one, and only a row with a block can be finalized.
  //
  // `account_cursors`: where the search for `Payment` logs stands for each account on each
  // network. `next_block` is the first block not read yet.
  //
  // `bridge_transfers`: the transfers of ETH between the L1 and Linea, both ways. `hash` and
  // `nonce` are the transaction's on the layer it leaves from: the L1 for a deposit, Linea for a
  // withdrawal. Up to `replaced` the statuses are the sent payments' ones, with `pending` before
  // its block and `sent` once mined with its message; `claimable` and `claimed` say where the
  // message stands on the other side. `message_hash` and `message_nonce`, read from the
  // `MessageSent` once the transaction is in a block, are what a claim on the other side names.
  // `chain_id` is Linea's: the L1 follows from it, and no contract of the app is involved.
  `
  CREATE TABLE charges (
    order_id         TEXT NOT NULL,
    chain_id         INTEGER NOT NULL,
    payments_address TEXT NOT NULL,
    payee            TEXT NOT NULL,
    value_wei        TEXT NOT NULL,
    salt             TEXT NOT NULL,
    created_at       INTEGER NOT NULL,
    paid_hash        TEXT,
    paid_block       INTEGER,
    PRIMARY KEY (order_id, chain_id, payments_address),
    CHECK ((paid_hash IS NULL) = (paid_block IS NULL))
  );
  CREATE TABLE sent_payments (
    hash                TEXT PRIMARY KEY,
    chain_id            INTEGER NOT NULL,
    payments_address    TEXT NOT NULL,
    payer               TEXT NOT NULL,
    payee               TEXT NOT NULL,
    value_wei           TEXT NOT NULL,
    salt                TEXT NOT NULL,
    order_id            TEXT NOT NULL,
    nonce               INTEGER NOT NULL,
    status              TEXT NOT NULL CHECK (status IN (
                          'signed', 'rejected', 'pending', 'lost', 'queued', 'replaced',
                          'success', 'reverted')),
    block_number        INTEGER,
    gas_used            INTEGER,
    effective_gas_price INTEGER,
    revert_reason       TEXT CHECK (revert_reason IS NULL OR status = 'reverted'),
    finalized           INTEGER NOT NULL DEFAULT 0 CHECK (finalized IN (0, 1)),
    sent_at             INTEGER NOT NULL,
    CHECK (finalized = 0 OR block_number IS NOT NULL)
  );
  CREATE TABLE account_cursors (
    address          TEXT NOT NULL,
    chain_id         INTEGER NOT NULL,
    payments_address TEXT NOT NULL,
    next_block       INTEGER NOT NULL,
    PRIMARY KEY (address, chain_id, payments_address)
  );
  CREATE TABLE bridge_transfers (
    hash          TEXT PRIMARY KEY,
    direction     TEXT NOT NULL CHECK (direction IN ('deposit', 'withdrawal')),
    chain_id      INTEGER NOT NULL,
    account       TEXT NOT NULL,
    value_wei     TEXT NOT NULL,
    fee_wei       TEXT NOT NULL,
    nonce         INTEGER NOT NULL,
    status        TEXT NOT NULL CHECK (status IN (
                    'signed', 'rejected', 'pending', 'sent', 'lost', 'queued', 'replaced',
                    'reverted', 'claimable', 'claimed')),
    block_number  INTEGER,
    message_hash  TEXT,
    message_nonce INTEGER,
    sent_at       INTEGER NOT NULL
  );
  `,

  // Version 2, finalization on the payee's side. `paid_finalized` says Payments holds the
  // charge's order id as paid in the state of a finalized block, 0 or 1 as `finalized` in
  // `sent_payments`; only a paid charge can be finalized. A charge kept before this version
  // starts at 0, and the next reading asks about it.
  `
  ALTER TABLE charges ADD COLUMN paid_finalized INTEGER NOT NULL DEFAULT 0
    CHECK (paid_finalized IN (0, 1) AND (paid_finalized = 0 OR paid_block IS NOT NULL));
  `,
];

/** The version `migrate` leaves the database at: one per step. */
export const schemaVersion = steps.length;

/**
 * Runs the steps the database has not run yet, each in its own transaction together with the
 * new `user_version`. An app closed in the middle of a step leaves the file as it was before
 * that step, and the next opening runs it whole again.
 *
 * A database at a version above `schemaVersion` was written by another build of the app, with
 * tables this one does not know: it is refused instead of being read as if they were its own.
 *
 * A step that fails is rolled back and its error goes up. A failure to roll back is dropped:
 * SQLite ends the transaction by itself on some errors, and then `ROLLBACK` only says there is
 * no transaction; the step's error is the one to report.
 */
export async function migrate(db: Database): Promise<void> {
  const [{ user_version: version }] = await db.getAllAsync<{ user_version: number }>(
    'PRAGMA user_version',
    [],
  );
  if (version > steps.length) {
    throw new Error(
      `the database is at version ${version}, newer than the ${steps.length} this app knows`,
    );
  }
  for (let step = version; step < steps.length; step++) {
    await db.execAsync('BEGIN');
    try {
      await db.execAsync(steps[step]);
      await db.execAsync(`PRAGMA user_version = ${step + 1}`);
      await db.execAsync('COMMIT');
    } catch (error) {
      await db.execAsync('ROLLBACK').catch(() => {});
      throw error;
    }
  }
}
