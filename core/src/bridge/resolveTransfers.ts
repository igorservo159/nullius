// Bringing the account's transfers up to date with both layers: what the bridge tab and the
// claimable-withdrawal band run when they open.

import type { Address } from 'viem';
import type { Database } from '../database/database';
import { readerFor, type Network } from '../network/network';
import { byNonce, receiptOf, transactionOf } from '../transactions/transactions';
import { depositStatus, messageOf, originOf, withdrawalClaimed } from './chain';
import {
  listTransfersToResolve,
  recordTransferMessage,
  recordTransferReverted,
  setTransferStatus,
  type TransferToResolve,
} from './storage';

/**
 * Brings one transfer without a message up to date on its origin layer, by the rules of
 * `resolveSentPayments`: a hash the node does not know is judged by its nonce against `count`, a
 * transaction without a block is `pending`, and a mined one gets its block and message, or
 * `reverted`. A transaction mined but whose receipt the node does not have yet is left as it is.
 */
async function resolveAtOrigin(
  db: Database,
  network: Network,
  row: TransferToResolve,
  count: number,
): Promise<void> {
  const origin = originOf(network, row.direction);
  const transaction = await transactionOf(origin.reader, row.hash);
  if (transaction === null) {
    await setTransferStatus(db, row.hash, byNonce(row.nonce, count));
    return;
  }
  if (transaction.blockNumber === null) {
    await setTransferStatus(db, row.hash, 'pending');
    return;
  }
  const receipt = await receiptOf(origin.reader, row.hash);
  if (receipt === null) return;
  if (receipt.status === 'reverted') {
    await recordTransferReverted(db, row.hash, receipt.blockNumber);
  } else {
    await recordTransferMessage(db, row.hash, messageOf(receipt, origin.messageService));
  }
}

/**
 * Asks both layers about every transfer of `account` on `network` whose status is not final, and
 * writes what they say.
 *
 * First the origin layer, for the transfers without a message: the account's count there is read
 * once, before any hash is looked up, as `resolveSentPayments` does. Then the other side, for the
 * transfers with a message, read again from the database so those the first part just found are
 * in: a deposit by the status Linea's L2 contract gives its message; a withdrawal by whether
 * Linea's finalized block reached the withdrawal's block, and once it did, by whether the L1
 * contract says its message was claimed.
 */
export async function resolveTransfers(
  db: Database,
  network: Network,
  account: Address,
): Promise<void> {
  const rows = await listTransfersToResolve(db, account, network);
  for (const direction of ['deposit', 'withdrawal'] as const) {
    const atOrigin = rows.filter((row) => row.direction === direction && row.messageHash === null);
    if (atOrigin.length === 0) continue;
    const reader = originOf(network, direction).reader;
    const count = await reader.getTransactionCount({ address: account, blockTag: 'latest' });
    for (const row of atOrigin) await resolveAtOrigin(db, network, row, count);
  }

  // Linea's finalized block, read at the first withdrawal that needs it and only then.
  let finalized: bigint | undefined;
  for (const row of await listTransfersToResolve(db, account, network)) {
    if (row.messageHash === null || row.messageNonce === null || row.blockNumber === null) continue;
    if (row.direction === 'deposit') {
      const status = await depositStatus(network, row.messageHash);
      if (status === 'claimed') await setTransferStatus(db, row.hash, 'claimed');
      if (status === 'anchored' && row.status === 'sent') {
        await setTransferStatus(db, row.hash, 'claimable');
      }
    } else {
      if (row.status === 'sent') {
        finalized ??= (await readerFor(network).getBlock({ blockTag: 'finalized' })).number;
        if (row.blockNumber > finalized) continue;
        await setTransferStatus(db, row.hash, 'claimable');
      }
      if (await withdrawalClaimed(network, row.messageNonce)) {
        await setTransferStatus(db, row.hash, 'claimed');
      }
    }
  }
}
