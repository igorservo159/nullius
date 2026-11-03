// What the integration tests share: anvil standing for Linea Sepolia and its L1, with Payments
// deployed by `anvil.setup.ts`, a client that drives it, and a key store holding one key.

import { createTestClient, http, type Hex, type TestClient } from 'viem';
import { lineaSepolia } from 'viem/chains';
import type { SecretStore } from './accounts/accounts';
import type { Network } from './network/network';

/**
 * The network on the anvil `inject('anvil')` gives. anvil stands for the L1 too: one node, Linea
 * Sepolia's chain id. Without anvil (null) the fields are empty, and the tests that use it skip.
 */
export function anvilNetwork(
  anvil: { rpcUrl: string; paymentsAddress: Hex; deployBlock: number } | null,
): Network {
  return {
    chain: lineaSepolia,
    rpcUrl: anvil?.rpcUrl ?? '',
    paymentsAddress: anvil?.paymentsAddress ?? '0x',
    deployBlock: BigInt(anvil?.deployBlock ?? 0),
    l1Chain: lineaSepolia,
    l1RpcUrl: anvil?.rpcUrl ?? '',
  };
}

/** A client that mines, snapshots and reverts the anvil behind `network`. */
export function anvilClient(network: Network): TestClient {
  return createTestClient({ mode: 'anvil', chain: lineaSepolia, transport: http(network.rpcUrl) });
}

/** A key store that answers every read with `key`, and keeps nothing it is given. */
export function keyStore(key: Hex): SecretStore {
  return { get: async () => key, set: async () => {}, remove: async () => {} };
}
