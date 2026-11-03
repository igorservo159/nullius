// The payments an account sent, kept in the phone's SQLite database from the moment they were
// signed, before they leave the phone.

import { getAddress, type Address, type Hex } from 'viem';
import type { Database } from '../database/database';
import type { Network } from '../network/network';
import type { SignedTransaction } from '../transactions/transactions';
import type { Payment, PaymentOutcome, RevertReason } from './chain';

/**
 * Where a sent payment stands; the same list as the CHECK on `sent_payments.status` in
 * `migrations.ts`. Until the receipt: signed and not yet answered by the node, rejected by it,
 * pending, lost, queued, or replaced by another transaction with its nonce. With the receipt:
 * what it said.
 */
export type SentPaymentStatus =
  | 'signed'
  | 'rejected'
  | 'pending'
  | 'lost'
  | 'queued'
  | 'replaced'
  | PaymentOutcome['status'];

/**
 * The statuses `resolveSentPayments` asks the node about again, because none is final: a lost
 * transaction may show up on another node, and a queued one executes once the gap is filled.
 */
const unresolvedStatuses = ['signed', 'pending', 'lost', 'queued'] as const;

/**
 * A sent payment as the list and its detail show it. `blockNumber`, `gasUsed` and
 * `effectiveGasPrice` are null until it is mined, and `revertReason` unless it reverted.
 * `finalized` says the proof of its block reached Ethereum.
 */
export type SentPayment = Payment & {
  hash: Hex;
  status: SentPaymentStatus;
  nonce: number;
  blockNumber: bigint | null;
  gasUsed: bigint | null;
  effectiveGasPrice: bigint | null;
  revertReason: RevertReason | null;
  finalized: boolean;
  sentAt: number;
};

// One row of `sent_payments` as SQLite hands it back, for the columns `listSentPayments` selects.
type SentPaymentRow = {
  hash: Hex;
  payer: Address;
  payee: Address;
  value_wei: string;
  salt: Hex;
  order_id: Hex;
  status: SentPaymentStatus;
  nonce: number;
  block_number: number | null;
  gas_used: number | null;
  effective_gas_price: number | null;
  revert_reason: RevertReason | null;
  finalized: number;
  sent_at: number;
};

/**
 * Keeps a payment just signed, as `signed`, with the hash and nonce its bytes carry. It runs
 * before the bytes are sent: a transaction the node may hold always has its row.
 */
