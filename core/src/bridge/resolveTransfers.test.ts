import { expect, test } from 'vitest';
import type { Hex } from 'viem';
import { linea, lineaSepolia, mainnet, sepolia } from 'viem/chains';
import { memoryDatabase } from '../database/memoryDatabase';
import { migrate } from '../database/migrations';
import type { Network } from '../network/network';
import { resolveTransfers } from './resolveTransfers';
import { saveSignedTransfer, setTransferStatus } from './storage';

function networkOn(chain: typeof linea | typeof lineaSepolia): Network {
  return {
    chain,
    rpcUrl: 'https://unused.invalid',
    paymentsAddress: '0x3333333333333333333333333333333333333333',
    deployBlock: 0n,
    l1Chain: chain.id === linea.id ? mainnet : sepolia,
    l1RpcUrl: 'https://unused.invalid',
  };
}

// Both nodes are `unused.invalid`, a name that never resolves: any call to them fails. A transfer
// with a final status is not looked at, so nothing is asked.
test('with no transfer left to resolve, no node is asked', async () => {
  const db = memoryDatabase();
  await migrate(db);
  const account = '0x1111111111111111111111111111111111111111' as const;
  const hash: Hex = `0x${'aa'.repeat(32)}`;
  const transfer = { direction: 'deposit' as const, account, valueWei: 1n, feeWei: 0n };
  await saveSignedTransfer(db, { hash, nonce: 0 }, transfer, networkOn(lineaSepolia), 1);
  await setTransferStatus(db, hash, 'claimed');

  await expect(resolveTransfers(db, networkOn(lineaSepolia), account)).resolves.toBeUndefined();
});
