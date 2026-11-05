// Resolving the sent payments that have no final status: what the node says about each hash,
// and, when it knows none, what the payer's nonce count says.

import type { Address } from 'viem';
import type { Database } from '../database/database';
import { readerFor, type Network } from '../network/network';
import { byNonce, receiptOf, transactionOf } from '../transactions/transactions';
import { isPaidAtBlock, outcomeOf } from './chain';
import {
  hasUnfinalizedPayments,
  listExecutedUpTo,
  listPaymentsToResolve,
  markRevertedFinalizedUpTo,
  markSentPaymentFinalized,
  setSentPaymentStatus,
  settleSentPayment,
} from './storage';

/**
 * Asks the node about every payment of `payer` on `network` whose status is not final, and
 * writes what it learns.
 *
 * The payer's count is read once, before any hash is looked up. Read after, a transaction mined
 * in between would be missing from the lookups and already inside the count, and would read as
 * replaced. A row whose transaction is mined but whose receipt the node does not have yet is
 * left for the next call.
 */
export async function resolveSentPayments(
  db: Database,
  network: Network,
  payer: Address,
): Promise<void> {
  const rows = await listPaymentsToResolve(db, payer, network);
  if (rows.length === 0) return;

  const reader = readerFor(network);
  const count = await reader.getTransactionCount({ address: payer, blockTag: 'latest' });

  for (const row of rows) {
    const transaction = await transactionOf(reader, row.hash);
    if (transaction === null) {
      await setSentPaymentStatus(db, row.hash, byNonce(row.nonce, count));
      continue;
    }

    if (transaction.blockNumber === null) {
      await setSentPaymentStatus(db, row.hash, 'pending');
      continue;
    }
    const receipt = await receiptOf(reader, row.hash);
    if (receipt !== null) await settleSentPayment(db, row.hash, await outcomeOf(reader, receipt));
  }
}

/**
 * Marks finalized the payer's mined payments whose block is at or below the node's finalized
 * block: the proof of that block reached Ethereum. A reverted payment is marked by its block
 * alone. An executed one is marked only when Payments holds its order id as paid in the state of
 * the finalized block; one the proven chain lacks stays unmarked, and is asked about again at the
 * next call. The node is asked only when some mined payment is not marked yet, so a payer whose
 * payments are all finalized costs no call.
 */
export async function markFinalized(db: Database, network: Network, payer: Address): Promise<void> {
  if (!(await hasUnfinalizedPayments(db, payer, network))) return;
  const reader = readerFor(network);
  const { number: finalizedBlock } = await reader.getBlock({ blockTag: 'finalized' });
  await markRevertedFinalizedUpTo(db, payer, network, finalizedBlock);
  for (const { hash, orderId } of await listExecutedUpTo(db, payer, network, finalizedBlock)) {
    if (await isPaidAtBlock(reader, network, orderId, finalizedBlock)) {
      await markSentPaymentFinalized(db, hash);
    }
  }
}
