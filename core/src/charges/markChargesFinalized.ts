// Marking finalized the payee's paid charges once the finalized block passed the block that paid
// them: what the receive tab runs after every reading of the logs.

import type { Address, Hex } from 'viem';
import type { Database } from '../database/database';
import { readerFor, type Network } from '../network/network';
import { isPaidAtBlock } from '../payments/chain';
import { hasUnfinalizedCharges, listPaidUpTo, markChargeFinalized } from './storage';

/**
 * Marks finalized each paid charge of `payee` on `network` whose paying block is at or below the
 * node's finalized block and whose order id Payments holds as paid in that block's state, and
 * returns their order ids. One the proven chain lacks stays paid and unmarked, and is asked about
 * again at the next call. The node is asked only when some paid charge is not marked yet.
 */
export async function markChargesFinalized(
  db: Database,
  network: Network,
  payee: Address,
): Promise<Hex[]> {
  if (!(await hasUnfinalizedCharges(db, payee, network))) return [];
  const reader = readerFor(network);
  const { number: finalizedBlock } = await reader.getBlock({ blockTag: 'finalized' });
  const finalized: Hex[] = [];
  for (const orderId of await listPaidUpTo(db, payee, network, finalizedBlock)) {
    if (await isPaidAtBlock(reader, network, orderId, finalizedBlock)) {
      await markChargeFinalized(db, network, orderId);
      finalized.push(orderId);
    }
  }
  return finalized;
}
