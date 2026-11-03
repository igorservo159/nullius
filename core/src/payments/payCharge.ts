// Paying a charge: the whole sequence the pay tab runs when the payer taps Pagar.

import type { Hex } from 'viem';
import type { SecretStore } from '../accounts/accounts';
import type { Database } from '../database/database';
import type { Network } from '../network/network';
import { keepAndSend, recordOrReport } from '../transactions/transactions';
import {
  sendSignedPayment,
  signPayment,
  waitForPayment,
  type Payment,
  type PaymentOutcome,
} from './chain';
import { saveSignedPayment, setSentPaymentStatus, settleSentPayment } from './storage';

/**
 * Where a payment got to, as `payCharge` reaches each point: kept on the phone and not yet sent,
 * accepted by the node, and mined with its receipt.
 */
export type PayStage =
  | { stage: 'kept'; hash: Hex }
  | { stage: 'sent'; hash: Hex }
  | { stage: 'settled'; hash: Hex; outcome: PaymentOutcome };

/**
 * Pays `payment` and returns what its receipt said.
 *
 * It signs (see `signPayment`: a payment the contract would refuse stops there, before the key is
 * read), keeps and sends it through `keepAndSend`, waits for its receipt and keeps it.
 *
 * `onStage` hears each point reached, after the row says it. A write after the bytes left that
 * fails goes to `onRecordFailure` instead of stopping the payment, and `resolveSentPayments`
 * brings the row up to date later.
 */
export async function payCharge(
  db: Database,
  store: SecretStore,
  network: Network,
  payment: Payment,
  sentAt: number,
  {
    onStage = () => {},
    onRecordFailure = () => {},
  }: { onStage?: (stage: PayStage) => void; onRecordFailure?: (error: unknown) => void } = {},
): Promise<PaymentOutcome> {
  const transaction = await signPayment(store, network, payment);
  await keepAndSend({
    keep: () => saveSignedPayment(db, transaction, payment, network, sentAt),
    send: () => sendSignedPayment(network, transaction.signed),
    mark: (status) => setSentPaymentStatus(db, transaction.hash, status),
    onKept: () => onStage({ stage: 'kept', hash: transaction.hash }),
    onRecordFailure,
  });
  onStage({ stage: 'sent', hash: transaction.hash });

  const outcome = await waitForPayment(network, transaction.hash);
  await recordOrReport(() => settleSentPayment(db, transaction.hash, outcome), onRecordFailure);
  onStage({ stage: 'settled', hash: transaction.hash, outcome });
  return outcome;
}
