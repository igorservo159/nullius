// Moving ETH between the L1 and Linea through Linea's canonical message service: the same
// `sendMessage` on both sides, and on L2 a postman that claims deposits by itself.

import {
  encodeFunctionData,
  isAddressEqual,
  parseEventLogs,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
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
import { transferMaximum } from './rules';
import type { TransferDirection } from './storage';

/**
 * The layer a transfer leaves from: its reader, chain and node, and the message service there.
 * A deposit leaves the L1, a withdrawal leaves Linea.
 */
export function originOf(network: Network, direction: TransferDirection) {
  const services = messageServicesOf(network.chain.id);
  return direction === 'deposit'
    ? {
        reader: l1ReaderFor(network),
        chain: network.l1Chain,
        rpcUrl: network.l1RpcUrl,
        messageService: services.l1,
      }
    : {
        reader: readerFor(network),
        chain: network.chain,
        rpcUrl: network.rpcUrl,
        messageService: services.l2,
      };
}

/**
 * The fee a transfer's message pays. A deposit pays none: Linea's postman claims on L2, at
 * Linea's cost, a message that needs less than 250,000 gas, and a transfer with no data does. A
 * withdrawal pays the minimum Linea's L2 contract asks now, read at every withdrawal, and no
 * more: nothing is left for a third party to claim it, since the app claims it itself.
 */
export async function transferFee(network: Network, direction: TransferDirection): Promise<bigint> {
  if (direction === 'deposit') return 0n;
  return readerFor(network).readContract({
    address: messageServicesOf(network.chain.id).l2,
    abi: messageServiceAbi,
    functionName: 'minimumFeeInWei',
  });
}

/**
 * `transferMaximum` for `account` now, on the origin layer of `direction`. Gas and its price are
 * prepared as `signOn` prepares them, for a transfer of one wei: a message with no data costs the
 * same gas whatever the amount.
 */
export async function maximumTransfer(
  network: Network,
  account: Address,
  direction: TransferDirection,
): Promise<bigint> {
  const origin = originOf(network, direction);
  const feeWei = await transferFee(network, direction);
  const [balanceWei, prepared] = await Promise.all([
    origin.reader.getBalance({ address: account }),
    origin.reader.prepareTransactionRequest({
      account,
      chain: origin.chain,
      to: origin.messageService,
      data: encodeFunctionData({
        abi: messageServiceAbi,
        functionName: 'sendMessage',
        args: [account, feeWei, '0x'],
      }),
      value: feeWei + 1n,
    }),
  ]);
  return transferMaximum(balanceWei, feeWei, prepared.gas * prepared.maxFeePerGas);
}

/** A transfer signed and not yet sent, with the fee its message carries. */
export type SignedTransfer = SignedTransaction & { feeWei: bigint };

/**
 * Signs a transfer of `amountWei` from `account` to the same account on the other side, without
 * sending it, so the caller can keep it before it leaves the phone.
 *
 * The call is simulated first from the address alone, and the account's transactions on the
 * origin layer are checked for one in flight, both before the key is read: a transfer the account
 * cannot afford, or one that would take the nonce after a pending transaction, never asks for a
 * fingerprint.
 */
export async function signTransfer(
  store: SecretStore,
  network: Network,
  account: Address,
  direction: TransferDirection,
  amountWei: bigint,
): Promise<SignedTransfer> {
  const origin = originOf(network, direction);
  const feeWei = await transferFee(network, direction);
  const call = {
    address: origin.messageService,
    abi: messageServiceAbi,
    functionName: 'sendMessage',
    args: [account, feeWei, '0x'],
    value: amountWei + feeWei,
  } as const;
  await origin.reader.simulateContract({ ...call, account });
  await checkNothingInFlight(origin.reader, account);

  const signed = await signOn(await readPrivateKey(store, account), origin.chain, origin.rpcUrl, {
    to: origin.messageService,
    data: encodeFunctionData(call),
    value: call.value,
  });
  return { ...signed, feeWei };
}

/** Hands the signed bytes to the origin layer's node, once, as `sendSignedPayment` does. */
export async function sendSignedTransfer(
  network: Network,
  direction: TransferDirection,
  signed: Hex,
): Promise<void> {
  await sendSignedBytes(originOf(network, direction).reader, signed);
}

/** The message a transfer's block holds: what a claim on the other side names. */
export type TransferMessage = { blockNumber: bigint; messageHash: Hex; messageNonce: bigint };

/** The `MessageSent` in `receipt`, emitted by `messageService`, with the block it is in. */
export function messageOf(receipt: TransactionReceipt, messageService: Address): TransferMessage {
  const [sent] = parseEventLogs({
    abi: messageServiceAbi,
    eventName: 'MessageSent',
    logs: receipt.logs.filter((log) => isAddressEqual(log.address, messageService)),
  });
  if (sent === undefined) throw new Error(`no MessageSent in ${receipt.transactionHash}`);
  return {
    blockNumber: receipt.blockNumber,
    messageHash: sent.args._messageHash,
    messageNonce: sent.args._nonce,
  };
}

/**
 * Waits until the transfer is in a block on the origin layer. What the block says is read by
 * `resolveTransfers`, the one place that writes it.
 */
export async function waitForOriginBlock(
  network: Network,
  direction: TransferDirection,
  hash: Hex,
): Promise<void> {
  await originOf(network, direction).reader.waitForTransactionReceipt({ hash });
}

/**
 * Where a deposit stands on L2, as the L2 message service records it: `unknown` until the L1
 * message is anchored on L2, `anchored` once it is and can be claimed, `claimed` once the postman
 * claimed it and the value is in the account.
 */
export type DepositStatus = 'unknown' | 'anchored' | 'claimed';

export async function depositStatus(network: Network, messageHash: Hex): Promise<DepositStatus> {
  const status = await readerFor(network).readContract({
    address: messageServicesOf(network.chain.id).l2,
    abi: messageServiceAbi,
    functionName: 'inboxL1L2MessageStatus',
    args: [messageHash],
  });
  if (status === 2n) return 'claimed';
  return status === 1n ? 'anchored' : 'unknown';
}

/** Whether the withdrawal whose message has number `messageNonce` was claimed on the L1. */
export async function withdrawalClaimed(network: Network, messageNonce: bigint): Promise<boolean> {
  return l1ReaderFor(network).readContract({
    address: messageServicesOf(network.chain.id).l1,
    abi: l1MessageServiceAbi,
    functionName: 'isMessageClaimed',
    args: [messageNonce],
  });
}
