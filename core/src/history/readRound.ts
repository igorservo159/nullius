// One round of an account's history: what the app runs every few seconds while it is open, and
// what a task in the background is meant to run while it is not.

import type { Address } from 'viem';
import { markChargesFinalized } from '../charges/markChargesFinalized';
import { newlyPaid } from '../charges/newlyPaid';
import { listCharges, type StoredCharge } from '../charges/storage';
import type { Database } from '../database/database';
import type { Network } from '../network/network';
import { markFinalized } from '../payments/resolution';
import { readHistory } from './readHistory';

/**
 * Reads `account`'s `Payment` logs from its cursor, marks finalized its paid charges and its
 * mined payments the finalized block passed, and returns the charges that turned paid and the
 * ones marked finalized in this round, as the list holds them after it. A charge paid and
 * finalized in the same round is in both. `onSlice` is `readHistory`'s: an error it throws stops
 * the round after the slice it heard of, whose cursor is already saved.
 */
export async function readRound(
  db: Database,
  network: Network,
  account: Address,
  onSlice?: (nextBlock: bigint, lastBlock: bigint) => void,
): Promise<{ paid: StoredCharge[]; finalized: StoredCharge[] }> {
  const before = await listCharges(db, account, network);
  await readHistory(db, network, account, onSlice);
  const finalizedIds = await markChargesFinalized(db, network, account);
  await markFinalized(db, network, account);
  const after = await listCharges(db, account, network);
  return {
    paid: newlyPaid(before, after),
    finalized: after.filter((charge) => finalizedIds.includes(charge.orderId)),
  };
}
