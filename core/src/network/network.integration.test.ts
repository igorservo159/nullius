// Checking and keeping the network, against anvil with Payments deployed. Run with
// `npm run test:integration`.

import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { lineaSepolia, sepolia } from 'viem/chains';
import type { SecretStore } from '../accounts/accounts';
import { anvilPayerKey } from '../anvil.setup';
import { anvilClient, anvilNetwork } from '../anvilNetwork';
import { balancesOf } from '../balances/balances';
import { paymentsAbi } from '../contracts/payments';
import {
  checkDeployBlock,
  checkL1Node,
  checkNode,
  networkName,
  readerFor,
  resetNetwork,
} from './network';

const artifactPath = new URL('../../../contracts/out/Payments.sol/Payments.json', import.meta.url);

const anvil = inject('anvil');

function memoryStore(initial: [string, string][] = []) {
  const values = new Map(initial);
  const store: SecretStore = {
    get: async (name) => values.get(name) ?? null,
    set: async (name, value) => void values.set(name, value),
    remove: async (name) => void values.delete(name),
  };
  return { store, values };
}

describe.skipIf(anvil === null)('the network kept on the phone, on anvil', () => {
  const network = anvilNetwork(anvil);
  const chain = anvilClient(network);

  let snapshot: Hex;
  beforeEach(async () => {
    snapshot = await chain.snapshot();
  });
  afterEach(async () => {
    await chain.revert({ id: snapshot });
  });

  test('checkNode accepts the Payments deployed on anvil', async () => {
    await expect(checkNode(network)).resolves.toBeUndefined();
  });

  // Any code but Payments' at an address: one byte, STOP, is enough to be some other contract.
  test('checkNode refuses an address whose code is not Payments', async () => {
    const other: Hex = '0x00000000000000000000000000000000000000aa';
    await chain.setCode({ address: other, bytecode: '0x00' });
    await expect(checkNode({ ...network, paymentsAddress: other })).rejects.toMatchObject({
      reason: 'notPayments',
    });
  });

  // A copy of Payments published now: its block and the one before are recent. The setup's copy
  // sits at an old block, whose state anvil drops once another file has mined thousands of
  // blocks, and a revert does not bring it back.
  async function deployFresh() {
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    const deployer = createWalletClient({
      account: privateKeyToAccount(anvilPayerKey),
      chain: lineaSepolia,
      transport: http(network.rpcUrl),
    });
    const hash = await deployer.deployContract({
      abi: paymentsAbi,
      bytecode: artifact.bytecode.object as Hex,
    });
    const receipt = await readerFor(network).waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error('the copy of Payments was not created');
    return {
      ...network,
      paymentsAddress: receipt.contractAddress,
      deployBlock: receipt.blockNumber,
    };
  }

  test('checkDeployBlock accepts the block that published the contract, and only it', async () => {
    const fresh = await deployFresh();
    await expect(checkDeployBlock(fresh)).resolves.toBeUndefined();
    const before = { ...fresh, deployBlock: fresh.deployBlock - 1n };
    await expect(checkDeployBlock(before)).rejects.toMatchObject({ reason: 'notDeployedAt' });
    // The deployment is the last block mined: one more is mined so the block after it exists.
    await chain.mine({ blocks: 1 });
    const after = { ...fresh, deployBlock: fresh.deployBlock + 1n };
    await expect(checkDeployBlock(after)).rejects.toMatchObject({ reason: 'deployedBefore' });
  }, 15_000);

  // A block above the chain's tip has no state on any node, as an old block has none on a node
  // that keeps only recent state: either way the node answers with an error, said as noOldState.
  test('a block the node cannot serve is refused as noOldState', async () => {
    const tip = await readerFor(network).getBlockNumber();
    await expect(checkDeployBlock({ ...network, deployBlock: tip + 10n })).rejects.toMatchObject({
      reason: 'noOldState',
    });
  });

  test('resetNetwork removes what the phone kept and goes back to .env', async () => {
    const { store, values } = memoryStore([[networkName, '{}']]);
    expect(await resetNetwork(store, network)).toEqual(network);
    expect(values.size).toBe(0);
  });

  test('checkL1Node accepts a node of the L1 chain and refuses one of another', async () => {
    await expect(checkL1Node(network)).resolves.toBeUndefined();
    await expect(checkL1Node({ ...network, l1Chain: sepolia })).rejects.toMatchObject({
      reason: 'otherL1Chain',
    });
  });

  // anvil's first account is funded at start; port 1 has nothing listening for the L1.
  test('balances are read on both layers, and a failed L1 leaves the L2 shown', async () => {
    const funded = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    const both = await balancesOf(network, funded);
    expect(both.l2).toMatchObject({ wei: expect.any(BigInt) });
    expect(both.l1).toEqual(both.l2);

    const l1Down = await balancesOf({ ...network, l1RpcUrl: 'http://127.0.0.1:1' }, funded);
    expect(l1Down.l2).toEqual(both.l2);
    expect(l1Down.l1).toMatchObject({ error: expect.any(String) });
  });
});
