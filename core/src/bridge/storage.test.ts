import { beforeEach, expect, test } from 'vitest';
import type { Hex } from 'viem';
import { lineaSepolia, sepolia } from 'viem/chains';
import type { Database } from '../database/database';
import { memoryDatabase } from '../database/memoryDatabase';
import { migrate } from '../database/migrations';
import type { Network } from '../network/network';
import {
  listTransfers,
  listTransfersToResolve,
  recordTransferMessage,
  recordTransferReverted,
  saveSignedTransfer,
  setTransferStatus,
} from './storage';

const sepoliaNetwork: Network = {
  chain: lineaSepolia,
  rpcUrl: 'https://unused.invalid',
  paymentsAddress: '0x3333333333333333333333333333333333333333',
  deployBlock: 0n,
  l1Chain: sepolia,
  l1RpcUrl: 'https://unused.invalid',
};

const account = '0x1111111111111111111111111111111111111111' as const;
const other = '0x2222222222222222222222222222222222222222' as const;

function fakeHash(byte: string): Hex {
  return `0x${byte.repeat(32)}`;
}

// Keeps a withdrawal of 0.001 ETH with a 0.0001 ETH fee, signed with `nonce`.
function keepWithdrawal(byte: string, nonce: number, from: Hex, sentAt: number) {
  const transfer = { direction: 'withdrawal' as const, account: from, valueWei: 10n ** 15n };
  return saveSignedTransfer(
    db,
    { hash: fakeHash(byte), nonce },
    { ...transfer, feeWei: 10n ** 14n },
    sepoliaNetwork,
    sentAt,
  );
}

let db: Database;

beforeEach(async () => {
  db = memoryDatabase();
  await migrate(db);
});

test('a transfer just signed is kept as signed, with its nonce and no message yet', async () => {
  await keepWithdrawal('aa', 4, account, 1);
  expect(await listTransfers(db, account, sepoliaNetwork)).toEqual([
    {
      hash: fakeHash('aa'),
      direction: 'withdrawal',
      account,
      valueWei: 10n ** 15n,
      feeWei: 10n ** 14n,
      nonce: 4,
      status: 'signed',
      blockNumber: null,
      messageHash: null,
      messageNonce: null,
      sentAt: 1,
    },
  ]);
});

// The row is left `lost`, as a check that missed the transaction would leave it: finding its
// block says it was sent after all.
test("the transfer's block and message are written to its row, which becomes sent", async () => {
  await keepWithdrawal('aa', 4, account, 1);
  await setTransferStatus(db, fakeHash('aa'), 'lost');
  await recordTransferMessage(db, fakeHash('aa'), {
    blockNumber: 77n,
    messageHash: fakeHash('bb'),
    messageNonce: 9n,
  });
  const [kept] = await listTransfers(db, account, sepoliaNetwork);
  expect(kept).toMatchObject({
    status: 'sent',
    blockNumber: 77n,
    messageHash: fakeHash('bb'),
    messageNonce: 9n,
  });
});

test('a reverted transfer keeps its block and no message', async () => {
  await keepWithdrawal('aa', 4, account, 1);
  await recordTransferReverted(db, fakeHash('aa'), 77n);
  const [kept] = await listTransfers(db, account, sepoliaNetwork);
  expect(kept).toMatchObject({ status: 'reverted', blockNumber: 77n, messageHash: null });
});

test('only the transfers with no final status are left to resolve, oldest first', async () => {
  const statuses = [
    'sent',
    'rejected',
    'claimable',
    'replaced',
    'claimed',
    'queued',
    'pending',
  ] as const;
  for (const [index, status] of statuses.entries()) {
    const byte = `${index + 1}`.repeat(2);
    await keepWithdrawal(byte, index, account, index);
    await setTransferStatus(db, fakeHash(byte), status);
  }
  await keepWithdrawal('88', 7, account, 7);
  await keepWithdrawal('99', 8, other, 8);
  const toResolve = await listTransfersToResolve(db, account, sepoliaNetwork);
  expect(toResolve.map((transfer) => [transfer.hash, transfer.status])).toEqual([
    [fakeHash('11'), 'sent'],
    [fakeHash('33'), 'claimable'],
    [fakeHash('66'), 'queued'],
    [fakeHash('77'), 'pending'],
    [fakeHash('88'), 'signed'],
  ]);
});

test("the list holds only the account's transfers, newest first", async () => {
  await keepWithdrawal('aa', 1, account, 1);
  await keepWithdrawal('bb', 2, account, 2);
  await keepWithdrawal('cc', 1, other, 3);
  const listed = await listTransfers(db, account, sepoliaNetwork);
  expect(listed.map((transfer) => transfer.hash)).toEqual([fakeHash('bb'), fakeHash('aa')]);
});

test('a status outside the list is refused by the table', async () => {
  await keepWithdrawal('aa', 1, account, 1);
  await expect(
    db.runAsync(`UPDATE bridge_transfers SET status = 'success' WHERE hash = ?`, [fakeHash('aa')]),
  ).rejects.toThrow(/CHECK/);
});
