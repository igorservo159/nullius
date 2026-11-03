import { expect, test } from 'vitest';
import { linea, lineaSepolia, mainnet, sepolia } from 'viem/chains';
import type { SecretStore } from '../accounts/accounts';
import {
  chainById,
  defaultNetwork,
  networkName,
  networkOf,
  readKeptFields,
  saveNetwork,
  type Network,
  type NetworkFields,
} from './network';

test('chainById knows Linea Sepolia and Linea', () => {
  expect(chainById(59141)).toBe(lineaSepolia);
  expect(chainById(59144)).toBe(linea);
});

test('chainById refuses any other chain id', () => {
  expect(() => chainById(1)).toThrow('chain id 1 is neither');
});

const sepoliaNetwork: Network = {
  chain: lineaSepolia,
  rpcUrl: 'https://rpc.sepolia.linea.build',
  paymentsAddress: '0xD2807905E71f4AA10e322aD90726040457ebE825',
  deployBlock: 32601971n,
  l1Chain: sepolia,
  l1RpcUrl: sepolia.rpcUrls.default.http[0] ?? '',
};

const fields: NetworkFields = {
  chainId: 59141,
  paymentsAddress: '0xd2807905e71f4aa10e322ad90726040457ebe825',
  deployBlock: '32601971',
  rpcUrl: 'https://rpc.sepolia.linea.build',
  l1RpcUrl: '',
};

function memoryStore(initial: [string, string][] = []) {
  const values = new Map(initial);
  const store: SecretStore = {
    get: async (name) => values.get(name) ?? null,
    set: async (name, value) => void values.set(name, value),
    remove: async (name) => void values.delete(name),
  };
  return { store, values };
}

test('the fields become a network, with the address checksummed', () => {
  expect(networkOf(fields)).toEqual(sepoliaNetwork);
});

test('an empty node is the chain public node', () => {
  expect(networkOf({ ...fields, chainId: 59144, rpcUrl: ' ' }).rpcUrl).toBe(
    linea.rpcUrls.default.http[0],
  );
});

// Linea settles on Ethereum and Linea Sepolia on Sepolia; an empty L1 node is that chain's public
// node.
test('the L1 follows the chain, and an empty L1 node is its public node', () => {
  const onLinea = networkOf({ ...fields, chainId: 59144 });
  expect(onLinea.l1Chain).toBe(mainnet);
  expect(onLinea.l1RpcUrl).toBe(mainnet.rpcUrls.default.http[0]);
  expect(networkOf({ ...fields, l1RpcUrl: ' ' }).l1RpcUrl).toBe(sepolia.rpcUrls.default.http[0]);
});

test('a field that is not well formed is refused with its reason', () => {
  const refusals: [Partial<NetworkFields>, string][] = [
    [{ rpcUrl: 'http://127.0.0.1:8545' }, 'notHttps'],
    [{ rpcUrl: 'rpc.sepolia.linea.build' }, 'notHttps'],
    [{ l1RpcUrl: 'http://127.0.0.1:8545' }, 'l1NotHttps'],
    [{ paymentsAddress: '0x1234' }, 'notAddress'],
    [{ deployBlock: '' }, 'notBlockNumber'],
    [{ deployBlock: '0x10' }, 'notBlockNumber'],
  ];
  for (const [change, reason] of refusals) {
    expect(() => networkOf({ ...fields, ...change }), reason).toThrow(
      expect.objectContaining({ reason }),
    );
  }
});

// The format is checked before any node is asked, so nothing reaches a node and nothing is kept.
test('saveNetwork refuses a malformed network and keeps the previous one', async () => {
  const previous = JSON.stringify(fields);
  const { store, values } = memoryStore([[networkName, previous]]);
  await expect(saveNetwork(store, { ...fields, rpcUrl: 'http://x' })).rejects.toThrow('https://');
  expect(values.get(networkName)).toBe(previous);
});

test('the kept fields are the network entry, else the fallback network', async () => {
  const other = { ...fields, rpcUrl: 'https://other.example' };
  const kept = memoryStore([[networkName, JSON.stringify(other)]]).store;
  expect(await readKeptFields(kept, sepoliaNetwork)).toEqual(other);

  const fromFallback = {
    ...fields,
    paymentsAddress: sepoliaNetwork.paymentsAddress,
    l1RpcUrl: sepoliaNetwork.l1RpcUrl,
  };
  expect(await readKeptFields(memoryStore().store, sepoliaNetwork)).toEqual(fromFallback);
});

// Linea when nothing is asked: what the app pays on before the user changes anything.
test('the default network is Payments on Linea, Linea Sepolia when asked, on public nodes', () => {
  expect(defaultNetwork()).toEqual({
    chain: linea,
    rpcUrl: linea.rpcUrls.default.http[0],
    paymentsAddress: '0xd04011796E34457a4Df4952879464673824DC1CF',
    deployBlock: 32490807n,
    l1Chain: mainnet,
    l1RpcUrl: mainnet.rpcUrls.default.http[0],
  });
  expect(defaultNetwork(lineaSepolia.id)).toMatchObject({
    chain: lineaSepolia,
    paymentsAddress: '0xD2807905E71f4AA10e322aD90726040457ebE825',
    deployBlock: 32601971n,
    l1Chain: sepolia,
  });
});

test('with nothing kept and no fallback, the kept fields are the default network', async () => {
  const fields = await readKeptFields(memoryStore().store);
  expect(fields).toMatchObject({ chainId: linea.id, deployBlock: '32490807' });
});
