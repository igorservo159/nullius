import { beforeEach, expect, test } from 'vitest';
import { linea, lineaSepolia, sepolia } from 'viem/chains';
import type { Hex } from 'viem';
import { orderId, randomSalt } from '../charges/rules';
import type { Database } from '../database/database';
import { memoryDatabase } from '../database/memoryDatabase';
import { migrate } from '../database/migrations';
import type { Network } from '../network/network';
import type { Payment, RevertReason } from './chain';
import {
  hasUnfinalizedPayments,
  listPaymentsToResolve,
  listSentPayments,
  markFinalizedUpTo,
  saveFoundPayment,
  saveSignedPayment,
  setSentPaymentStatus,
  settleSentPayment,
  statusOfSentPayment,
} from './storage';

const sepoliaNetwork: Network = {
  chain: lineaSepolia,
  rpcUrl: 'https://unused.invalid',
  paymentsAddress: '0x3333333333333333333333333333333333333333',
  deployBlock: 0n,
  l1Chain: sepolia,
  l1RpcUrl: 'https://unused.invalid',
};

const payer = '0x1111111111111111111111111111111111111111';
const otherPayer = '0x4444444444444444444444444444444444444444';
const payee = '0x2222222222222222222222222222222222222222';

function newPayment(paymentPayer: Payment['payer']): Payment {
  const salt = randomSalt();
  return { payer: paymentPayer, payee, valueWei: 1000n, salt, orderId: orderId(payee, 1000n, salt) };
}

// A transaction hash is 32 bytes; the tests only need distinct ones.
function fakeHash(byte: string): Hex {
  return `0x${byte.repeat(32)}`;
}

// A receipt's outcome for the tests that only care about status and block.
function mined(
  status: 'success' | 'reverted',
  blockNumber: bigint,
  revertReason: RevertReason | null = null,
) {
  return { status, blockNumber, gasUsed: 50_000n, effectiveGasPrice: 7n, revertReason };
}

// The hash and nonce of a signed transaction, as `saveSignedPayment` takes them.
function signedAs(byte: string, nonce = 7) {
  return { hash: fakeHash(byte), nonce };
}

let db: Database;

beforeEach(async () => {
  db = memoryDatabase();
  await migrate(db);
});

test('a payment just signed is kept as signed, with no block', async () => {
  const payment = newPayment(payer);
  await saveSignedPayment(db, signedAs('aa'), payment, sepoliaNetwork, 1);
  expect(await listSentPayments(db, payer, sepoliaNetwork)).toEqual([
    {
      ...payment,
      hash: fakeHash('aa'),
      status: 'signed',
      nonce: 7,
      blockNumber: null,
      gasUsed: null,
      effectiveGasPrice: null,
      revertReason: null,
      finalized: false,
      sentAt: 1,
    },
  ]);
});

test("the node's answer turns signed into pending or rejected", async () => {
  await saveSignedPayment(db, signedAs('aa'), newPayment(payer), sepoliaNetwork, 1);
  await saveSignedPayment(db, signedAs('bb'), newPayment(payer), sepoliaNetwork, 2);
  await setSentPaymentStatus(db, fakeHash('aa'), 'pending');
  await setSentPaymentStatus(db, fakeHash('bb'), 'rejected');
  const listed = await listSentPayments(db, payer, sepoliaNetwork);
  expect(listed.map((sent) => [sent.hash, sent.status])).toEqual([
    [fakeHash('bb'), 'rejected'],
    [fakeHash('aa'), 'pending'],
  ]);
});

test('the receipt turns pending into its status, block, gas and price', async () => {
  await saveSignedPayment(db, signedAs('aa'), newPayment(payer), sepoliaNetwork, 1);
  await settleSentPayment(db, fakeHash('aa'), mined('success', 123n));
  const [sent] = await listSentPayments(db, payer, sepoliaNetwork);
  expect(sent?.status).toBe('success');
  expect(sent?.blockNumber).toBe(123n);
  expect(sent?.gasUsed).toBe(50_000n);
  expect(sent?.effectiveGasPrice).toBe(7n);
});

test('the list holds only the payments of that payer on that network', async () => {
  await saveSignedPayment(db, signedAs('aa'), newPayment(payer), sepoliaNetwork, 1);
  await saveSignedPayment(db, signedAs('bb'), newPayment(otherPayer), sepoliaNetwork, 2);
  await saveSignedPayment(db, signedAs('cc'), newPayment(payer), { ...sepoliaNetwork, chain: linea }, 3);
  const listed = await listSentPayments(db, payer, sepoliaNetwork);
  expect(listed.map((sent) => sent.hash)).toEqual([fakeHash('aa')]);
});

// The contract refuses the second one with `AlreadyPaid`, but both left the phone: both are
// listed, newest first.
test('two payments of the same order id are both kept', async () => {
  const payment = newPayment(payer);
  await saveSignedPayment(db, signedAs('aa'), payment, sepoliaNetwork, 1);
  await saveSignedPayment(db, signedAs('bb'), payment, sepoliaNetwork, 2);
  const listed = await listSentPayments(db, payer, sepoliaNetwork);
  expect(listed.map((sent) => sent.hash)).toEqual([fakeHash('bb'), fakeHash('aa')]);
});

test('a status outside the list is refused by the table', async () => {
  await saveSignedPayment(db, signedAs('aa'), newPayment(payer), sepoliaNetwork, 1);
  await expect(
    db.runAsync(`UPDATE sent_payments SET status = 'executed' WHERE hash = ?`, [fakeHash('aa')]),
  ).rejects.toThrow(/CHECK/);
});

