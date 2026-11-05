import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { keccak256, slice, toHex, type Hex } from 'viem';
import { paymentsAbi, paymentsCodeHash } from './payments';

// Computed outside this code with `cast sig "<name>(<types>)"`, and for the event with
// `cast sig-event`.
const pinnedSelectors: Record<string, string> = {
  pay: '0xe7e30937',
  paid: '0xadd89bb2',
  ZeroPayee: '0xe1ee996d',
  ZeroAmount: '0x1f2a2005',
  OrderIdMismatch: '0x0517adf9',
  AlreadyPaid: '0xf4b76a0e',
  TransferFailed: '0x90b8ec18',
  Payment: '0x50941445d212167ff98a2ff018c9c9a3181a60e1e39ce40326f17130ca56d143',
};

// A selector is the first 4 bytes of the keccak256 of `name(type,type,...)`: it is how the
// contract recognizes the function called and how the app recognizes the error returned. An
// event keeps all 32 bytes, as the first topic of each log: it is how a log search asks for it.
test('every ABI entry has the selector the contract uses', () => {
  for (const item of paymentsAbi) {
    const signature = `${item.name}(${item.inputs.map((input) => input.type).join(',')})`;
    const hash = keccak256(toHex(signature));
    const selector = item.type === 'event' ? hash : slice(hash, 0, 4);
    expect(selector, item.name).toBe(pinnedSelectors[item.name]);
  }
  expect(paymentsAbi).toHaveLength(Object.keys(pinnedSelectors).length);
});

// The code `forge build` produces for Payments, as it sits on chain after the deployment. Without
// `forge build` in contracts/ there is nothing to compare, and the test is skipped.
const artifactPath = new URL('../../../contracts/out/Payments.sol/Payments.json', import.meta.url);

test.skipIf(!existsSync(artifactPath))('paymentsCodeHash is the hash of the built contract', () => {
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  expect(keccak256(artifact.deployedBytecode.object as Hex)).toBe(paymentsCodeHash);
});

// What the selector leaves out matters too: argument names, which event arguments are
// `indexed` (a topic, not the data of the log) and whether a function is `payable`.
type AbiEntry = {
  type: string;
  name?: string;
  inputs?: readonly { name?: string; type: string; indexed?: boolean }[];
  stateMutability?: string;
};

function shapeOf(entry: AbiEntry) {
  return {
    type: entry.type,
    name: entry.name,
    // An unnamed argument, such as the key of a public mapping's getter, is `''` in what
    // `forge build` writes and left out by `parseAbi`.
    inputs: (entry.inputs ?? []).map(({ name, type, indexed }) => ({
      name: name ?? '',
      type,
      indexed: indexed ?? false,
    })),
    stateMutability: entry.stateMutability,
  };
}

test.skipIf(!existsSync(artifactPath))('every ABI entry matches the built contract', () => {
  const builtAbi = JSON.parse(readFileSync(artifactPath, 'utf8')).abi as AbiEntry[];
  for (const entry of paymentsAbi) {
    const built = builtAbi.find(
      (candidate) => candidate.type === entry.type && candidate.name === entry.name,
    );
    expect(built && shapeOf(built), entry.name).toEqual(shapeOf(entry));
  }
});
