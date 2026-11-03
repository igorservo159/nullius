// The charges a payee generated, kept in the phone's SQLite database.

import { getAddress, type Address, type Hex } from 'viem';
import type { Database } from '../database/database';
import type { Network } from '../network/network';
import type { Charge } from './rules';

/**
 * A charge as the list shows it: the four fields, when it was generated, and, once paid, the
 * transaction that paid it and its block. Both are null while it waits.
 */
export type StoredCharge = Charge & {
  createdAt: number;
  paidHash: Hex | null;
  paidBlock: bigint | null;
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
    `SELECT order_id, payee, value_wei, salt, created_at, paid_hash, paid_block FROM charges
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
