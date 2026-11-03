// Where the search for `Payment` logs stands for each account, on each network: the first block
// not read yet.

import { getAddress, type Address } from 'viem';
import type { Database } from '../database/database';
import { readerFor, type Network } from '../network/network';

/** The first block not read yet for `account` on `network`; null while the account has none. */
export async function readCursor(
  db: Database,
  account: Address,
  network: Network,
): Promise<bigint | null> {
  const [row] = await db.getAllAsync<{ next_block: number }>(
    `SELECT next_block FROM account_cursors
     WHERE address = ? AND chain_id = ? AND payments_address = ?`,
    [getAddress(account), network.chain.id, getAddress(network.paymentsAddress)],
  );
  return row === undefined ? null : BigInt(row.next_block);
}

/** Sets the first block not read yet for `account` on `network`, creating its row if needed. */
export async function saveCursor(
  db: Database,
  account: Address,
  network: Network,
  nextBlock: bigint,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO account_cursors (address, chain_id, payments_address, next_block)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (address, chain_id, payments_address) DO UPDATE SET next_block = excluded.next_block`,
    [
      getAddress(account),
      network.chain.id,
      getAddress(network.paymentsAddress),
      Number(nextBlock),
    ],
  );
}

/**
 * The answer to the history question, kept as the account's first cursor on `network`. With the
 * history, the search starts at the block that published the contract, and only that number is
 * needed. Without it, the search starts at the node's current block, and what came before is
 * never read.
 */
export async function startCursor(
  db: Database,
  account: Address,
  network: Network,
  withHistory: boolean,
): Promise<void> {
  const nextBlock = withHistory
    ? network.deployBlock
    : await readerFor(network).getBlockNumber();
  await saveCursor(db, account, network, nextBlock);
}
