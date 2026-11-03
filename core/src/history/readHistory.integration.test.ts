// `readHistory` against anvil: payments made without the register, found again in the logs.
// Run with `npm run test:integration`.

import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvilPayerKey } from '../anvil.setup';
import { anvilClient, anvilNetwork, keyStore } from '../anvilNetwork';
import { orderId } from '../charges/rules';
import { listCharges, saveCharge } from '../charges/storage';
import type { Database } from '../database/database';
import { memoryDatabase } from '../database/memoryDatabase';
import { migrate } from '../database/migrations';
import { readerFor } from '../network/network';
import { sendSignedPayment, signPayment, waitForPayment, type Payment } from '../payments/chain';
import { listSentPayments, saveSignedPayment, setSentPaymentStatus } from '../payments/storage';
import { readCursor, saveCursor } from './cursors';
import { readHistory } from './readHistory';

const anvil = inject('anvil');

// anvil's second default account receives; its third pays, as someone else.
const payee = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const otherPayerKey: Hex = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const payer = privateKeyToAccount(anvilPayerKey).address;
const valueWei = 10n ** 15n;

describe.skipIf(anvil === null)('readHistory on anvil', () => {
  const network = anvilNetwork(anvil);
  const chain = anvilClient(network);

  function newPayment(from: Hex, saltByte: string): Payment {
    const salt: Hex = `0x${saltByte.repeat(32)}`;
    return { payer: from, payee, valueWei, salt, orderId: orderId(payee, valueWei, salt) };
  }

  // A payment made on the chain and never kept: what another device, or a lost write, leaves.
  async function payOutside(key: Hex, saltByte: string) {
    const payment = newPayment(privateKeyToAccount(key).address, saltByte);
    const transaction = await signPayment(keyStore(key), network, payment);
    await sendSignedPayment(network, transaction.signed);
    const outcome = await waitForPayment(network, transaction.hash);
    return { payment, transaction, outcome };
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

  test('a payment the register lacks enters it whole', async () => {
    const { payment, transaction, outcome } = await payOutside(anvilPayerKey, '11');
    await saveCursor(db, payer, network, network.deployBlock);

    await readHistory(db, network, payer);

    const block = await readerFor(network).getBlock({ blockNumber: outcome.blockNumber });
    expect(await listSentPayments(db, payer, network)).toEqual([
      {
        ...payment,
        hash: transaction.hash,
        status: 'success',
        nonce: transaction.nonce,
        blockNumber: outcome.blockNumber,
        gasUsed: outcome.gasUsed,
        effectiveGasPrice: outcome.effectiveGasPrice,
        revertReason: null,
        finalized: false,
        sentAt: Number(block.timestamp) * 1000,
      },
    ]);
  });

  // The log proves it executed, whatever the register concluded before.
  test('a kept payment with a wrong status becomes success', async () => {
    const { payment, transaction } = await payOutside(anvilPayerKey, '11');
    await saveSignedPayment(db, transaction, payment, network, 1);
    await setSentPaymentStatus(db, transaction.hash, 'replaced');
    await saveCursor(db, payer, network, network.deployBlock);

    await readHistory(db, network, payer);

    const [sent] = await listSentPayments(db, payer, network);
    expect(sent?.status).toBe('success');
  });

  test("another payer's payments are not read", async () => {
    await payOutside(otherPayerKey, '11');
    await saveCursor(db, payer, network, network.deployBlock);

    await readHistory(db, network, payer);

    expect(await listSentPayments(db, payer, network)).toEqual([]);
  });

  test('without a cursor nothing is read and no cursor is made', async () => {
    await payOutside(anvilPayerKey, '11');

    await readHistory(db, network, payer);

    expect(await listSentPayments(db, payer, network)).toEqual([]);
    expect(await readCursor(db, payer, network)).toBeNull();
  });

  // Over 4500 blocks the reading takes three slices, and the cursor ends past the last block.
  test('the reading goes slice by slice and leaves the cursor after the last block', async () => {
    await payOutside(anvilPayerKey, '11');
    await chain.mine({ blocks: 4500 });
    const lastBlock = await readerFor(network).getBlockNumber();
    await saveCursor(db, payer, network, network.deployBlock);
    const heard: bigint[] = [];

    await readHistory(db, network, payer, (nextBlock) => heard.push(nextBlock));

    expect(heard).toHaveLength(Math.ceil(Number(lastBlock - network.deployBlock + 1n) / 2000));
    expect(heard.at(-1)).toBe(lastBlock + 1n);
    expect(await readCursor(db, payer, network)).toBe(lastBlock + 1n);
    expect(await listSentPayments(db, payer, network)).toHaveLength(1);
  });

  // The payee kept the charge paid with salt 0x11..; the one paid with salt 0x22.. was never
  // kept, as after the app's data is wiped. The payee's reading marks the first and rebuilds the
  // second. Two payments wait for two receipts, each up to viem's 4-second polling: hence the
  // longer limit.
  test("the account's reading marks its charges paid and rebuilds the ones it lacks", async () => {
    const { payer: _payer, ...kept } = newPayment(payer, '11');
    await saveCharge(db, kept, network, 1);
    const first = await payOutside(anvilPayerKey, '11');
    const second = await payOutside(anvilPayerKey, '22');
    const { payer: _other, ...lost } = second.payment;
    await saveCursor(db, payee, network, network.deployBlock);

    await readHistory(db, network, payee);

    const secondBlock = await readerFor(network).getBlock({
      blockNumber: second.outcome.blockNumber,
    });
    expect(await listCharges(db, payee, network)).toEqual(
      expect.arrayContaining([
        {
          ...kept,
          createdAt: 1,
          paidHash: first.transaction.hash,
          paidBlock: first.outcome.blockNumber,
        },
        {
          ...lost,
          createdAt: Number(secondBlock.timestamp) * 1000,
          paidHash: second.transaction.hash,
          paidBlock: second.outcome.blockNumber,
        },
      ]),
    );
    expect(await listCharges(db, payee, network)).toHaveLength(2);
  }, 15_000);
});
