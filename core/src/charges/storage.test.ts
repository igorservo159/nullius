import { beforeEach, expect, test } from 'vitest';
import { linea, lineaSepolia, sepolia } from 'viem/chains';
import type { Database } from '../database/database';
import { memoryDatabase } from '../database/memoryDatabase';
import { migrate } from '../database/migrations';
import type { Network } from '../network/network';
import { orderId, randomSalt, type Charge } from './rules';
import {
  findCharge,
  hasUnfinalizedCharges,
  listCharges,
  listPaidUpTo,
  markChargeFinalized,
  markChargePaid,
  saveCharge,
  saveRecoveredCharge,
} from './storage';

const sepoliaNetwork: Network = {
  chain: lineaSepolia,
  rpcUrl: 'https://unused.invalid',
  paymentsAddress: '0x3333333333333333333333333333333333333333',
  deployBlock: 0n,
  l1Chain: sepolia,
  l1RpcUrl: 'https://unused.invalid',
};

const payee = '0x1111111111111111111111111111111111111111';
const otherPayee = '0x2222222222222222222222222222222222222222';

function newCharge(chargePayee: Charge['payee'], valueWei: bigint): Charge {
  const salt = randomSalt();
  return { payee: chargePayee, valueWei, salt, orderId: orderId(chargePayee, valueWei, salt) };
}

let db: Database;

beforeEach(async () => {
  db = memoryDatabase();
  await migrate(db);
});

test('a saved charge comes back in the list', async () => {
  const charge = newCharge(payee, 1000n);
  await saveCharge(db, charge, sepoliaNetwork, 1);
  expect(await listCharges(db, payee, sepoliaNetwork)).toEqual([
    { ...charge, createdAt: 1, paidHash: null, paidBlock: null, paidFinalized: false },
  ]);
});

test('the list is newest first', async () => {
  const older = newCharge(payee, 1n);
  const newer = newCharge(payee, 2n);
  await saveCharge(db, older, sepoliaNetwork, 100);
  await saveCharge(db, newer, sepoliaNetwork, 200);
  const listed = await listCharges(db, payee, sepoliaNetwork);
  expect(listed.map((stored) => stored.orderId)).toEqual([newer.orderId, older.orderId]);
});

test('the list holds only the charges of that payee on that network', async () => {
  const mine = newCharge(payee, 1n);
  await saveCharge(db, mine, sepoliaNetwork, 1);
  await saveCharge(db, newCharge(otherPayee, 1n), sepoliaNetwork, 2);
  await saveCharge(db, newCharge(payee, 1n), { ...sepoliaNetwork, chain: linea }, 3);
  const otherContract = { ...sepoliaNetwork, paymentsAddress: otherPayee } as const;
  await saveCharge(db, newCharge(payee, 1n), otherContract, 4);

  const listed = await listCharges(db, payee, sepoliaNetwork);
  expect(listed.map((stored) => stored.orderId)).toEqual([mine.orderId]);
});

test('the same order id cannot be saved twice', async () => {
  const charge = newCharge(payee, 1n);
  await saveCharge(db, charge, sepoliaNetwork, 1);
  await expect(saveCharge(db, charge, sepoliaNetwork, 2)).rejects.toThrow(/UNIQUE/);
});

// 2^255 wei is far beyond the 64-bit INTEGER that a numeric column would have held.
test('an amount beyond 64 bits comes back exact', async () => {
  const charge = newCharge(payee, 2n ** 255n);
  await saveCharge(db, charge, sepoliaNetwork, 1);
  const [stored] = await listCharges(db, payee, sepoliaNetwork);
  expect(stored?.valueWei).toBe(2n ** 255n);
});

const payingHash: `0x${string}` = `0x${'aa'.repeat(32)}`;

test('a charge marked paid keeps the transaction and block that paid it', async () => {
  const charge = newCharge(payee, 1000n);
  await saveCharge(db, charge, sepoliaNetwork, 1);
  await markChargePaid(db, sepoliaNetwork, charge.orderId, payingHash, 77n);
  const [stored] = await listCharges(db, payee, sepoliaNetwork);
  expect(stored).toMatchObject({ paidHash: payingHash, paidBlock: 77n });
});

