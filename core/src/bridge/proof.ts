// The Merkle proof a withdrawal's claim on the L1 carries. When Linea finalizes a batch of L2
// blocks on the L1, the rollup contract records the roots of trees whose leaves are the hashes of
// the batch's L2 to L1 messages, in the order they were sent; a claim shows its message is a leaf
// of one of them. The steps follow Linea's SDK (`getMessageProof`), with log searches in slices
// the public nodes serve.

import { isAddressEqual, parseEventLogs, type Hex } from 'viem';
import { messageServiceAbi, messageServicesOf } from '../contracts/lineaMessageService';
import { rollupEventsAbi } from '../contracts/lineaRollup';
import { l1ReaderFor, readerFor, sliceBlocks, type Network } from '../network/network';
import { proofInBatch, type MessageProof } from './rules';

/**
 * The most blocks one log search on the L1 asks for: the L1 node the app uses by default,
 * thirdweb's for Sepolia, refuses more than 1000.
 */
export const l1SliceBlocks = 1000n;

/** Seconds per slot on Ethereum and Sepolia; a slot holds at most one block. */
const slotSeconds = 12n;

/** The message's L2 block is not finalized on the L1 yet: there is no tree to prove against. */
export class ProofNotReady extends Error {
  constructor(l2Block: bigint) {
    super(`no finalization on the L1 anchors L2 block ${l2Block} yet`);
    this.name = 'ProofNotReady';
  }
}

/**
 * The L1 transaction that finalized L2 block `l2Block` with its messages, or null while none
 * has. It is searched forward, from the L1 block of the moment `l2Block` was made, or one before:
 * as many blocks back from the L1's latest as 12-second slots have passed since then, and a slot
 * holds at most one block. Linea finalizes some hours after a block, so the search ends within the
 * first slices however late it runs.
 */
export async function findFinalization(network: Network, l2Block: bigint): Promise<Hex | null> {
  const l1 = l1ReaderFor(network);
  const [made, latest] = await Promise.all([
    readerFor(network).getBlock({ blockNumber: l2Block }),
    l1.getBlock({ blockTag: 'latest' }),
  ]);
  const slotsSince = (latest.timestamp - made.timestamp) / slotSeconds;
  const start = latest.number > slotsSince ? latest.number - slotsSince : 0n;

  for (let fromBlock = start; fromBlock <= latest.number; fromBlock += l1SliceBlocks) {
    const sliceEnd = fromBlock + l1SliceBlocks - 1n;
    const [anchored] = await l1.getContractEvents({
      address: messageServicesOf(network.chain.id).l1,
      abi: rollupEventsAbi,
      eventName: 'L2MessagingBlockAnchored',
      args: { l2Block },
      fromBlock,
      toBlock: sliceEnd < latest.number ? sliceEnd : latest.number,
    });
    if (anchored !== undefined) return anchored.transactionHash;
  }
  return null;
}

/** What a finalization's receipt says of its messages: tree roots and depth, and L2 blocks. */
export type FinalizedBatch = { roots: Hex[]; depth: number; firstBlock: bigint; lastBlock: bigint };

/**
 * Reads the batch from the finalization's receipt: one `L2MerkleRootAdded` per tree, all of one
 * depth, and one `L2MessagingBlockAnchored` per L2 block that sent messages, the first and last
 * of them bounding where the messages are.
 */
export async function batchOf(network: Network, finalization: Hex): Promise<FinalizedBatch> {
  const rollup = messageServicesOf(network.chain.id).l1;
  const receipt = await l1ReaderFor(network).getTransactionReceipt({ hash: finalization });
  const events = parseEventLogs({
    abi: rollupEventsAbi,
    logs: receipt.logs.filter((log) => isAddressEqual(log.address, rollup)),
  });
  const roots: Hex[] = [];
  const depths: number[] = [];
  const blocks: bigint[] = [];
  for (const event of events) {
    if (event.eventName === 'L2MerkleRootAdded') {
      roots.push(event.args.l2MerkleRoot);
      depths.push(Number(event.args.treeDepth));
    } else {
      blocks.push(event.args.l2Block);
    }
  }
  if (roots.length === 0 || blocks.length === 0) {
    throw new Error(`${finalization} finalized no L2 to L1 messages`);
  }
  if (depths.some((depth) => depth !== depths[0])) {
    throw new Error(`${finalization} added trees of different depths`);
  }
  return {
    roots,
    depth: depths[0],
    firstBlock: blocks.reduce((a, b) => (b < a ? b : a)),
    lastBlock: blocks.reduce((a, b) => (b > a ? b : a)),
  };
}

/** The message hashes Linea's L2 service sent from `firstBlock` to `lastBlock`, in order. */
export async function messageHashesBetween(
  network: Network,
  firstBlock: bigint,
  lastBlock: bigint,
): Promise<Hex[]> {
  const reader = readerFor(network);
  const hashes: Hex[] = [];
  for (let fromBlock = firstBlock; fromBlock <= lastBlock; fromBlock += sliceBlocks) {
    const sliceEnd = fromBlock + sliceBlocks - 1n;
    const sent = await reader.getContractEvents({
      address: messageServicesOf(network.chain.id).l2,
      abi: messageServiceAbi,
      eventName: 'MessageSent',
      // Strict: a log whose fields do not decode is left out instead of kept with them missing.
      strict: true,
      fromBlock,
      toBlock: sliceEnd < lastBlock ? sliceEnd : lastBlock,
    });
    hashes.push(...sent.map((event) => event.args._messageHash));
  }
  return hashes;
}

/**
 * The proof of the message `messageHash`, sent from L2 block `l2Block`: the finalization that
 * anchored the block, the batch it finalized, every message of the batch, and the message's tree.
 * A root the tree does not reproduce is refused here, before any claim is signed.
 */
export async function messageProof(
  network: Network,
  l2Block: bigint,
  messageHash: Hex,
): Promise<MessageProof> {
  const finalization = await findFinalization(network, l2Block);
  if (finalization === null) throw new ProofNotReady(l2Block);
  const batch = await batchOf(network, finalization);
  const hashes = await messageHashesBetween(network, batch.firstBlock, batch.lastBlock);
  const proof = proofInBatch(hashes, messageHash, batch.depth);
  if (!batch.roots.includes(proof.root)) {
    throw new Error(
      `the tree of ${messageHash} gives root ${proof.root}, not one ${finalization} added`,
    );
  }
  return proof;
}
