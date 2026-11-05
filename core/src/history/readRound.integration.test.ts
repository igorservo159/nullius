// `readRound` against anvil: a charge paid on the chain is found paid in one round and found
// finalized in a later one. Run with `npm run test:integration`.

import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvilPayerKey } from '../anvil.setup';
import { anvilClient, anvilNetwork, keyStore } from '../anvilNetwork';
import { orderId, type Charge } from '../charges/rules';
import { saveCharge } from '../charges/storage';
import type { Database } from '../database/database';
import { memoryDatabase } from '../database/memoryDatabase';
import { migrate } from '../database/migrations';
import { sendSignedPayment, signPayment, waitForPayment } from '../payments/chain';
import { saveCursor } from './cursors';
import { readRound } from './readRound';

const anvil = inject('anvil');

const payee = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const payer = privateKeyToAccount(anvilPayerKey).address;
const valueWei = 10n ** 15n;

describe.skipIf(anvil === null)('readRound on anvil', () => {
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

  // anvil keeps its finalized block 64 behind the latest one.
  test('a charge paid on the chain is paid in one round and finalized in a later one', async () => {
    const salt: Hex = `0x${'11'.repeat(32)}`;
    const charge: Charge = { payee, valueWei, salt, orderId: orderId(payee, valueWei, salt) };
    await saveCharge(db, charge, network, 1);
    await saveCursor(db, payee, network, network.deployBlock);
    const transaction = await signPayment(keyStore(anvilPayerKey), network, { ...charge, payer });
    await sendSignedPayment(network, transaction.signed);
    await waitForPayment(network, transaction.hash);

    const first = await readRound(db, network, payee);
    expect(first.paid.map((paid) => paid.orderId)).toEqual([charge.orderId]);
    expect(first.finalized).toEqual([]);

    await chain.mine({ blocks: 64 });
    const later = await readRound(db, network, payee);
    expect(later.paid).toEqual([]);
    expect(later.finalized).toMatchObject([{ orderId: charge.orderId, paidFinalized: true }]);
  });
});
