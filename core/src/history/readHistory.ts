// Reading the Payments contract's logs for one account, slice by slice from its cursor to the
// node's current block: payments it made that the register lacks, or holds with a wrong status,
// enter the register, and charges it was paid are marked paid.

import {
  decodeFunctionData,
  getAddress,
  isAddressEqual,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { findCharge, markChargePaid, saveRecoveredCharge } from '../charges/storage';
import { paymentsAbi } from '../contracts/payments';
import type { Database } from '../database/database';
import { readerFor, sliceBlocks, type Network } from '../network/network';
import { outcomeOf } from '../payments/chain';
import { saveFoundPayment, settleSentPayment, statusOfSentPayment } from '../payments/storage';
import { readCursor, saveCursor } from './cursors';

// Where a `Payment` log came from: everything else is read from its transaction.
type PaymentLog = { transactionHash: Hex; blockNumber: bigint };

/**
 * The transaction of a `Payment` log with its `pay()` call read: order id, salt and payee are its
 * arguments. Null when the transaction did not call Payments itself — one made through another
 * contract, a smart account for one, carries that contract's call, and its salt cannot be read.
 */
async function payCallOf(reader: PublicClient, network: Network, hash: Hex) {
  const transaction = await reader.getTransaction({ hash });
  if (transaction.to === null || !isAddressEqual(transaction.to, network.paymentsAddress)) {
    return null;
  }
  const call = decodeFunctionData({ abi: paymentsAbi, data: transaction.input });
  // Only `pay` emits `Payment`; the check tells TypeScript the arguments are `pay`'s.
  if (call.functionName !== 'pay') return null;
  const [orderId, salt, payee] = call.args;
  return { transaction, orderId, salt, payee };
}

// When the log's block was made, in milliseconds like `Date.now()`.
async function blockTime(reader: PublicClient, blockNumber: bigint): Promise<number> {
  const block = await reader.getBlock({ blockNumber });
  return Number(block.timestamp) * 1000;
}

/**
 * Brings one `Payment` log of the account as payer into the register. A hash kept as `success`
 * is left alone. A hash kept with any other status executed after all — the log proves it — and
 * takes its receipt. A hash the register lacks is kept whole: the transaction gives order id,
 * salt and payee (the arguments of `pay()`), the payer, the amount and the nonce; the receipt
 * gives the gas, and the block its time. One whose salt cannot be read is left out.
 */
async function recordPaymentLog(
  db: Database,
  network: Network,
  reader: PublicClient,
  log: PaymentLog,
): Promise<void> {
  const hash = log.transactionHash;
  const kept = await statusOfSentPayment(db, hash);
  if (kept === 'success') return;

  const outcome = await outcomeOf(reader, await reader.getTransactionReceipt({ hash }));
  if (kept !== null) {
    await settleSentPayment(db, hash, outcome);
    return;
  }

  const call = await payCallOf(reader, network, hash);
  if (call === null) return;
  const { transaction, orderId, salt, payee } = call;
  await saveFoundPayment(
    db,
    { hash, nonce: transaction.nonce },
    { payer: getAddress(transaction.from), payee, valueWei: transaction.value, salt, orderId },
    network,
    await blockTime(reader, log.blockNumber),
    outcome,
  );
}

/**
 * Brings one `Payment` log of the account as payee into its charges. A charge kept and waiting is
 * marked paid; one already paid is left alone. A charge the phone lacks — generated on another
 * device, or lost with the app's data — is rebuilt from the transaction that paid it and kept as
 * paid. A charge nobody paid never reached the chain, and nothing here can bring it back.
 */
async function recordReceivedLog(
  db: Database,
  network: Network,
  reader: PublicClient,
  log: PaymentLog & { args: { orderId?: Hex } },
): Promise<void> {
  const hash = log.transactionHash;
  if (log.args.orderId === undefined) return;
  const kept = await findCharge(db, network, log.args.orderId);
  if (kept !== null) {
    if (kept.paidHash === null) {
      await markChargePaid(db, network, log.args.orderId, hash, log.blockNumber);
    }
    return;
  }

  const call = await payCallOf(reader, network, hash);
  if (call === null) return;
  const { transaction, orderId, salt, payee } = call;
  await saveRecoveredCharge(
    db,
    { orderId, salt, payee, valueWei: transaction.value },
    network,
    await blockTime(reader, log.blockNumber),
    hash,
    log.blockNumber,
  );
}

/**
 * Reads the account's `Payment` logs from its cursor up to the node's current block, in slices of
 * `sliceBlocks`, saving the cursor at the end of each slice: an app closed in the middle goes on
 * from the next slice. Each slice is asked twice, once with the account as payer and once as
 * payee, since a log filter joins its positions with AND; the cursor moves only after both.
 * Without a cursor the history question is unanswered and nothing is read. `onSlice` hears the
 * next block to read and the last one of this reading, after every slice.
 */
export async function readHistory(
  db: Database,
  network: Network,
  account: Address,
  onSlice?: (nextBlock: bigint, lastBlock: bigint) => void,
): Promise<void> {
  const cursor = await readCursor(db, account, network);
  if (cursor === null) return;

  const reader = readerFor(network);
  const lastBlock = await reader.getBlockNumber();
  for (let fromBlock = cursor; fromBlock <= lastBlock; fromBlock += sliceBlocks) {
    const sliceEnd = fromBlock + sliceBlocks - 1n;
    const toBlock = sliceEnd < lastBlock ? sliceEnd : lastBlock;
    const sent = await reader.getContractEvents({
      address: network.paymentsAddress,
      abi: paymentsAbi,
      eventName: 'Payment',
      args: { payer: account },
      fromBlock,
      toBlock,
    });
    for (const log of sent) await recordPaymentLog(db, network, reader, log);

    const received = await reader.getContractEvents({
      address: network.paymentsAddress,
      abi: paymentsAbi,
      eventName: 'Payment',
      args: { payee: account },
      fromBlock,
      toBlock,
    });
    for (const log of received) await recordReceivedLog(db, network, reader, log);

    await saveCursor(db, account, network, toBlock + 1n);
    onSlice?.(toBlock + 1n, lastBlock);
  }
}
