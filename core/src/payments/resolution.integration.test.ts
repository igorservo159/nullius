// `resolveSentPayments` against anvil: real transactions mined, held in the pool, or never sent.
// Run with `npm run test:integration`.

import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvilPayerKey } from '../anvil.setup';
import { anvilClient, anvilNetwork, keyStore } from '../anvilNetwork';
import { orderId } from '../charges/rules';
import type { Database } from '../database/database';
import { memoryDatabase } from '../database/memoryDatabase';
import { migrate } from '../database/migrations';
import { readCursor, startCursor } from '../history/cursors';
import { readerFor } from '../network/network';
import { sendSignedPayment, signPayment, waitForPayment, type Payment } from './chain';
import { markFinalized, resolveSentPayments } from './resolution';
import { saveSignedPayment, setSentPaymentStatus, settleSentPayment } from './storage';

const anvil = inject('anvil');

const payee = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const payer = privateKeyToAccount(anvilPayerKey).address;
const valueWei = 10n ** 15n;

describe.skipIf(anvil === null)('resolveSentPayments on anvil', () => {
  const network = anvilNetwork(anvil);
  const chain = anvilClient(network);
  const store = keyStore(anvilPayerKey);

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

  // A payment of a charge of its own, so two in one test never pay the same order.
  function newPayment(saltByte: string): Payment {
    const salt: Hex = `0x${saltByte.repeat(32)}`;
    return { payer, payee, valueWei, salt, orderId: orderId(payee, valueWei, salt) };
  }

  // A hash no node holds, for rows whose transaction never left the phone.
  function unknownHash(byte: string): Hex {
    return `0x${byte.repeat(32)}`;
  }

  async function statusOf(hash: Hex) {
    const [row] = await db.getAllAsync<{ status: string; block_number: number | null; nonce: number | null }>(
      'SELECT status, block_number, nonce FROM sent_payments WHERE hash = ?',
      [hash],
    );
    return row;
  }

  async function finalizedOf(hash: Hex) {
    const [row] = await db.getAllAsync<{ finalized: number }>(
      'SELECT finalized FROM sent_payments WHERE hash = ?',
      [hash],
    );
    return row?.finalized;
  }

  async function payerCount() {
    return readerFor(network).getTransactionCount({ address: payer });
  }

  test('a signed payment that was mined takes its receipt', async () => {
    const payment = newPayment('11');
    const transaction = await signPayment(store, network, payment);
    await saveSignedPayment(db, transaction, payment, network, 1);
    await sendSignedPayment(network, transaction.signed);
    const outcome = await waitForPayment(network, transaction.hash);

    await resolveSentPayments(db, network, payer);

    expect(await statusOf(transaction.hash)).toEqual({
      status: 'success',
      block_number: Number(outcome.blockNumber),
      nonce: transaction.nonce,
    });
  });

  test('a signed payment held in the pool becomes pending', async () => {
    const payment = newPayment('11');
    await chain.setAutomine(false);
    try {
      const transaction = await signPayment(store, network, payment);
      await saveSignedPayment(db, transaction, payment, network, 1);
      await sendSignedPayment(network, transaction.signed);

      await resolveSentPayments(db, network, payer);

      expect((await statusOf(transaction.hash)).status).toBe('pending');
    } finally {
      await chain.mine({ blocks: 1 });
      await chain.setAutomine(true);
    }
  });

  // Row `aa` claims nonce `count`, which a real payment then spends with another hash; row `bb`
  // claims a nonce two above what the account reaches.
  test('a hash the node does not know is replaced below the count and queued above it', async () => {
    const count = await payerCount();
    await saveSignedPayment(db, { hash: unknownHash('aa'), nonce: count }, newPayment('11'), network, 1);
    await saveSignedPayment(db, { hash: unknownHash('bb'), nonce: count + 3 }, newPayment('22'), network, 1);
    const spent = await signPayment(store, network, newPayment('33'));
    await sendSignedPayment(network, spent.signed);
    await waitForPayment(network, spent.hash);

    await resolveSentPayments(db, network, payer);

    expect((await statusOf(unknownHash('aa'))).status).toBe('replaced');
    expect((await statusOf(unknownHash('bb'))).status).toBe('queued');
  });

  test('a hash the node does not know, at the next nonce, is lost', async () => {
    const count = await payerCount();
    await saveSignedPayment(db, { hash: unknownHash('aa'), nonce: count }, newPayment('11'), network, 1);

    await resolveSentPayments(db, network, payer);

    expect((await statusOf(unknownHash('aa'))).status).toBe('lost');
  });

  test('a final status is not asked about again', async () => {
    const count = await payerCount();
    await saveSignedPayment(db, { hash: unknownHash('aa'), nonce: count }, newPayment('11'), network, 1);
    await setSentPaymentStatus(db, unknownHash('aa'), 'rejected');

    await resolveSentPayments(db, network, payer);

    expect((await statusOf(unknownHash('aa'))).status).toBe('rejected');
  });

  // anvil keeps its finalized block 64 behind the latest one.
  test('a mined payment is marked finalized once the finalized block reaches it', async () => {
    const payment = newPayment('11');
    const transaction = await signPayment(store, network, payment);
    await saveSignedPayment(db, transaction, payment, network, 1);
    await sendSignedPayment(network, transaction.signed);
    await settleSentPayment(db, transaction.hash, await waitForPayment(network, transaction.hash));

    await markFinalized(db, network, payer);
    expect(await finalizedOf(transaction.hash)).toBe(0);

    await chain.mine({ blocks: 64 });
    await markFinalized(db, network, payer);
    expect(await finalizedOf(transaction.hash)).toBe(1);
  });

  // Rows of hashes no node holds, settled by hand at the current block: `aa` executed with an
  // order id nobody paid, `bb` reverted. Once the finalized block passes them, Payments says `aa`
  // is not paid, and `bb` needs no question.
  test('an executed row is finalized only if its order id is paid, a reverted one by its block', async () => {
    const block = await readerFor(network).getBlockNumber();
    const settled = (status: 'success' | 'reverted') => ({
      status,
      blockNumber: block,
      gasUsed: 50_000n,
      effectiveGasPrice: 7n,
      revertReason: status === 'reverted' ? ('AlreadyPaid' as const) : null,
    });
    await saveSignedPayment(db, { hash: unknownHash('aa'), nonce: 0 }, newPayment('11'), network, 1);
    await saveSignedPayment(db, { hash: unknownHash('bb'), nonce: 0 }, newPayment('22'), network, 1);
    await settleSentPayment(db, unknownHash('aa'), settled('success'));
    await settleSentPayment(db, unknownHash('bb'), settled('reverted'));

    await chain.mine({ blocks: 64 });
    await markFinalized(db, network, payer);

    expect(await finalizedOf(unknownHash('aa'))).toBe(0);
    expect(await finalizedOf(unknownHash('bb'))).toBe(1);
  });

  test('without the history, the first cursor is the current block', async () => {
    await chain.mine({ blocks: 5 });
    const current = await readerFor(network).getBlockNumber();

    await startCursor(db, payer, network, false);

    expect(await readCursor(db, payer, network)).toBe(current);
  });
});
