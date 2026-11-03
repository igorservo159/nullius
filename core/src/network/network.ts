// The network the app pays on: which chain, which node answers, and where Payments lives.

import {
  BaseError,
  createPublicClient,
  getAddress,
  http,
  isAddress,
  keccak256,
  type Address,
  type Chain,
  type PublicClient,
} from 'viem';
import { linea, lineaSepolia, mainnet, sepolia } from 'viem/chains';
import type { SecretStore } from '../accounts/accounts';
import { paymentsCodeHash, paymentsDeployments } from '../contracts/payments';
import { answeredWithError } from '../transactions/transactions';

/**
 * Everything the app needs to reach the contract. `defaultNetwork` builds it from where Payments
 * is published, and `openStoredNetwork` replaces it with the network kept on the phone, if any.
 * `deployBlock` is the block that published `paymentsAddress`: no `Payment` log is older.
 * `l1Chain` is the Ethereum chain `chain` settles on, and `l1RpcUrl` the node asked about it.
 */
export type Network = {
  chain: Chain;
  rpcUrl: string;
  paymentsAddress: Address;
  deployBlock: bigint;
  l1Chain: Chain;
  l1RpcUrl: string;
};

const knownChains: Chain[] = [lineaSepolia, linea];

/** The viem chain for a chain id. Any id other than Linea Sepolia's or Linea's is refused. */
export function chainById(id: number): Chain {
  const chain = knownChains.find((candidate) => candidate.id === id);
  if (chain === undefined) {
    throw new Error(`chain id ${id} is neither Linea Sepolia (59141) nor Linea (59144)`);
  }
  return chain;
}

/**
 * The Ethereum chain each Linea settles on. viem leaves this out of Linea's chains, so it is
 * written here, next to the two chains the app knows.
 */
export function l1ChainOf(chain: Chain): Chain {
  return chain.id === linea.id ? mainnet : sepolia;
}

/**
 * The network the app pays on when none is kept on the phone: Payments where it is published on
 * the chain `chainId`, Linea unless asked, through the public nodes viem lists for that chain and
 * its L1.
 */
export function defaultNetwork(chainId: number = linea.id): Network {
  const chain = chainById(chainId);
  const l1Chain = l1ChainOf(chain);
  const { address, deployBlock } = paymentsDeployments[chain.id];
  return {
    chain,
    rpcUrl: chain.rpcUrls.default.http[0],
    paymentsAddress: address,
    deployBlock,
    l1Chain,
    l1RpcUrl: l1Chain.rpcUrls.default.http[0],
  };
}

/**
 * The most blocks one log search on Linea asks for. Linea Sepolia's public node declares 10000,
 * but answers "service temporarily unavailable" well before that; 2000 is what it serves, and
 * Linea's public node serves it too.
 */
export const sliceBlocks = 2000n;

/** A client that only reads from the node: no account, nothing signed. */
export function readerFor(network: Network): PublicClient {
  return createPublicClient({ chain: network.chain, transport: http(network.rpcUrl) });
}

/** The same as `readerFor`, for the L1 node. */
export function l1ReaderFor(network: Network): PublicClient {
  return createPublicClient({ chain: network.l1Chain, transport: http(network.l1RpcUrl) });
}

/** Why a network was not accepted: which check refused it, and the values it was given. */
export type NetworkRefusal =
  | 'notHttps'
  | 'l1NotHttps'
  | 'notAddress'
  | 'notBlockNumber'
  | 'otherChain'
  | 'otherL1Chain'
  | 'noContract'
  | 'notPayments'
  | 'notDeployedAt'
  | 'deployedBefore'
  | 'noOldState';

/**
 * A network refused by one of the checks below. `reason` names the check; the message carries the
 * values. The sentence a user reads belongs to the screen, as with `PaymentRefused`.
 */
export class NetworkRefused extends Error {
  readonly reason: NetworkRefusal;

