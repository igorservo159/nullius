// Creating a charge: what the receive tab does when the payee asks for an amount.

import type { Address } from 'viem';
import type { Database } from '../database/database';
import type { Network } from '../network/network';
import { encodeCharge, orderId, randomSalt, type Charge } from './rules';
import { saveCharge } from './storage';

/**
 * A new charge of `valueWei` to `payee` on `network`, kept and returned with its text.
 *
 * The amount must be above zero: the contract refuses a payment of nothing, so no charge asks for
 * one. A new salt is drawn every time, so two charges of one payee and amount get different order
 * ids. The charge is kept before it is returned, so a charge the payer can see is one the list
 * has. `createdAt` is the caller's clock, in milliseconds.
 */
export async function createCharge(
  db: Database,
  network: Network,
  payee: Address,
  valueWei: bigint,
  createdAt: number,
): Promise<Charge & { text: string }> {
  if (valueWei <= 0n) throw new Error(`a charge asks for more than zero, not ${valueWei} wei`);
  const salt = randomSalt();
  const charge: Charge = { payee, valueWei, salt, orderId: orderId(payee, valueWei, salt) };
  await saveCharge(db, charge, network, createdAt);
  return { ...charge, text: encodeCharge(charge, network) };
}
