import { beforeEach, expect, test } from 'vitest';
import { lineaSepolia, sepolia } from 'viem/chains';
import type { Database } from '../database/database';
import { memoryDatabase } from '../database/memoryDatabase';
import { migrate } from '../database/migrations';
import type { Network } from '../network/network';
import { createCharge } from './createCharge';
import { decodeCharge } from './rules';
import { listCharges } from './storage';

const network: Network = {
  chain: lineaSepolia,
  rpcUrl: 'https://unused.invalid',
  paymentsAddress: '0x3333333333333333333333333333333333333333',
  deployBlock: 0n,
  l1Chain: sepolia,
  l1RpcUrl: 'https://unused.invalid',
};

const payee = '0x1111111111111111111111111111111111111111';

let db: Database;

beforeEach(async () => {
  db = memoryDatabase();
  await migrate(db);
});

test('a created charge is kept, and its text decodes to its fields', async () => {
  const { text, ...charge } = await createCharge(db, network, payee, 1000n, 7);
  expect(await listCharges(db, payee, network)).toEqual([
    { ...charge, createdAt: 7, paidHash: null, paidBlock: null, paidFinalized: false },
  ]);
  expect(decodeCharge(text, network)).toEqual(charge);
});

test('two charges of one payee and amount get different salts and order ids', async () => {
  const first = await createCharge(db, network, payee, 1000n, 1);
  const second = await createCharge(db, network, payee, 1000n, 2);
  expect(second.salt).not.toBe(first.salt);
  expect(second.orderId).not.toBe(first.orderId);
});

test('a charge of zero is refused and nothing is kept', async () => {
  await expect(createCharge(db, network, payee, 0n, 1)).rejects.toThrow('more than zero');
  expect(await listCharges(db, payee, network)).toEqual([]);
});