test('a payment just signed keeps its nonce and is not finalized', async () => {
  await saveSignedPayment(db, signedAs('aa', 42), newPayment(payer), sepoliaNetwork, 1);
  expect(await db.getAllAsync(`SELECT nonce, finalized FROM sent_payments`, [])).toEqual([
    { nonce: 42, finalized: 0 },
  ]);
});

// Only a transaction that entered a block can have its block finalized.
test('a payment without a block cannot be marked finalized', async () => {
  await saveSignedPayment(db, signedAs('aa'), newPayment(payer), sepoliaNetwork, 1);
  await expect(
    db.runAsync(`UPDATE sent_payments SET finalized = 1 WHERE hash = ?`, [fakeHash('aa')]),
  ).rejects.toThrow(/CHECK/);
});

test('a payment with a block can be marked finalized', async () => {
  await saveSignedPayment(db, signedAs('aa'), newPayment(payer), sepoliaNetwork, 1);
  await settleSentPayment(db, fakeHash('aa'), mined('success', 123n));
  await db.runAsync(`UPDATE sent_payments SET finalized = 1 WHERE hash = ?`, [fakeHash('aa')]);
  expect(await db.getAllAsync(`SELECT finalized FROM sent_payments`, [])).toEqual([
    { finalized: 1 },
  ]);
});

// A row is visited again while its status is not final.
test('the rows to resolve are the unfinished ones', async () => {
  for (const [byte, status] of [
    ['aa', 'signed'],
    ['bb', 'pending'],
    ['cc', 'lost'],
    ['dd', 'queued'],
    ['ee', 'rejected'],
    ['ff', 'replaced'],
  ] as const) {
    await saveSignedPayment(db, signedAs(byte), newPayment(payer), sepoliaNetwork, 1);
    if (status !== 'signed') await setSentPaymentStatus(db, fakeHash(byte), status);
  }
  await saveSignedPayment(db, signedAs('11'), newPayment(payer), sepoliaNetwork, 1);
  await settleSentPayment(db, fakeHash('11'), mined('success', 5n));
  await saveSignedPayment(db, signedAs('33'), newPayment(otherPayer), sepoliaNetwork, 1);

  const toResolve = await listPaymentsToResolve(db, payer, sepoliaNetwork);

  expect(toResolve.map((row) => row.hash).sort()).toEqual(
    [fakeHash('aa'), fakeHash('bb'), fakeHash('cc'), fakeHash('dd')].sort(),
  );
});

test('a reverted payment keeps the guard that fired, and its gas and price', async () => {
  await saveSignedPayment(db, signedAs('aa'), newPayment(payer), sepoliaNetwork, 1);
  await settleSentPayment(db, fakeHash('aa'), mined('reverted', 9n, 'AlreadyPaid'));
  const [sent] = await listSentPayments(db, payer, sepoliaNetwork);
  expect(sent?.revertReason).toBe('AlreadyPaid');
  expect(
    await db.getAllAsync('SELECT gas_used, effective_gas_price FROM sent_payments', []),
  ).toEqual([{ gas_used: 50_000, effective_gas_price: 7 }]);
});

test('a row that did not revert cannot carry a revert reason', async () => {
  await saveSignedPayment(db, signedAs('aa'), newPayment(payer), sepoliaNetwork, 1);
  await expect(
    settleSentPayment(db, fakeHash('aa'), mined('success', 9n, 'AlreadyPaid')),
  ).rejects.toThrow(/CHECK/);
});

// Rows `aa` and `bb` are mined at blocks 10 and 20; `cc` has no block; `dd` is another payer's.
test('marking up to a block finalizes the mined rows at or below it, and only those', async () => {
  for (const byte of ['aa', 'bb', 'cc']) {
    await saveSignedPayment(db, signedAs(byte), newPayment(payer), sepoliaNetwork, 1);
  }
  await saveSignedPayment(db, signedAs('dd'), newPayment(otherPayer), sepoliaNetwork, 1);
  await settleSentPayment(db, fakeHash('aa'), mined('success', 10n));
  await settleSentPayment(db, fakeHash('bb'), mined('reverted', 20n, 'AlreadyPaid'));
  await settleSentPayment(db, fakeHash('dd'), mined('success', 10n));
  expect(await hasUnfinalizedPayments(db, payer, sepoliaNetwork)).toBe(true);

  await markFinalizedUpTo(db, payer, sepoliaNetwork, 15n);
  const after15 = await listSentPayments(db, payer, sepoliaNetwork);
  expect(after15.map((sent) => [sent.hash, sent.finalized])).toEqual(
    expect.arrayContaining([
      [fakeHash('aa'), true],
      [fakeHash('bb'), false],
      [fakeHash('cc'), false],
    ]),
  );

  await markFinalizedUpTo(db, payer, sepoliaNetwork, 20n);
  expect(await hasUnfinalizedPayments(db, payer, sepoliaNetwork)).toBe(false);
  const [other] = await listSentPayments(db, otherPayer, sepoliaNetwork);
  expect(other?.finalized).toBe(false);
});

// Two readings of the same blocks at once both try to keep the payment: the second does nothing.
test('a found payment already kept is left as it is', async () => {
  const payment = newPayment(payer);
  await saveFoundPayment(db, signedAs('aa'), payment, sepoliaNetwork, 1, mined('success', 5n));
  await saveFoundPayment(db, signedAs('aa'), payment, sepoliaNetwork, 2, mined('success', 5n));
  const listed = await listSentPayments(db, payer, sepoliaNetwork);
  expect(listed.map((sent) => [sent.hash, sent.status, sent.sentAt])).toEqual([
    [fakeHash('aa'), 'success', 1],
  ]);
  expect(await statusOfSentPayment(db, fakeHash('aa'))).toBe('success');
  expect(await statusOfSentPayment(db, fakeHash('bb'))).toBeNull();
});