// The contract pays an order id once; a second mark, from reading the same blocks again, is
// ignored, and the first one stays.
test('a charge already paid keeps its first mark', async () => {
  const charge = newCharge(payee, 1000n);
  await saveCharge(db, charge, sepoliaNetwork, 1);
  await markChargePaid(db, sepoliaNetwork, charge.orderId, payingHash, 77n);
  await markChargePaid(db, sepoliaNetwork, charge.orderId, `0x${'bb'.repeat(32)}`, 88n);
  const [stored] = await listCharges(db, payee, sepoliaNetwork);
  expect(stored).toMatchObject({ paidHash: payingHash, paidBlock: 77n });
});

test('a charge on another contract is not marked', async () => {
  const charge = newCharge(payee, 1000n);
  await saveCharge(db, charge, sepoliaNetwork, 1);
  const otherContract = { ...sepoliaNetwork, paymentsAddress: otherPayee } as const;
  await markChargePaid(db, otherContract, charge.orderId, payingHash, 77n);
  const [stored] = await listCharges(db, payee, sepoliaNetwork);
  expect(stored?.paidHash).toBeNull();
});

test('a charge cannot have a paying hash without its block', async () => {
  const charge = newCharge(payee, 1000n);
  await saveCharge(db, charge, sepoliaNetwork, 1);
  await expect(
    db.runAsync('UPDATE charges SET paid_hash = ? WHERE order_id = ?', [payingHash, charge.orderId]),
  ).rejects.toThrow(/CHECK/);
});

test('finding a charge says whether it is kept and what paid it', async () => {
  const charge = newCharge(payee, 1000n);
  expect(await findCharge(db, sepoliaNetwork, charge.orderId)).toBeNull();
  await saveCharge(db, charge, sepoliaNetwork, 1);
  expect(await findCharge(db, sepoliaNetwork, charge.orderId)).toEqual({ paidHash: null });
  await markChargePaid(db, sepoliaNetwork, charge.orderId, payingHash, 77n);
  expect(await findCharge(db, sepoliaNetwork, charge.orderId)).toEqual({ paidHash: payingHash });
});

test('a recovered charge is kept as paid, and recovering it again changes nothing', async () => {
  const charge = newCharge(payee, 1000n);
  await saveRecoveredCharge(db, charge, sepoliaNetwork, 5, payingHash, 77n);
  await saveRecoveredCharge(db, charge, sepoliaNetwork, 9, `0x${'bb'.repeat(32)}`, 88n);
  expect(await listCharges(db, payee, sepoliaNetwork)).toEqual([
    { ...charge, createdAt: 5, paidHash: payingHash, paidBlock: 77n, paidFinalized: false },
  ]);
});

// Charges `a` and `b` are paid at blocks 10 and 20; `c` waits; `d`, another payee's, is paid at 10.
test('the paid charges up to a block are listed until marked finalized', async () => {
  const [a, b, c] = [newCharge(payee, 1n), newCharge(payee, 2n), newCharge(payee, 3n)];
  const d = newCharge(otherPayee, 4n);
  for (const charge of [a, b, c, d]) await saveCharge(db, charge, sepoliaNetwork, 1);
  await markChargePaid(db, sepoliaNetwork, a.orderId, payingHash, 10n);
  await markChargePaid(db, sepoliaNetwork, b.orderId, `0x${'bb'.repeat(32)}`, 20n);
  await markChargePaid(db, sepoliaNetwork, d.orderId, `0x${'dd'.repeat(32)}`, 10n);

  expect(await listPaidUpTo(db, payee, sepoliaNetwork, 15n)).toEqual([a.orderId]);

  await markChargeFinalized(db, sepoliaNetwork, a.orderId);
  expect(await listPaidUpTo(db, payee, sepoliaNetwork, 15n)).toEqual([]);
  expect(await hasUnfinalizedCharges(db, payee, sepoliaNetwork)).toBe(true);
  const listed = await listCharges(db, payee, sepoliaNetwork);
  expect(listed.find((stored) => stored.orderId === a.orderId)?.paidFinalized).toBe(true);

  await markChargeFinalized(db, sepoliaNetwork, b.orderId);
  expect(await hasUnfinalizedCharges(db, payee, sepoliaNetwork)).toBe(false);
});

test('a charge cannot be finalized before it is paid', async () => {
  const charge = newCharge(payee, 1000n);
  await saveCharge(db, charge, sepoliaNetwork, 1);
  await expect(markChargeFinalized(db, sepoliaNetwork, charge.orderId)).rejects.toThrow(/CHECK/);
});
