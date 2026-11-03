// The global setup of `npm run test:integration`: starts anvil on a free port with the real
// Payments deployed, hands its address to the tests, and stops anvil when they end.
//
// Without anvil or without `forge build`'s artifact the tests are skipped — unless `CI` is set,
// where a missing tool is a failure and not a skip.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { lineaSepolia } from 'viem/chains';
import type { TestProject } from 'vitest/node';
import { paymentsAbi } from './contracts/payments';
import { readerFor } from './network/network';

declare module 'vitest' {
  export interface ProvidedContext {
    anvil: { rpcUrl: string; paymentsAddress: Address; deployBlock: number } | null;
  }
}

const artifactPath = new URL('../../contracts/out/Payments.sol/Payments.json', import.meta.url);

/** anvil's first default account, funded at start: it deploys the contract and pays. */
export const anvilPayerKey: Hex =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

/** A port nothing listens on: the system picks one for port 0, and it is released at once. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/** Retries `eth_chainId` until anvil answers, for at most five seconds. */
async function untilAnswering(rpcUrl: string): Promise<void> {
  const reader = readerFor({
    chain: lineaSepolia,
    rpcUrl,
    paymentsAddress: '0x',
    deployBlock: 0n,
    l1Chain: lineaSepolia,
    l1RpcUrl: rpcUrl,
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await reader.getChainId();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`anvil did not answer at ${rpcUrl}`);
}

export default async function setup(project: TestProject) {
  const hasAnvil = spawnSync('anvil', ['--version']).status === 0;
  const hasArtifact = existsSync(artifactPath);
  if (!hasAnvil || !hasArtifact) {
    const missing = hasAnvil ? 'the output of `forge build` in contracts/' : 'anvil';
    if (process.env.CI) throw new Error(`the integration tests need ${missing}`);
    console.warn(`skipping the integration tests: ${missing} is missing`);
    project.provide('anvil', null);
    return;
  }

  // The chain id of Linea Sepolia, so the app's own `chainById` and viem's chain checks accept it.
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn('anvil', ['--port', String(port), '--chain-id', String(lineaSepolia.id), '--silent']);
  await untilAnswering(rpcUrl);

  const bytecode = JSON.parse(readFileSync(artifactPath, 'utf8')).bytecode.object as Hex;
  const deployer = createWalletClient({
    account: privateKeyToAccount(anvilPayerKey),
    chain: lineaSepolia,
    transport: http(rpcUrl),
  });
  const hash = await deployer.deployContract({ abi: paymentsAbi, bytecode });
  const network = {
    chain: lineaSepolia,
    rpcUrl,
    paymentsAddress: '0x' as Address,
    deployBlock: 0n,
    l1Chain: lineaSepolia,
    l1RpcUrl: rpcUrl,
  };
  const receipt = await readerFor(network).waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error('deploying Payments on anvil created no contract');

  // A number, not a bigint: what `provide` hands over must survive the trip to the test workers.
  project.provide('anvil', {
    rpcUrl,
    paymentsAddress: receipt.contractAddress,
    deployBlock: Number(receipt.blockNumber),
  });
  return () => {
    anvil.kill();
  };
}
