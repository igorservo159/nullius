// Paying a charge: ask the Payments contract whether it would accept, sign, send, and wait.

import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeFunctionData,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';
import { readPrivateKey, type SecretStore } from '../accounts/accounts';
import { paymentsAbi } from '../contracts/payments';
import { readerFor, type Network } from '../network/network';
import {
  answeredWithError,
  checkNothingInFlight,
  sendSignedBytes,
  signOn,
  type SignedTransaction,
} from '../transactions/transactions';

/** A payment as the screen holds it, already converted from the text of its fields. */
export type Payment = {
  payer: Address;
  payee: Address;
  valueWei: bigint;
  salt: Hex;
  orderId: Hex;
};

/** The guards of `Payments.sol`, by the name the contract gives each one, read from the ABI. */
export type RefusalReason = Extract<(typeof paymentsAbi)[number], { type: 'error' }>['name'];

/** The same names as values, also read from the ABI, so the two lists cannot drift apart. */
export const refusalReasons: readonly string[] = paymentsAbi
  .filter((item) => item.type === 'error')
  .map((item) => item.name);

function isRefusalReason(name: string): name is RefusalReason {
  return refusalReasons.includes(name);
}

/**
 * The contract refused the call. `reason` names the guard that fired; the message carries the
 * values it was given; `cause` keeps viem's error whole. The sentence a user reads is not here:
 * it belongs to the screen, in the screen's language.
 */
export class PaymentRefused extends Error {
  readonly reason: RefusalReason;

  constructor(reason: RefusalReason, args: readonly unknown[], cause: unknown) {
    super(`Payments refused the call: ${reason}(${args.join(', ')})`);
    this.name = 'PaymentRefused';
    this.reason = reason;
    this.cause = cause;
  }
}

/**
 * viem's error turned into `PaymentRefused` when its revert data decodes into one of the five
 * guards. Anything else — a node that did not answer, a balance too low, a revert this contract
 * does not declare — goes up exactly as it came.
 */
function asRefusal(error: unknown): unknown {
  if (!(error instanceof BaseError)) return error;
  const reverted = error.walk((inner) => inner instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return error;

  const name = reverted.data?.errorName;
  if (name === undefined || !isRefusalReason(name)) return error;
  return new PaymentRefused(name, reverted.data?.args ?? [], error);
}

/** The arguments of `pay()`, in the order the contract declares them. */
function payArguments(payment: Payment) {
  return [payment.orderId, payment.salt, payment.payee] as const;
}

/**
 * Signs a payment of a charge without sending it, so the caller can keep it before it leaves
 * the phone.
 *
 * The call is simulated first, from the payer's address alone: a payment the contract would
 * refuse stops there, before the key is read, so it never asks for a fingerprint. The orderId
 * is sent exactly as the screen has it and never recomputed here — recomputing would make the
 * contract's `OrderIdMismatch` guard unreachable.
 *
 * Then the payer's two transaction counts are compared, also before the key is read: with any
 * transaction in flight it stops with `TransactionInFlight`, so payments in sequence go one per
 * block.
 *
 * Nonce, gas and fees are never named: `prepareTransactionRequest` asks the node for each one
 * before the account signs. A refusal that appears only there, because the order was paid
 * between the simulation and this request, goes up undecoded: the transaction carries
 * `pay()`'s bytes, not its ABI.
 */
export async function signPayment(
  store: SecretStore,
  network: Network,
  payment: Payment,
): Promise<SignedTransaction> {
  const reader = readerFor(network);
  try {
    await reader.simulateContract({
      account: payment.payer,
      address: network.paymentsAddress,
      abi: paymentsAbi,
      functionName: 'pay',
      args: payArguments(payment),
      value: payment.valueWei,
    });
  } catch (error) {
    throw asRefusal(error);
  }

  await checkNothingInFlight(reader, payment.payer);

  return signOn(await readPrivateKey(store, payment.payer), network.chain, network.rpcUrl, {
    to: network.paymentsAddress,
    data: encodeFunctionData({ abi: paymentsAbi, functionName: 'pay', args: payArguments(payment) }),
    value: payment.valueWei,
  });
}

/** Hands the signed bytes of a payment to the Linea node, once: see `sendSignedBytes`. */
export async function sendSignedPayment(network: Network, signed: Hex): Promise<void> {
  await sendSignedBytes(readerFor(network), signed);
}

/** Why a mined payment reverted: one of the guards, or `unknown` when the node could not say. */
export type RevertReason = RefusalReason | 'unknown';

/**
 * What the receipt of a mined payment says: whether it executed, in which block, the gas it used
 * and the price paid for each unit. `revertReason` is null unless it reverted.
 */
export type PaymentOutcome = {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  revertReason: RevertReason | null;
};

// What `debug_traceTransaction` hands back with `callTracer`, as far as it is read here: the
// bytes the call returned, which for a revert are the contract's error.
type CallTrace = { output?: Hex };

/**
 * Which guard reverted the mined transaction `hash`. A receipt does not say, so the node runs the
 * transaction again with `callTracer` and the error bytes it returned are decoded with the
 * Payments ABI.
 *
 * A node that answers with an error (one without the debug methods, for one), a trace without
 * output, or bytes that are none of the five guards give `unknown`. A node that does not answer
 * at all throws: the reason can still be found later, and `unknown` would be kept for good.
 */
export async function revertReasonOf(reader: PublicClient, hash: Hex): Promise<RevertReason> {
  let trace: CallTrace;
  try {
    trace = await reader.request<{
      Method: 'debug_traceTransaction';
      Parameters: [Hex, { tracer: 'callTracer' }];
      ReturnType: CallTrace;
    }>({ method: 'debug_traceTransaction', params: [hash, { tracer: 'callTracer' }] });
  } catch (error) {
    if (answeredWithError(error)) return 'unknown';
    throw error;
  }
  if (trace.output === undefined) return 'unknown';
  try {
    const { errorName } = decodeErrorResult({ abi: paymentsAbi, data: trace.output });
    return isRefusalReason(errorName) ? errorName : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The receipt turned into what the app keeps. Only a reverted one costs another call to the
 * node, for its reason.
 */
export async function outcomeOf(
  reader: PublicClient,
  receipt: TransactionReceipt,
): Promise<PaymentOutcome> {
  return {
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice,
    revertReason:
      receipt.status === 'reverted' ? await revertReasonOf(reader, receipt.transactionHash) : null,
  };
}

/**
 * Waits until the transaction is in a block. The hash alone says the node accepted it; only
 * the receipt says whether it executed.
 */
export async function waitForPayment(network: Network, hash: Hex): Promise<PaymentOutcome> {
  const reader = readerFor(network);
  return outcomeOf(reader, await reader.waitForTransactionReceipt({ hash }));
}
