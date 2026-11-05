// `markChargesFinalized` against anvil: a charge really paid, and one marked paid by hand that
// nobody paid. Run with `npm run test:integration`.

import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvilPayerKey } from '../anvil.setup';
import { anvilClient, anvilNetwork, keyStore } from '../anvilNetwork';
import type { Database } from '../database/database';
import { memoryDatabase } from '../database/memoryDatabase';
import { migrate } from '../database/migrations';
import { sendSignedPayment, signPayment, waitForPayment } from '../payments/chain';
import { markChargesFinalized } from './markChargesFinalized';
import { orderId, type Charge } from './rules';
import { listCharges, markChargePaid, saveCharge } from './storage';

const anvil = inject('anvil');

const payee = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const payer = privateKeyToAccount(anvilPayerKey).address;
const valueWei = 10n ** 15n;

describe.skipIf(anvil === null)('markChargesFinalized on anvil', () => {
  const network = anvilNetwork(anvil);
  const chain = anvilClient(network);

  function newCharge(saltByte: string): Charge {
    const salt: Hex = `0x${saltByte.repeat(32)}`;
    return { payee, valueWei, salt, orderId: orderId(payee, valueWei, salt) };
  }

  let snapshot: Hex;
  let db: Database;
  beforeEach(async () => {
    snapshot = await chain.snapshot();
    db = memoryDatabase();
    await migrate(db);
  });
  afterEach(async () => {
    await chain.revert({ id: snapshot });
  });

  // `paid` is paid on chain and marked with its receipt; `unpaid` is marked by hand at the same
  // block with a hash no node holds. anvil keeps its finalized block 64 behind the latest one.
  test('a paid charge is finalized past the finalized block if Payments holds it', async () => {
    const paid = newCharge('11');
    const unpaid = newCharge('22');
    await saveCharge(db, paid, network, 1);
    await saveCharge(db, unpaid, network, 1);
    const transaction = await signPayment(keyStore(anvilPayerKey), network, { ...paid, payer });
    await sendSignedPayment(network, transaction.signed);
    const { blockNumber } = await waitForPayment(network, transaction.hash);
    await markChargePaid(db, network, paid.orderId, transaction.hash, blockNumber);
    await markChargePaid(db, network, unpaid.orderId, `0x${'aa'.repeat(32)}`, blockNumber);

    expect(await markChargesFinalized(db, network, payee)).toEqual([]);

    await chain.mine({ blocks: 64 });
    expect(await markChargesFinalized(db, network, payee)).toEqual([paid.orderId]);
    const listed = await listCharges(db, payee, network);
    const finalizedOf = (id: Hex) => listed.find((stored) => stored.orderId === id)?.paidFinalized;
    expect(finalizedOf(paid.orderId)).toBe(true);
    expect(finalizedOf(unpaid.orderId)).toBe(false);
  });
});
