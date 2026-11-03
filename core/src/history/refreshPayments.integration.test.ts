// `refreshPayments` against anvil, with the database in memory. Run with
// `npm run test:integration`.

import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvilPayerKey } from '../anvil.setup';
import { anvilClient, anvilNetwork, keyStore } from '../anvilNetwork';
import { orderId } from '../charges/rules';
import type { Database } from '../database/database';
import { memoryDatabase } from '../database/memoryDatabase';
import { migrate } from '../database/migrations';
import { sendSignedPayment, signPayment, waitForPayment, type Payment } from '../payments/chain';
import { listSentPayments, saveSignedPayment } from '../payments/storage';
import { saveCursor } from './cursors';
import { refreshPayments } from './refreshPayments';

const anvil = inject('anvil');

// anvil's second default account: it only receives.
const payee = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const payer = privateKeyToAccount(anvilPayerKey).address;
const valueWei = 10n ** 15n;
const store = keyStore(anvilPayerKey);

function newPayment(saltByte: string): Payment {
  const salt: Hex = `0x${saltByte.repeat(32)}`;
  return { payer, payee, valueWei, salt, orderId: orderId(payee, valueWei, salt) };
}

describe.skipIf(anvil === null)('refreshPayments on anvil', () => {
  const network = anvilNetwork(anvil);
  const chain = anvilClient(network);

  // Paid on the chain and sent from here, with no write after the row kept as signed: what an
  // app closed before the receipt leaves.
  async function payLeavingSigned(saltByte: string) {
    const payment = newPayment(saltByte);
    const transaction = await signPayment(store, network, payment);
    await saveSignedPayment(db, transaction, payment, network, 1);
    await sendSignedPayment(network, transaction.signed);
    await waitForPayment(network, transaction.hash);
    return transaction;
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

  test('without the history, a signed row that was mined is resolved', async () => {
    const transaction = await payLeavingSigned('11');
    let resolved = false;

    await refreshPayments(db, network, payer, {
      withHistory: false,
      onResolved: () => {
        resolved = true;
      },
    });

    const [row] = await listSentPayments(db, payer, network);
    expect(row).toMatchObject({ hash: transaction.hash, status: 'success' });
    expect(resolved).toBe(false);
  });

  test('with the history, a payment made outside is found after onResolved', async () => {
    const payment = newPayment('22');
    const transaction = await signPayment(store, network, payment);
    await sendSignedPayment(network, transaction.signed);
    await waitForPayment(network, transaction.hash);
    await saveCursor(db, payer, network, network.deployBlock);
    const heard: string[] = [];

    await refreshPayments(db, network, payer, {
      withHistory: true,
      onResolved: () => heard.push('resolved'),
      onSlice: () => heard.push('slice'),
    });

    expect(heard[0]).toBe('resolved');
    expect(heard).toContain('slice');
    const [row] = await listSentPayments(db, payer, network);
    expect(row).toMatchObject({ hash: transaction.hash, status: 'success' });
  });
});
