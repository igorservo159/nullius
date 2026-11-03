// Claiming a withdrawal on the L1: the transaction that hands the account, on the L1, the value
// its message carries, once Linea finalized the block that sent it.

import { encodeFunctionData, zeroAddress, type Hex } from 'viem';
import { readPrivateKey, type SecretStore } from '../accounts/accounts';
import {
  l1MessageServiceAbi,
  messageServiceAbi,
  messageServicesOf,
} from '../contracts/lineaMessageService';
import { l1ReaderFor, readerFor, type Network } from '../network/network';
import {
  checkNothingInFlight,
  sendSignedBytes,
  signOn,
  type SignedTransaction,
} from '../transactions/transactions';
import { messageProof } from './proof';
import type { Transfer } from './storage';

/**
 * The message as Linea's L2 contract emitted it in `MessageSent`, read from the withdrawal's
 * block. A claim names these fields, and the L1 contract hashes them into the leaf it checks; the
 * fee in particular is not the one the withdrawal paid: the L2 contract keeps its minimum fee and
 * puts in the message only what was paid above it.
 */
async function sentMessage(network: Network, blockNumber: bigint, messageHash: Hex) {
  const [sent] = await readerFor(network).getContractEvents({
    address: messageServicesOf(network.chain.id).l2,
    abi: messageServiceAbi,
    eventName: 'MessageSent',
    args: { _messageHash: messageHash },
    strict: true,
    fromBlock: blockNumber,
    toBlock: blockNumber,
  });
  if (sent === undefined) {
    throw new Error(`no MessageSent of ${messageHash} in block ${blockNumber}`);
  }
  return sent.args;
}

/**
 * Signs the claim of `withdrawal` on the L1, without sending it.
 *
 * The message's fields are read from Linea, as it emitted them. The fee recipient is the zero
 * address, which makes the contract pay the message's fee, if it has any, to whoever sends the
 * claim: the account itself.
 *
 * The proof is built first, then the claim is simulated from the address alone and the account's
 * L1 transactions are checked for one in flight, all before the key is read: a claim already made,
 * or one Linea's L1 limit on withdrawals refuses, never asks for a fingerprint.
 */
export async function signClaim(
  store: SecretStore,
  network: Network,
  withdrawal: Transfer,
): Promise<SignedTransaction> {
  const { account, blockNumber, messageHash } = withdrawal;
  if (withdrawal.direction !== 'withdrawal' || blockNumber === null || messageHash === null) {
    throw new Error(`${withdrawal.hash} is not a withdrawal with its message recorded`);
  }
  const message = await sentMessage(network, blockNumber, messageHash);
  const proof = await messageProof(network, blockNumber, messageHash);
  const call = {
    address: messageServicesOf(network.chain.id).l1,
    abi: l1MessageServiceAbi,
    functionName: 'claimMessageWithProof',
    args: [
      {
        proof: proof.proof,
        messageNumber: message._nonce,
        leafIndex: proof.leafIndex,
        from: message._from,
        to: message._to,
        fee: message._fee,
        value: message._value,
        feeRecipient: zeroAddress,
        merkleRoot: proof.root,
        data: message._calldata,
      },
    ],
  } as const;
  const reader = l1ReaderFor(network);
  await reader.simulateContract({ ...call, account });
  await checkNothingInFlight(reader, account);

  return signOn(await readPrivateKey(store, account), network.l1Chain, network.l1RpcUrl, {
    to: call.address,
    data: encodeFunctionData(call),
    value: 0n,
  });
}

/** Hands the signed claim to the L1 node, once, as `sendSignedPayment` does on Linea. */
export async function sendSignedClaim(network: Network, signed: Hex): Promise<void> {
  await sendSignedBytes(l1ReaderFor(network), signed);
}

/** Waits for the claim's block on the L1; a claim that reverted there is an error. */
export async function waitForClaim(network: Network, hash: Hex): Promise<void> {
  const receipt = await l1ReaderFor(network).waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`the claim ${hash} reverted on the L1`);
}
