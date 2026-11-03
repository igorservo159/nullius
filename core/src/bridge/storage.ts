// The transfers of ETH between the L1 and Linea an account made from this phone, kept from the
// moment they were signed, before they leave.

import { getAddress, type Address, type Hex } from 'viem';
import type { Database } from '../database/database';
import type { Network } from '../network/network';
import type { SignedTransaction } from '../transactions/transactions';

/** Which way a transfer goes: a deposit leaves the L1 for Linea, a withdrawal leaves Linea. */
export type TransferDirection = 'deposit' | 'withdrawal';

/** Where a transfer stands; the same list as the CHECK on `bridge_transfers.status`. */
export type TransferStatus =
  | 'signed'
  | 'rejected'
  | 'pending'
  | 'sent'
  | 'lost'
  | 'queued'
  | 'replaced'
  | 'reverted'
  | 'claimable'
  | 'claimed';

/**
 * The statuses a later look can still change: on the origin layer up to `queued`, on the other
 * side `claimable`. The others are final.
 */
const unresolvedTransferStatuses = [
  'signed',
  'pending',
  'sent',
  'lost',
  'queued',
  'claimable',
] as const;

/** A transfer as the bridge tab lists it. The message fields are null until its block is in. */
export type Transfer = {
  hash: Hex;
  direction: TransferDirection;
  account: Address;
  valueWei: bigint;
  feeWei: bigint;
  nonce: number;
  status: TransferStatus;
  blockNumber: bigint | null;
  messageHash: Hex | null;
  messageNonce: bigint | null;
  sentAt: number;
};

// One row of `bridge_transfers` as SQLite hands it back.
type TransferRow = {
  hash: Hex;
  direction: TransferDirection;
  account: Address;
  value_wei: string;
  fee_wei: string;
  nonce: number;
  status: TransferStatus;
  block_number: number | null;
  message_hash: Hex | null;
  message_nonce: number | null;
  sent_at: number;
};

/**
 * Keeps a transfer just signed, as `signed`, with the hash and nonce its bytes carry. It runs
 * before the bytes are sent: a transfer a node may hold always has its row.
 */
export async function saveSignedTransfer(
  db: Database,
  transaction: Pick<SignedTransaction, 'hash' | 'nonce'>,
  transfer: { direction: TransferDirection; account: Address; valueWei: bigint; feeWei: bigint },
  network: Network,
  sentAt: number,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO bridge_transfers
       (hash, direction, chain_id, account, value_wei, fee_wei, nonce, status, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', ?)`,
    [
      transaction.hash,
      transfer.direction,
      network.chain.id,
      getAddress(transfer.account),
      String(transfer.valueWei),
      String(transfer.feeWei),
      transaction.nonce,
      sentAt,
    ],
  );
}

/** Writes a status that comes without the message: what the node or the resolution said. */
export async function setTransferStatus(
  db: Database,
  hash: Hex,
  status: Exclude<TransferStatus, 'signed'>,
): Promise<void> {
  await db.runAsync(`UPDATE bridge_transfers SET status = ? WHERE hash = ?`, [status, hash]);
}

/**
 * Writes what the transfer's block says: the block, and the message it sent to the other side.
 * The status becomes `sent`, whatever it was: a row left `signed`, `pending`, `lost` or `queued`
 * whose transaction turns up in a block was sent after all.
 */
export async function recordTransferMessage(
  db: Database,
  hash: Hex,
  message: { blockNumber: bigint; messageHash: Hex; messageNonce: bigint },
): Promise<void> {
  await db.runAsync(
    `UPDATE bridge_transfers
     SET status = 'sent', block_number = ?, message_hash = ?, message_nonce = ?
     WHERE hash = ?`,
    [Number(message.blockNumber), message.messageHash, Number(message.messageNonce), hash],
  );
}

/** Writes a transfer mined and reverted, with its block: no message left for the other side. */
export async function recordTransferReverted(
  db: Database,
  hash: Hex,
  blockNumber: bigint,
): Promise<void> {
  await db.runAsync(
    `UPDATE bridge_transfers SET status = 'reverted', block_number = ? WHERE hash = ?`,
    [Number(blockNumber), hash],
  );
}

/** What the resolution needs of a transfer whose status is not final. */
export type TransferToResolve = Pick<
  Transfer,
  'hash' | 'direction' | 'nonce' | 'status' | 'blockNumber' | 'messageHash' | 'messageNonce'
>;

/** The transfers of `account` on `network` whose status is not final, oldest first. */
export async function listTransfersToResolve(
  db: Database,
  account: Address,
  network: Network,
): Promise<TransferToResolve[]> {
  const rows = await db.getAllAsync<TransferRow>(
    `SELECT hash, direction, nonce, status, block_number, message_hash, message_nonce
     FROM bridge_transfers
     WHERE account = ? AND chain_id = ?
       AND status IN (${unresolvedTransferStatuses.map(() => '?').join(', ')})
     ORDER BY sent_at`,
    [getAddress(account), network.chain.id, ...unresolvedTransferStatuses],
  );
  return rows.map((row) => ({
    hash: row.hash,
    direction: row.direction,
    nonce: row.nonce,
    status: row.status,
    blockNumber: row.block_number === null ? null : BigInt(row.block_number),
    messageHash: row.message_hash,
    messageNonce: row.message_nonce === null ? null : BigInt(row.message_nonce),
  }));
}

/** The transfers `account` made on `network`, newest first. */
export async function listTransfers(
  db: Database,
  account: Address,
  network: Network,
): Promise<Transfer[]> {
  const rows = await db.getAllAsync<TransferRow>(
    `SELECT hash, direction, account, value_wei, fee_wei, nonce, status, block_number,
            message_hash, message_nonce, sent_at
     FROM bridge_transfers
     WHERE account = ? AND chain_id = ?
     ORDER BY sent_at DESC`,
    [getAddress(account), network.chain.id],
  );
  return rows.map((row) => ({
    hash: row.hash,
    direction: row.direction,
    account: row.account,
    valueWei: BigInt(row.value_wei),
    feeWei: BigInt(row.fee_wei),
    nonce: row.nonce,
    status: row.status,
    blockNumber: row.block_number === null ? null : BigInt(row.block_number),
    messageHash: row.message_hash,
    messageNonce: row.message_nonce === null ? null : BigInt(row.message_nonce),
    sentAt: row.sent_at,
  }));
}
