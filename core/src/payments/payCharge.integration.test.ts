// `payCharge` against the real Payments, on anvil, with the database in memory. Run with
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
import { readerFor } from '../network/network';
import { TransactionNotKept } from '../transactions/transactions';
import { PaymentRefused, type Payment } from './chain';
import { payCharge, type PayStage } from './payCharge';
import { listSentPayments } from './storage';

const anvil = inject('anvil');

// anvil's second default account: it only receives.
const payee = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const payer = privateKeyToAccount(anvilPayerKey).address;
const salt: Hex = '0x4444444444444444444444444444444444444444444444444444444444444444';
const valueWei = 10n ** 15n;
const payment: Payment = { payer, payee, valueWei, salt, orderId: orderId(payee, valueWei, salt) };

const store = keyStore(anvilPayerKey);

// A database whose writes matching `failing` throw, as a full disk or a closed file would.
function failingOn(db: Database, failing: RegExp): Database {
  return {
    ...db,
    async runAsync(source, params) {
      if (failing.test(source)) throw new Error('disk I/O error');
      return db.runAsync(source, params);
    },
  };
}

describe.skipIf(anvil === null)('payCharge on anvil', () => {
  const network = anvilNetwork(anvil);
  const chain = anvilClient(network);

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

  test('a payment goes kept, sent, settled, and its row ends with the receipt', async () => {
    const stages: PayStage['stage'][] = [];
    const outcome = await payCharge(db, store, network, payment, 1, {
      onStage: ({ stage }) => stages.push(stage),
    });

    expect(stages).toEqual(['kept', 'sent', 'settled']);
    expect(outcome.status).toBe('success');
    const [row] = await listSentPayments(db, payer, network);
    expect(row).toMatchObject({ status: 'success', blockNumber: outcome.blockNumber });
  });

  test('a charge already paid is refused before anything is kept', async () => {
    await payCharge(db, store, network, payment, 1);
    const again = payCharge(db, store, network, payment, 2);

    await expect(again).rejects.toBeInstanceOf(PaymentRefused);
    await expect(again).rejects.toMatchObject({ reason: 'AlreadyPaid' });
    expect(await listSentPayments(db, payer, network)).toHaveLength(1);
  });

  test('a payment that cannot be kept is not sent', async () => {
    const reader = readerFor(network);
    const nonceBefore = await reader.getTransactionCount({ address: payer });
    const stages: PayStage['stage'][] = [];

    await expect(
      payCharge(failingOn(db, /INSERT INTO sent_payments/), store, network, payment, 1, {
        onStage: ({ stage }) => stages.push(stage),
      }),
    ).rejects.toBeInstanceOf(TransactionNotKept);

    expect(stages).toEqual([]);
    expect(await reader.getTransactionCount({ address: payer })).toBe(nonceBefore);
  });

  test('a write failing after the send is reported, and the receipt still comes back', async () => {
    const failures: unknown[] = [];
    const failingDb = failingOn(db, /UPDATE sent_payments/);
    const outcome = await payCharge(failingDb, store, network, payment, 1, {
      onRecordFailure: (error) => failures.push(error),
    });

    expect(outcome.status).toBe('success');
    expect(failures).toHaveLength(2);
    const [row] = await listSentPayments(db, payer, network);
    expect(row.status).toBe('signed');
  });
});