export async function saveSignedPayment(
  db: Database,
  transaction: Pick<SignedTransaction, 'hash' | 'nonce'>,
  payment: Payment,
  network: Network,
  sentAt: number,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sent_payments
       (hash, chain_id, payments_address, payer, payee, value_wei, salt, order_id,
        status, block_number, sent_at, nonce)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'signed', NULL, ?, ?)`,
    [
      transaction.hash,
      network.chain.id,
      getAddress(network.paymentsAddress),
      getAddress(payment.payer),
      getAddress(payment.payee),
      String(payment.valueWei),
      payment.salt,
      payment.orderId,
      sentAt,
      transaction.nonce,
    ],
  );
}

/**
 * Writes a status that comes without a block: what the node answered when the signed bytes
 * reached it (`pending`, or `rejected` when it answered with an error), or what
 * `resolveSentPayments` found (`pending`, `lost`, `queued`, `replaced`). With no answer at all
 * the row stays `signed`, since the bytes may have arrived. A status with a block goes through
 * `settleSentPayment`.
 */
export async function setSentPaymentStatus(
  db: Database,
  hash: Hex,
  status: 'pending' | 'rejected' | 'lost' | 'queued' | 'replaced',
): Promise<void> {
  await db.runAsync(`UPDATE sent_payments SET status = ? WHERE hash = ?`, [status, hash]);
}

/**
 * Writes what the receipt of `hash` said: executed or reverted, in which block, the gas used and
 * its price, and for a reverted one the guard that fired.
 */
export async function settleSentPayment(
  db: Database,
  hash: Hex,
  outcome: PaymentOutcome,
): Promise<void> {
  await db.runAsync(
    `UPDATE sent_payments
     SET status = ?, block_number = ?, gas_used = ?, effective_gas_price = ?, revert_reason = ?
     WHERE hash = ?`,
    [
      outcome.status,
      Number(outcome.blockNumber),
      Number(outcome.gasUsed),
      Number(outcome.effectiveGasPrice),
      outcome.revertReason,
      hash,
    ],
  );
}

/** The payments `payer` sent on `network`, newest first. */
export async function listSentPayments(
  db: Database,
  payer: Address,
  network: Network,
): Promise<SentPayment[]> {
  const rows = await db.getAllAsync<SentPaymentRow>(
    `SELECT hash, payer, payee, value_wei, salt, order_id, status, nonce, block_number, gas_used,
            effective_gas_price, revert_reason, finalized, sent_at
     FROM sent_payments
     WHERE payer = ? AND chain_id = ? AND payments_address = ?
     ORDER BY sent_at DESC`,
    [getAddress(payer), network.chain.id, getAddress(network.paymentsAddress)],
  );
  return rows.map((row) => ({
    hash: row.hash,
    payer: row.payer,
    payee: row.payee,
    valueWei: BigInt(row.value_wei),
    salt: row.salt,
    orderId: row.order_id,
    status: row.status,
    nonce: row.nonce,
    blockNumber: row.block_number === null ? null : BigInt(row.block_number),
    gasUsed: row.gas_used === null ? null : BigInt(row.gas_used),
    effectiveGasPrice: row.effective_gas_price === null ? null : BigInt(row.effective_gas_price),
    revertReason: row.revert_reason,
    finalized: row.finalized === 1,
    sentAt: row.sent_at,
  }));
}

/** A row `resolveSentPayments` visits: its hash, what it says now, and its nonce. */
export type PaymentToResolve = { hash: Hex; status: SentPaymentStatus; nonce: number };

/**
 * The payments of `payer` on `network` the node must be asked about again: every one whose
 * status is not final.
 */
export async function listPaymentsToResolve(
  db: Database,
  payer: Address,
  network: Network,
): Promise<PaymentToResolve[]> {
  const statuses = unresolvedStatuses.map(() => '?').join(', ');
  return db.getAllAsync<PaymentToResolve>(
    `SELECT hash, status, nonce
     FROM sent_payments
     WHERE payer = ? AND chain_id = ? AND payments_address = ?
       AND status IN (${statuses})`,
    [getAddress(payer), network.chain.id, getAddress(network.paymentsAddress), ...unresolvedStatuses],
  );
}

/** Whether `payer` has, on `network`, a mined payment not yet marked finalized. */
export async function hasUnfinalizedPayments(
  db: Database,
  payer: Address,
  network: Network,
): Promise<boolean> {
  const rows = await db.getAllAsync<{ found: number }>(
    `SELECT 1 AS found
     FROM sent_payments
     WHERE payer = ? AND chain_id = ? AND payments_address = ?
       AND finalized = 0 AND block_number IS NOT NULL
     LIMIT 1`,
    [getAddress(payer), network.chain.id, getAddress(network.paymentsAddress)],
  );
  return rows.length > 0;
}

/**
 * Marks finalized every mined payment of `payer` on `network` whose block is at or below
 * `finalizedBlock`, whatever its outcome: the proof covers the block, not one transaction.
 */
export async function markFinalizedUpTo(
  db: Database,
  payer: Address,
  network: Network,
  finalizedBlock: bigint,
): Promise<void> {
  await db.runAsync(
    `UPDATE sent_payments SET finalized = 1
     WHERE payer = ? AND chain_id = ? AND payments_address = ?
       AND finalized = 0 AND block_number IS NOT NULL AND block_number <= ?`,
    [
      getAddress(payer),
      network.chain.id,
      getAddress(network.paymentsAddress),
      Number(finalizedBlock),
    ],
  );
}

/** The status kept under `hash`, or null when the register has no such payment. */
export async function statusOfSentPayment(
  db: Database,
  hash: Hex,
): Promise<SentPaymentStatus | null> {
  const [row] = await db.getAllAsync<{ status: SentPaymentStatus }>(
    `SELECT status FROM sent_payments WHERE hash = ?`,
    [hash],
  );
  return row?.status ?? null;
}

/**
 * Keeps a payment the register did not have, found in the contract's logs: it executed, so it
 * enters with its receipt. `sentAt` is when its block was made; when it was signed is known only
 * to the device that signed it. A hash already kept is left as it is, so two readings of the same
 * blocks at once cannot fail on each other.
 */
export async function saveFoundPayment(
  db: Database,
  transaction: Pick<SignedTransaction, 'hash' | 'nonce'>,
  payment: Payment,
  network: Network,
  sentAt: number,
  outcome: PaymentOutcome,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sent_payments
       (hash, chain_id, payments_address, payer, payee, value_wei, salt, order_id,
        status, block_number, sent_at, nonce, gas_used, effective_gas_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (hash) DO NOTHING`,
    [
      transaction.hash,
      network.chain.id,
      getAddress(network.paymentsAddress),
      getAddress(payment.payer),
      getAddress(payment.payee),
      String(payment.valueWei),
      payment.salt,
      payment.orderId,
      outcome.status,
      Number(outcome.blockNumber),
      sentAt,
      transaction.nonce,
      Number(outcome.gasUsed),
      Number(outcome.effectiveGasPrice),
    ],
  );
}
