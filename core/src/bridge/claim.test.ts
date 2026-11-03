import { expect, test } from 'vitest';
import { lineaSepolia, sepolia } from 'viem/chains';
import type { Network } from '../network/network';
import { signClaim } from './claim';
import type { Transfer } from './storage';

// Both nodes are `unused.invalid`, a name that never resolves: a claim refused before any call
// is refused for what the row says, not for the node.
const network: Network = {
  chain: lineaSepolia,
  rpcUrl: 'https://unused.invalid',
  paymentsAddress: '0x3333333333333333333333333333333333333333',
  deployBlock: 0n,
  l1Chain: sepolia,
  l1RpcUrl: 'https://unused.invalid',
};

const withdrawal: Transfer = {
  hash: `0x${'aa'.repeat(32)}`,
  direction: 'withdrawal',
  account: '0x1111111111111111111111111111111111111111',
  valueWei: 10n ** 15n,
  feeWei: 10n ** 14n,
  nonce: 4,
  status: 'claimable',
  blockNumber: 77n,
  messageHash: `0x${'bb'.repeat(32)}`,
  messageNonce: 9n,
  sentAt: 1,
};

// The store is never reached: these claims stop before the key is read.
const noStore = {} as Parameters<typeof signClaim>[0];

test('a deposit is not claimed on the L1', async () => {
  await expect(signClaim(noStore, network, { ...withdrawal, direction: 'deposit' })).rejects.toThrow(
    /not a withdrawal with its message recorded/,
  );
});

test('a withdrawal whose message is not recorded yet cannot be claimed', async () => {
  await expect(signClaim(noStore, network, { ...withdrawal, messageHash: null })).rejects.toThrow(
    /not a withdrawal with its message recorded/,
  );
});
