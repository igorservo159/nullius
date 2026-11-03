// Bringing the payer's register up to date with the chain: what the pay tab runs when it opens,
// when the payer or the network changes, and before every payment.

import type { Address } from 'viem';
import type { Database } from '../database/database';
import type { Network } from '../network/network';
import { markFinalized, resolveSentPayments } from '../payments/resolution';
import { readHistory } from './readHistory';

/**
 * Asks the node about the payer's payments that have no final status, reads the payer's
 * `Payment` logs when `withHistory` says so, and marks finalized the mined ones whose block the
 * proof reached.
 *
 * The history is read only when asked: a first reading of a long history would otherwise hold a
 * payment back. `onResolved` hears when the resolved rows are written and the long reading is
 * about to start, so the list can be shown before it; `onSlice` is `readHistory`'s.
 */
export async function refreshPayments(
  db: Database,
  network: Network,
  payer: Address,
  {
    withHistory,
    onResolved = () => {},
    onSlice,
  }: {
    withHistory: boolean;
    onResolved?: () => void;
    onSlice?: (nextBlock: bigint, lastBlock: bigint) => void;
  },
): Promise<void> {
  await resolveSentPayments(db, network, payer);
  if (withHistory) {
    onResolved();
    await readHistory(db, network, payer, onSlice);
  }
  await markFinalized(db, network, payer);
}