  constructor(reason: NetworkRefusal, message: string) {
    super(message);
    this.name = 'NetworkRefused';
    this.reason = reason;
  }
}

/**
 * Asks the node three questions before the app trusts it.
 *
 * Which chain it serves: a node of another chain would take transactions signed for one chain
 * id that no node of this one ever executes. Whether the Payments address holds code: a call
 * to an address without code succeeds as a plain transfer, so the value would stay at that
 * address with none of the contract's guards ever running. Whether that code is Payments: any
 * other contract would take `pay()`'s call with none of these guards, or with others.
 */
export async function checkNode(network: Network): Promise<void> {
  const reader = readerFor(network);

  const chainId = await reader.getChainId();
  if (chainId !== network.chain.id) {
    throw new NetworkRefused(
      'otherChain',
      `the node at ${network.rpcUrl} serves chain ${chainId}, not ${network.chain.id}`,
    );
  }

  const code = await reader.getCode({ address: network.paymentsAddress });
  if (code === undefined || code === '0x') {
    throw new NetworkRefused(
      'noContract',
      `there is no contract at ${network.paymentsAddress} on chain ${chainId}`,
    );
  }
  if (keccak256(code) !== paymentsCodeHash) {
    throw new NetworkRefused(
      'notPayments',
      `the contract at ${network.paymentsAddress} on chain ${chainId} is not Payments`,
    );
  }
}

// The code at `address` in an old block. A node that keeps only recent state answers such a
// request with an error; that is said as `noOldState`, apart from a node that does not answer.
async function codeAt(network: Network, blockNumber: bigint) {
  try {
    return await readerFor(network).getCode({ address: network.paymentsAddress, blockNumber });
  } catch (error) {
    if (error instanceof BaseError && answeredWithError(error)) {
      throw new NetworkRefused(
        'noOldState',
        `the node at ${network.rpcUrl} has no state for block ${blockNumber}: ${error.details}`,
      );
    }
    throw error;
  }
}

/**
 * Asks the L1 node which chain it serves: a node of another chain would show balances of another
 * network, and sign deposits no node of the right one executes. It is checked when a network is
 * saved, not at every opening: payments never ask the L1, and a node down there must not stop them.
 */
export async function checkL1Node(network: Network): Promise<void> {
  const chainId = await l1ReaderFor(network).getChainId();
  if (chainId !== network.l1Chain.id) {
    throw new NetworkRefused(
      'otherL1Chain',
      `the node at ${network.l1RpcUrl} serves chain ${chainId}, not ${network.l1Chain.id}`,
    );
  }
}

/**
 * Confirms `deployBlock` is the block that published the contract: its code is there at that
 * block and absent at the one before. A block typed too high would make the history skip the
 * payments before it. This asks the node for the state of old blocks, which a node that keeps
 * only recent state cannot answer.
 */
export async function checkDeployBlock(network: Network): Promise<void> {
  const address = network.paymentsAddress;
  const at = await codeAt(network, network.deployBlock);
  if (at === undefined || at === '0x') {
    throw new NetworkRefused(
      'notDeployedAt',
      `there is no contract at ${address} in block ${network.deployBlock}`,
    );
  }
  if (network.deployBlock === 0n) return;
  const before = await codeAt(network, network.deployBlock - 1n);
  if (before !== undefined && before !== '0x') {
    throw new NetworkRefused(
      'deployedBefore',
      `the contract at ${address} already existed before block ${network.deployBlock}`,
    );
  }
}

/**
 * Where the network chosen on the phone is kept, as JSON of `NetworkFields`. It is outside
 * `keyPrefix`: read with no biometric.
 */
export const networkName = 'network';

/**
 * The network as the network tab types it and as the phone keeps it: text, not yet checked.
 */
export type NetworkFields = {
  chainId: number;
  paymentsAddress: string;
  deployBlock: string;
  rpcUrl: string;
  l1RpcUrl: string;
};

