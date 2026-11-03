// Any transaction the app sends, on either layer: refuse while one is in flight, sign without
// sending, hand the signed bytes to a node once, and ask the node later what became of them.

import {
  BaseError,
  RpcRequestError,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  createWalletClient,
  http,
  keccak256,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * True when the node answered the request with an error, as opposed to not answering at all: a
 * JSON-RPC error reply is the one that leaves an `RpcRequestError` in viem's chain of causes.
 */
export function answeredWithError(error: unknown): boolean {
  return (
    error instanceof BaseError && error.walk((inner) => inner instanceof RpcRequestError) !== null
  );
}

/**
 * The payer has a transaction the node holds that no block includes yet. Signing now would take
 * the nonce after it, and if that one were dropped the new one would sit queued behind the gap.
 * Both counts are the node's: `latest` counts the transactions blocks include, `pending` adds
 * the ones in its pool.
 */
export class TransactionInFlight extends Error {
  readonly latest: number;
  readonly pending: number;

  constructor(latest: number, pending: number) {
    super(
      `the account has ${pending - latest} transaction(s) in flight (latest ${latest}, pending ${pending})`,
    );
    this.name = 'TransactionInFlight';
    this.latest = latest;
    this.pending = pending;
  }
}

/**
 * A transaction signed and not yet sent: `signed` is the bytes the node will be given, `hash` is
 * keccak256 of those bytes, the same hash the node answers with, and `nonce` is the one the bytes
 * carry. A payment and a transfer between L1 and L2 are both kept in this form before they leave.
 */
export type SignedTransaction = { hash: Hex; nonce: number; signed: Hex };

/**
 * Refuses to sign for `address` while it has a transaction the node behind `reader` holds that no
 * block includes, on whichever layer `reader` asks: see `TransactionInFlight`.
 */
export async function checkNothingInFlight(reader: PublicClient, address: Address): Promise<void> {
  const [latest, pending] = await Promise.all([
    reader.getTransactionCount({ address, blockTag: 'latest' }),
    reader.getTransactionCount({ address, blockTag: 'pending' }),
  ]);
  if (pending !== latest) throw new TransactionInFlight(latest, pending);
}

/**
 * Signs `request` with `privateKey` for `chain` without sending it. Nonce, gas and fees are never
 * named: `prepareTransactionRequest` asks the node at `rpcUrl` for each one before the key signs.
 */
export async function signOn(
  privateKey: Hex,
  chain: Chain,
  rpcUrl: string,
  request: { to: Address; data: Hex; value: bigint },
): Promise<SignedTransaction> {
  const wallet = createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain,
    transport: http(rpcUrl),
  });
  // `chain` is named again on each call: typed as any `Chain`, viem asks for it there too.
  const prepared = await wallet.prepareTransactionRequest({ ...request, chain });
  const signed = await wallet.signTransaction({ ...prepared, chain });
  return { hash: keccak256(signed), nonce: prepared.nonce, signed };
}

/**
 * The node answered the signed bytes with an error: it did not take the transaction, so the
 * transaction is not in its pool and its nonce is still free. The message carries the node's
 * own words; `cause` keeps viem's error whole.
 */
export class NodeRejected extends Error {
  constructor(cause: BaseError) {
    super(`the node rejected the transaction: ${cause.details}`);
    this.name = 'NodeRejected';
    this.cause = cause;
  }
}

/**
 * A transaction signed and not kept on the phone, so it was never sent: its nonce is still free.
 * A payment and a transfer are kept before their bytes leave; `cause` is the write that failed.
 */
export class TransactionNotKept extends Error {
  constructor(cause: unknown) {
    super(`the transaction was not kept, so nothing was sent: ${String(cause)}`);
    this.name = 'TransactionNotKept';
    this.cause = cause;
  }
}

/**
 * The node did not answer the signed bytes: no reply, a timeout, an HTTP status. They may have
 * reached it, so whatever was kept of them is left for a later look to settle; `cause` keeps the
 * error as it came.
 */
export class SendUnanswered extends Error {
  constructor(cause: unknown) {
    super(`the node did not answer, and the transaction may have reached it: ${String(cause)}`);
    this.name = 'SendUnanswered';
    this.cause = cause;
  }
}

/**
 * Hands the signed bytes to the node behind `reader`, once. An error the node answered with comes
 * back as `NodeRejected`. Anything else — no answer, a timeout, an HTTP status — goes up as it
 * came: the bytes may have reached the node, so nothing here says the transaction is not there.
 */
export async function sendSignedBytes(reader: PublicClient, signed: Hex): Promise<void> {
  try {
    await reader.sendRawTransaction({ serializedTransaction: signed });
  } catch (error) {
    if (error instanceof BaseError && answeredWithError(error)) throw new NodeRejected(error);
    throw error;
  }
}

/** The transaction the node has under `hash`, mined or in its pool; null when it has none. */
export async function transactionOf(reader: PublicClient, hash: Hex) {
  try {
    return await reader.getTransaction({ hash });
  } catch (error) {
    if (error instanceof TransactionNotFoundError) return null;
    throw error;
  }
}

/** The receipt of a mined transaction; null when the node answering has not got its block yet. */
export async function receiptOf(reader: PublicClient, hash: Hex) {
  try {
    return await reader.getTransactionReceipt({ hash });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return null;
    throw error;
  }
}

/**
 * What became of a transaction the node does not know, from its nonce against `count`, the
 * sender's transactions in blocks. Below: the nonce is spent, and not by this transaction, which
 * would have a receipt. Equal: the nonce is still free and nobody holds the transaction. Above:
 * it waits for the nonces before it, if a node holds it at all.
 */
export function byNonce(nonce: number, count: number): 'replaced' | 'lost' | 'queued' {
  if (nonce < count) return 'replaced';
  if (nonce === count) return 'lost';
  return 'queued';
}

/**
 * Runs `write`, and hands its failure to `onRecordFailure` instead of throwing: a write after the
 * bytes left the phone that fails leaves its row behind what happened, not missing, and a later
 * look brings it up to date.
 */
export async function recordOrReport(
  write: () => Promise<void>,
  onRecordFailure: (error: unknown) => void,
): Promise<void> {
  try {
    await write();
  } catch (error) {
    onRecordFailure(error);
  }
}

/**
 * What every transaction the app sends goes through once signed: kept on the phone, then handed
 * to a node, once. `keep` failing is `TransactionNotKept`, and nothing is sent. A node that
 * answers with an error makes `mark('rejected')`, and `NodeRejected` goes up; one that does not
 * answer is `SendUnanswered`, and the kept row stays `signed`, since the bytes may have arrived.
 * An accepted one makes `mark('pending')`. `onKept` hears when the row is kept, before the bytes
 * leave; the two marks go through `recordOrReport`.
 */
export async function keepAndSend({
  keep,
  send,
  mark,
  onKept = () => {},
  onRecordFailure,
}: {
  keep: () => Promise<void>;
  send: () => Promise<void>;
  mark: (status: 'rejected' | 'pending') => Promise<void>;
  onKept?: () => void;
  onRecordFailure: (error: unknown) => void;
}): Promise<void> {
  try {
    await keep();
  } catch (error) {
    throw new TransactionNotKept(error);
  }
  onKept();
  try {
    await send();
  } catch (error) {
    if (!(error instanceof NodeRejected)) throw new SendUnanswered(error);
    await recordOrReport(() => mark('rejected'), onRecordFailure);
    throw error;
  }
  await recordOrReport(() => mark('pending'), onRecordFailure);
}
