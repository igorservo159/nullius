import { expect, test } from 'vitest';
import { lineaSepolia, sepolia } from 'viem/chains';
import { NodeRejected } from '../transactions/transactions';
import { refusalReasons, sendSignedPayment } from './chain';

// Read from the ABI: an error added to or dropped from `contracts/payments.ts` shows up here.
test('refusalReasons holds exactly the five guards of Payments.sol', () => {
  expect([...refusalReasons].sort()).toEqual(
    ['AlreadyPaid', 'OrderIdMismatch', 'TransferFailed', 'ZeroAmount', 'ZeroPayee'],
  );
});

// Port 1 on this machine has nothing listening: the request never gets an answer, so nothing
// says the bytes did not arrive, and the error must not read as a rejection.
test('no answer from the node is not NodeRejected', async () => {
  const network = {
    chain: lineaSepolia,
    rpcUrl: 'http://127.0.0.1:1',
    paymentsAddress: '0x3333333333333333333333333333333333333333',
    deployBlock: 0n,
    l1Chain: sepolia,
    l1RpcUrl: 'https://unused.invalid',
  } as const;

  const failed = await sendSignedPayment(network, '0x02').catch((error: unknown) => error);

  expect(failed).toBeInstanceOf(Error);
  expect(failed).not.toBeInstanceOf(NodeRejected);
});
