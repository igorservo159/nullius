// Moving ETH to the same account on the other layer: what the bridge tab runs when the user taps
// Depositar or Sacar.

import type { Address, Hex } from 'viem';
import type { SecretStore } from '../accounts/accounts';
import type { Database } from '../database/database';
import type { Network } from '../network/network';
import { keepAndSend } from '../transactions/transactions';
import { sendSignedTransfer, signTransfer, waitForOriginBlock } from './chain';
import { saveSignedTransfer, setTransferStatus, type TransferDirection } from './storage';

/**
 * Where a transfer got to on its origin layer, as `transfer` reaches each point: kept on the
 * phone and not yet sent, accepted by the node, and in a block. What happens on the other side,
 * hours later for a withdrawal, is `resolveTransfers`'s.
 */
export type TransferStage =
  | { stage: 'kept'; hash: Hex }
  | { stage: 'sent'; hash: Hex }
  | { stage: 'mined'; hash: Hex };

/**
 * Sends `amountWei` from `account` on the layer `direction` leaves, to the same account on the
 * other one, and returns once the transaction is in a block there.
 *
 * As `payCharge`: it signs (a transfer the account cannot afford stops before the key is read),
 * keeps and sends it through `keepAndSend`, and waits for its block on the origin layer. A write
 * after the bytes left that fails goes to `onRecordFailure` instead of stopping the transfer.
 */
export async function transfer(
  db: Database,
  store: SecretStore,
  network: Network,
  account: Address,
  direction: TransferDirection,
  amountWei: bigint,
  sentAt: number,
  {
    onStage = () => {},
    onRecordFailure = () => {},
  }: { onStage?: (stage: TransferStage) => void; onRecordFailure?: (error: unknown) => void } = {},
): Promise<void> {
  const signed = await signTransfer(store, network, account, direction, amountWei);
  const kept = { direction, account, valueWei: amountWei, feeWei: signed.feeWei };
  await keepAndSend({
    keep: () => saveSignedTransfer(db, signed, kept, network, sentAt),
    send: () => sendSignedTransfer(network, direction, signed.signed),
    mark: (status) => setTransferStatus(db, signed.hash, status),
    onKept: () => onStage({ stage: 'kept', hash: signed.hash }),
    onRecordFailure,
  });
  onStage({ stage: 'sent', hash: signed.hash });

  await waitForOriginBlock(network, direction, signed.hash);
  onStage({ stage: 'mined', hash: signed.hash });
}
