import { expect, test } from 'vitest';
import { concat, keccak256, zeroHash, type Hex } from 'viem';
import { proofInBatch, transferMaximum } from './rules';

function fakeHash(byte: string): Hex {
  return `0x${byte.repeat(32)}`;
}

function parent(left: Hex, right: Hex): Hex {
  return keccak256(concat([left, right]));
}

// Five messages in trees of four: the first tree is full, the second holds the fifth message
// and three zero hashes.
const batch = ['11', '22', '33', '44', '55'].map(fakeHash);

test('a message in a full tree is proved by its sibling and its parent sibling', () => {
  const left = parent(batch[0], batch[1]);
  const right = parent(batch[2], batch[3]);
  expect(proofInBatch(batch, batch[2], 2)).toEqual({
    proof: [batch[3], left],
    root: parent(left, right),
    leafIndex: 2,
  });
});

test('the last tree is filled with zero hashes, and the position counts from its start', () => {
  const zeros = parent(zeroHash, zeroHash);
  expect(proofInBatch(batch, batch[4], 2)).toEqual({
    proof: [zeroHash, zeros],
    root: parent(parent(batch[4], zeroHash), zeros),
    leafIndex: 0,
  });
});

test('a message outside the batch is refused', () => {
  expect(() => proofInBatch(batch, fakeHash('66'), 2)).toThrow(/not in the batch/);
});

test('the maximum leaves the fee and twice the gas cost', () => {
  expect(transferMaximum(1_000_000n, 100n, 5_000n)).toBe(1_000_000n - 100n - 10_000n);
});

// A balance that cannot even pay the gas has nothing to send, not a negative amount.
test('the maximum is never below zero', () => {
  expect(transferMaximum(1_000n, 100n, 5_000n)).toBe(0n);
});
