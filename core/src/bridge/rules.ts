// The bridge's rules that ask no node: the most a transfer can carry, and a message's Merkle
// proof among the messages of a finalized batch.

import { concat, keccak256, zeroHash, type Hex } from 'viem';

/**
 * The most a transfer can carry: the balance, less the fee its message pays, less twice what its
 * gas may cost at the price asked now. Twice, because the price is asked again when the transfer
 * is signed and may have risen in between. Never below zero.
 */
export function transferMaximum(balanceWei: bigint, feeWei: bigint, gasCostWei: bigint): bigint {
  const maximum = balanceWei - feeWei - 2n * gasCostWei;
  return maximum > 0n ? maximum : 0n;
}

/** What `claimMessageWithProof` needs of the tree: the siblings from the leaf up, and where. */
export type MessageProof = { proof: Hex[]; root: Hex; leafIndex: number };

/**
 * The proof of `messageHash` among `hashes`, every message hash of a finalized batch in the order
 * they were sent. The batch is cut into trees of `2 ** depth` leaves; the message's tree is the
 * one holding its position, and a last tree with fewer messages is filled with zero hashes. Each
 * node is the keccak256 of its two children side by side.
 */
export function proofInBatch(hashes: Hex[], messageHash: Hex, depth: number): MessageProof {
  const position = hashes.indexOf(messageHash);
  if (position === -1) throw new Error(`message ${messageHash} is not in the batch`);
  const width = 2 ** depth;
  const start = position - (position % width);
  let level = hashes.slice(start, start + width);
  while (level.length < width) level.push(zeroHash);

  const leafIndex = position - start;
  const proof: Hex[] = [];
  let index = leafIndex;
  for (let height = 0; height < depth; height++) {
    // `index ^ 1` is the other child of the same parent: the next index if even, the one
    // before if odd.
    proof.push(level[index ^ 1]);
    const parents: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      parents.push(keccak256(concat([level[i], level[i + 1]])));
    }
    level = parents;
    index = index >> 1;
  }
  return { proof, root: level[0], leafIndex };
}