/**
 * The only nodes accepted. A plain pattern, not `new URL`: React Native's `URL` is a shim that
 * validates nothing, so the same text would be judged differently on the phone and in the tests.
 */
const httpsUrl = /^https:\/\/\S+$/i;

/**
 * The `Network` the fields describe, refused when one of them is not well formed; nothing is
 * asked of a node yet. An empty node means the chain's public node, the one viem lists for it,
 * and the same for the L1 node.
 */
export function networkOf(fields: NetworkFields): Network {
  const chain = chainById(fields.chainId);
  const l1Chain = l1ChainOf(chain);

  const typedUrl = fields.rpcUrl.trim();
  const rpcUrl = typedUrl === '' ? chain.rpcUrls.default.http[0] : typedUrl;
  if (rpcUrl === undefined || !httpsUrl.test(rpcUrl)) {
    throw new NetworkRefused('notHttps', `the node must be an https:// URL: ${typedUrl}`);
  }

  const address = fields.paymentsAddress.trim();
  if (!isAddress(address, { strict: false })) {
    throw new NetworkRefused('notAddress', `the contract is not an address: ${address}`);
  }

  const block = fields.deployBlock.trim();
  if (!/^\d+$/.test(block)) {
    throw new NetworkRefused('notBlockNumber', `the deploy block is not a block number: ${block}`);
  }

  const typedL1Url = fields.l1RpcUrl.trim();
  const l1RpcUrl = typedL1Url === '' ? l1Chain.rpcUrls.default.http[0] : typedL1Url;
  if (l1RpcUrl === undefined || !httpsUrl.test(l1RpcUrl)) {
    throw new NetworkRefused('l1NotHttps', `the L1 node must be an https:// URL: ${typedL1Url}`);
  }

  return {
    chain,
    rpcUrl,
    paymentsAddress: getAddress(address),
    deployBlock: BigInt(block),
    l1Chain,
    l1RpcUrl,
  };
}

// The fields that describe `network`, as the phone keeps them.
function fieldsOf(network: Network): NetworkFields {
  return {
    chainId: network.chain.id,
    paymentsAddress: network.paymentsAddress,
    deployBlock: String(network.deployBlock),
    rpcUrl: network.rpcUrl,
    l1RpcUrl: network.l1RpcUrl,
  };
}

/**
 * The fields of the network kept on the phone, unchecked, for the network tab to show: the
 * `network` entry when there is one, else `defaultNetwork`'s fields.
 */
export async function readKeptFields(
  store: SecretStore,
  fallback: Network = defaultNetwork(),
): Promise<NetworkFields> {
  const kept = await store.get(networkName);
  return kept === null ? fieldsOf(fallback) : (JSON.parse(kept) as NetworkFields);
}

/**
 * The network the app opens with: the one kept on the phone, or `fallback`, `defaultNetwork` unless
 * a test gives another. Either way `checkNode` accepts it before it is returned.
 */
export async function openStoredNetwork(
  store: SecretStore,
  fallback: Network = defaultNetwork(),
): Promise<Network> {
  const network = networkOf(await readKeptFields(store, fallback));
  await checkNode(network);
  return network;
}

/**
 * Makes the network in `fields` the one the app uses, now and at every opening. Every check runs
 * before the store is touched, so a network that fails one is never kept and the previous choice
 * stays.
 */
export async function saveNetwork(store: SecretStore, fields: NetworkFields): Promise<Network> {
  const network = networkOf(fields);
  await checkNode(network);
  await checkDeployBlock(network);
  await checkL1Node(network);
  await store.set(networkName, JSON.stringify(fieldsOf(network)));
  return network;
}

/**
 * Forgets the network kept on the phone and goes back to `fallback`, `defaultNetwork` unless a test
 * gives another, once `checkNode` accepts it.
 */
export async function resetNetwork(
  store: SecretStore,
  fallback: Network = defaultNetwork(),
): Promise<Network> {
  await checkNode(fallback);
  await store.remove(networkName);
  return fallback;
}
