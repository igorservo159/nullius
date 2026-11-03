import { beforeEach, expect, test } from 'vitest';
import { lineaSepolia, sepolia } from 'viem/chains';
import { orderId, randomSalt } from '../charges/rules';
import type { Database } from '../database/database';
import { memoryDatabase } from '../database/memoryDatabase';
import { migrate } from '../database/migrations';
import type { Network } from '../network/network';
import { markFinalized } from './resolution';
import { saveSignedPayment } from './storage';

// Port 1 on this machine has nothing listening: any call to the node fails.
const unreachable: Network = {
  chain: lineaSepolia,
  rpcUrl: 'http://127.0.0.1:1',
  paymentsAddress: '0x3333333333333333333333333333333333333333',
  deployBlock: 0n,
  l1Chain: sepolia,
  l1RpcUrl: 'https://unused.invalid',
};

const payer = '0x1111111111111111111111111111111111111111' as const;
const payee = '0x2222222222222222222222222222222222222222' as const;

let db: Database;

beforeEach(async () => {
  db = memoryDatabase();
  await migrate(db);
});

// A payment only signed has no block: there is nothing to finalize, so the node is not asked,
// and the unreachable node cannot make it fail.
test('with no mined payment left to mark, the node is not asked', async () => {
  const salt = randomSalt();
  const payment = { payer, payee, valueWei: 1n, salt, orderId: orderId(payee, 1n, salt) };
  await saveSignedPayment(db, { hash: `0x${'aa'.repeat(32)}`, nonce: 0 }, payment, unreachable, 1);

  await expect(markFinalized(db, unreachable, payer)).resolves.toBeUndefined();
});
