import { beforeEach, expect, test } from 'vitest';
import { lineaSepolia, sepolia } from 'viem/chains';
import type { Database } from '../database/database';
import { memoryDatabase } from '../database/memoryDatabase';
import { migrate } from '../database/migrations';
import type { Network } from '../network/network';
import { readCursor, saveCursor, startCursor } from './cursors';

// Port 1 on this machine has nothing listening: any call to the node fails.
const sepoliaNetwork: Network = {
  chain: lineaSepolia,
  rpcUrl: 'http://127.0.0.1:1',
  paymentsAddress: '0x3333333333333333333333333333333333333333',
  deployBlock: 1000n,
  l1Chain: sepolia,
  l1RpcUrl: 'https://unused.invalid',
};

const account = '0x1111111111111111111111111111111111111111' as const;

let db: Database;

beforeEach(async () => {
  db = memoryDatabase();
  await migrate(db);
});

test('an account without a cursor reads as null', async () => {
  expect(await readCursor(db, account, sepoliaNetwork)).toBeNull();
});

test('a saved cursor comes back, and saving again moves it', async () => {
  await saveCursor(db, account, sepoliaNetwork, 1500n);
  expect(await readCursor(db, account, sepoliaNetwork)).toBe(1500n);
  await saveCursor(db, account, sepoliaNetwork, 3500n);
  expect(await readCursor(db, account, sepoliaNetwork)).toBe(3500n);
});

// The same account on another contract has not been read there at all.
test('a cursor belongs to one contract', async () => {
  await saveCursor(db, account, sepoliaNetwork, 1500n);
  const otherContract = { ...sepoliaNetwork, paymentsAddress: account };
  expect(await readCursor(db, account, otherContract)).toBeNull();
});

// The unreachable node shows the history answer needs no call.
test('with the history, the first cursor is the deploy block', async () => {
  await startCursor(db, account, sepoliaNetwork, true);
  expect(await readCursor(db, account, sepoliaNetwork)).toBe(1000n);
});
