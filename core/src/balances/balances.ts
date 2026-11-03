// What an account holds on the network in use (L2) and on the Ethereum chain it settles on (L1).

import type { Address } from 'viem';
import { l1ReaderFor, readerFor, type Network } from '../network/network';

/** One balance as the node gave it, in wei, or why it could not be read. */
export type Balance = { wei: bigint } | { error: string };

// What the screen shows for a failed read: viem's first line, without its documentation links.
function errorTextOf(reason: unknown): string {
  if (reason instanceof Error) {
    return (reason as Error & { shortMessage?: string }).shortMessage ?? reason.message;
  }
  return String(reason);
}

/**
 * The account's balance on L2 and on L1, read at once. Each one is read on its own node and
 * reported on its own: an L1 node that fails leaves the L2 balance shown.
 */
export async function balancesOf(
  network: Network,
  address: Address,
): Promise<{ l2: Balance; l1: Balance }> {
  const [l2, l1] = await Promise.allSettled([
    readerFor(network).getBalance({ address }),
    l1ReaderFor(network).getBalance({ address }),
  ]);
  return {
    l2: l2.status === 'fulfilled' ? { wei: l2.value } : { error: errorTextOf(l2.reason) },
    l1: l1.status === 'fulfilled' ? { wei: l1.value } : { error: errorTextOf(l1.reason) },
  };
}
