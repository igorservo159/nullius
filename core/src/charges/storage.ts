// The charges a payee generated, kept in the phone's SQLite database.

import { getAddress, type Address, type Hex } from 'viem';
import type { Database } from '../database/database';
import type { Network } from '../network/network';
import type { Charge } from './rules';

/**
 * A charge as the list shows it: the four fields, when it was generated, and, once paid, the
 * transaction that paid it and its block. Both are null while it waits. `paidFinalized` says
 * Payments holds it as paid in the state of a finalized block.
 */
export type StoredCharge = Charge & {
  createdAt: number;
  paidHash: Hex | null;
  paidBlock: bigint | null;
  paidFinalized: boolean;
};

// One row of `charges` as SQLite hands it back, for the columns `listCharges` selects.
type ChargeRow = {
  order_id: Hex;
  payee: Address;
  value_wei: string;
  salt: Hex;
  created_at: number;
  paid_hash: Hex | null;
  paid_block: number | null;
  paid_finalized: number;
};

/**
 * Keeps a charge just generated for `network`. Addresses are written checksummed by
 * `getAddress`, and `listCharges` asks with the same form, so a lowercase address typed in the
 * network tab and a checksummed one find the same rows.
 */
export async function saveCharge(
  db: Database,
  charge: Charge,
  network: Network,
  createdAt: number,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO charges
       (order_id, chain_id, payments_address, payee, value_wei, salt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      charge.orderId,
      network.chain.id,
      getAddress(network.paymentsAddress),
      getAddress(charge.payee),
      String(charge.valueWei),
      charge.salt,
      createdAt,
    ],
  );
}

/** The charges `payee` generated on `network`, newest first. */
export async function listCharges(
  db: Database,
  payee: Address,
  network: Network,
): Promise<StoredCharge[]> {
  const rows = await db.getAllAsync<ChargeRow>(
    `SELECT order_id, payee, value_wei, salt, created_at, paid_hash, paid_block, paid_finalized
     FROM charges
     WHERE payee = ? AND chain_id = ? AND payments_address = ?
     ORDER BY created_at DESC`,
    [getAddress(payee), network.chain.id, getAddress(network.paymentsAddress)],
  );
  return rows.map((row) => ({
    payee: row.payee,
    valueWei: BigInt(row.value_wei),
    salt: row.salt,
    orderId: row.order_id,
    createdAt: row.created_at,
    paidHash: row.paid_hash,
    paidBlock: row.paid_block === null ? null : BigInt(row.paid_block),
    paidFinalized: row.paid_finalized === 1,
  }));
}

/**
 * Whether the charge with `orderId` on `network` is kept, and if so the transaction that paid it,
 * null while it waits; null when the phone has no such charge.
 */
export async function findCharge(
  db: Database,
  network: Network,
  orderId: Hex,
): Promise<{ paidHash: Hex | null } | null> {
  const [row] = await db.getAllAsync<{ paid_hash: Hex | null }>(
    `SELECT paid_hash FROM charges
     WHERE order_id = ? AND chain_id = ? AND payments_address = ?`,
    [orderId, network.chain.id, getAddress(network.paymentsAddress)],
  );
  return row === undefined ? null : { paidHash: row.paid_hash };
}

/**
 * Keeps a paid charge the phone did not have, rebuilt from the payment that paid it: one made on
 * another device, or lost with the app's data. `createdAt` is when it was paid; when it was
 * generated never reached the chain. A charge already kept is left as it is.
 */
export async function saveRecoveredCharge(
  db: Database,
  charge: Charge,
  network: Network,
  createdAt: number,
  paidHash: Hex,
  paidBlock: bigint,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO charges
       (order_id, chain_id, payments_address, payee, value_wei, salt, created_at,
        paid_hash, paid_block)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (order_id, chain_id, payments_address) DO NOTHING`,
    [
      charge.orderId,
      network.chain.id,
      getAddress(network.paymentsAddress),
      getAddress(charge.payee),
      String(charge.valueWei),
      charge.salt,
      createdAt,
      paidHash,
      Number(paidBlock),
    ],
  );
}

/**
 * Marks paid the charge with `orderId` on `network`, by the transaction `hash` in block
 * `blockNumber`. An order id that is not one of this phone's charges changes nothing, and a
 * charge already marked keeps its first mark, so reading the same blocks again writes nothing.
 */
export async function markChargePaid(
  db: Database,
  network: Network,
  orderId: Hex,
  hash: Hex,
  blockNumber: bigint,
): Promise<void> {
  await db.runAsync(
    `UPDATE charges SET paid_hash = ?, paid_block = ?
     WHERE order_id = ? AND chain_id = ? AND payments_address = ? AND paid_hash IS NULL`,
    [
      hash,
      Number(blockNumber),
      orderId,
      network.chain.id,
      getAddress(network.paymentsAddress),
    ],
  );
}

/** Whether `payee` has, on `network`, a paid charge not yet marked finalized. */
export async function hasUnfinalizedCharges(
  db: Database,
  payee: Address,
  network: Network,
): Promise<boolean> {
  const rows = await db.getAllAsync<{ found: number }>(
    `SELECT 1 AS found
     FROM charges
     WHERE payee = ? AND chain_id = ? AND payments_address = ?
       AND paid_finalized = 0 AND paid_block IS NOT NULL
     LIMIT 1`,
    [getAddress(payee), network.chain.id, getAddress(network.paymentsAddress)],
  );
  return rows.length > 0;
}

/**
 * The order ids of the paid charges of `payee` on `network`, not marked finalized yet, whose
 * paying block is at or below `finalizedBlock`: the ones Payments is asked about.
 */
export async function listPaidUpTo(
  db: Database,
  payee: Address,
  network: Network,
  finalizedBlock: bigint,
): Promise<Hex[]> {
  const rows = await db.getAllAsync<{ order_id: Hex }>(
    `SELECT order_id FROM charges
     WHERE payee = ? AND chain_id = ? AND payments_address = ?
       AND paid_finalized = 0 AND paid_block <= ?`,
    [
      getAddress(payee),
      network.chain.id,
      getAddress(network.paymentsAddress),
      Number(finalizedBlock),
    ],
  );
  return rows.map((row) => row.order_id);
}

/** Marks finalized the charge with `orderId` on `network`. */
export async function markChargeFinalized(
  db: Database,
  network: Network,
  orderId: Hex,
): Promise<void> {
  await db.runAsync(
    `UPDATE charges SET paid_finalized = 1
     WHERE order_id = ? AND chain_id = ? AND payments_address = ?`,
    [orderId, network.chain.id, getAddress(network.paymentsAddress)],
  );
}
