// Linea's rollup contract on the L1: the events a finalization emits, which a withdrawal's proof
// is read from.

import { parseAbi } from 'viem';

/** The rollup contract's events a finalization emits, as Linea's SDK declares them. */
export const rollupEventsAbi = parseAbi([
  'event L2MessagingBlockAnchored(uint256 indexed l2Block)',
  'event L2MerkleRootAdded(bytes32 indexed l2MerkleRoot, uint256 indexed treeDepth)',
]);
