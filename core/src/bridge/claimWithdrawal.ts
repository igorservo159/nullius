// Claiming a withdrawal on the L1: what the bridge tab runs when the user taps a claimable one.

import type { SecretStore } from '../accounts/accounts';
import type { Network } from '../network/network';
import { NodeRejected, SendUnanswered } from '../transactions/transactions';
import { sendSignedClaim, signClaim, waitForClaim } from './claim';
import type { Transfer } from './storage';

/**
 * Proves, signs and sends the claim of `withdrawal` on the L1, and returns once it is in a block
 * there. The claim is not kept on the phone: the L1 contract records it, and `resolveTransfers`
 * reads from there that the message was claimed. A node that answers with an error throws
 * `NodeRejected`; one that does not answer throws `SendUnanswered`, and the next look finds the
 * withdrawal claimed or still claimable.
 */
export async function claimWithdrawal(
  store: SecretStore,
  network: Network,
  withdrawal: Transfer,
): Promise<void> {
  const signed = await signClaim(store, network, withdrawal);
  try {
    await sendSignedClaim(network, signed.signed);
  } catch (error) {
    throw error instanceof NodeRejected ? error : new SendUnanswered(error);
  }
  await waitForClaim(network, signed.hash);
}
