// `pay()` against the real Payments, on anvil. Run with `npm run test:integration`.

import { afterEach, beforeEach, describe, expect, inject, test, vi } from 'vitest';
import { createWalletClient, encodeFunctionData, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { lineaSepolia } from 'viem/chains';
import type { SecretStore } from '../accounts/accounts';
import { anvilPayerKey } from '../anvil.setup';
import { anvilClient, anvilNetwork } from '../anvilNetwork';
import { orderId } from '../charges/rules';
import { paymentsAbi } from '../contracts/payments';
import { checkNode, readerFor } from '../network/network';
import { NodeRejected, TransactionInFlight } from '../transactions/transactions';
import {
  PaymentRefused,
  revertReasonOf,
  sendSignedPayment,
  signPayment,
  waitForPayment,
  type Payment,
} from './chain';

const anvil = inject('anvil');

// anvil's second default account: it only receives.
const payee = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const payer = privateKeyToAccount(anvilPayerKey).address;
const salt: Hex = '0x2222222222222222222222222222222222222222222222222222222222222222';
const valueWei = 10n ** 15n;

describe.skipIf(anvil === null)('paying on anvil', () => {
  const network = anvilNetwork(anvil);
  const chain = anvilClient(network);

  // Every test starts from the chain as the setup left it: a payment made by one test does not
  // leave its orderId already paid for the next.
  let snapshot: Hex;
  beforeEach(async () => {
    snapshot = await chain.snapshot();
  });
  afterEach(async () => {
    await chain.revert({ id: snapshot });
  });

  // A store holding the payer's key, whose reads are counted: a read is where the phone asks
  // for a fingerprint.
  function keyStore() {
    const get = vi.fn(async (_name: string) => anvilPayerKey as string | null);
    const store: SecretStore = { get, set: async () => {}, remove: async () => {} };
    return { store, get };
  }

  const payment: Payment = {
    payer,
    payee,
    valueWei,
    salt,
    orderId: orderId(payee, valueWei, salt),
  };

  test('checkNode accepts anvil with Payments deployed', async () => {
    await expect(checkNode(network)).resolves.toBeUndefined();
  });

  test('checkNode refuses an address that holds no contract', async () => {
    await expect(checkNode({ ...network, paymentsAddress: payee })).rejects.toThrow('no contract');
  });

  // Signs, sends and waits, as the pay tab does without the database in between.
  async function pay(store: SecretStore) {
    const signed = await signPayment(store, network, payment);
    await sendSignedPayment(network, signed.signed);
    return { signed, outcome: await waitForPayment(network, signed.hash) };
  }

  test('a payment executes and moves the value to the payee', async () => {
    const { store } = keyStore();
    const before = await readerFor(network).getBalance({ address: payee });

    const { outcome } = await pay(store);

    expect(outcome.status).toBe('success');
    expect(await readerFor(network).getBalance({ address: payee })).toBe(before + valueWei);
  });

  // The receipt is found by the hash computed from the signed bytes, before the node answered.
  test('the hash and nonce of the signed bytes are the ones the chain records', async () => {
    const { store } = keyStore();
    const countBefore = await readerFor(network).getTransactionCount({ address: payer });

    const { signed } = await pay(store);

    const executed = await readerFor(network).getTransaction({ hash: signed.hash });
    expect(executed.nonce).toBe(countBefore);
    expect(signed.nonce).toBe(countBefore);
  });

  test('signing sends nothing: the account nonce does not move', async () => {
    const { store } = keyStore();
    const before = await readerFor(network).getTransactionCount({ address: payer, blockTag: 'pending' });

    await signPayment(store, network, payment);

    expect(
      await readerFor(network).getTransactionCount({ address: payer, blockTag: 'pending' }),
    ).toBe(before);
  });

  // The same bytes again, after they executed: the nonce they carry is spent, and the node says so.
  test('bytes the node answers with an error come back as NodeRejected', async () => {
    const { store } = keyStore();
    const { signed } = await pay(store);

    const rejected = await sendSignedPayment(network, signed.signed).catch((error: unknown) => error);

    expect(rejected).toBeInstanceOf(NodeRejected);
    expect(String(rejected)).toMatch(/nonce/i);
  });

  // With automine off the first payment stays in anvil's pool: pending is one above latest.
  test('a payment in flight stops the next one before the key is read', async () => {
    const { store, get } = keyStore();
    const otherSalt: Hex = '0x3333333333333333333333333333333333333333333333333333333333333333';
    const other = { ...payment, salt: otherSalt, orderId: orderId(payee, valueWei, otherSalt) };
    await chain.setAutomine(false);
    try {
      const first = await signPayment(store, network, payment);
      await sendSignedPayment(network, first.signed);
      get.mockClear();

      const refused = await signPayment(store, network, other).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(TransactionInFlight);
      expect(refused).toMatchObject({ pending: first.nonce + 1, latest: first.nonce });
      expect(get).not.toHaveBeenCalled();
    } finally {
      await chain.mine({ blocks: 1 });
      await chain.setAutomine(true);
    }
  });

  // `signPayment` simulates first and never signs a payment that would revert, so the two
  // transactions here are signed without it, with fixed gas so nothing estimates them, and
  // mined in one block: the second pays the order the first has just paid.
  test('a reverted payment says which guard fired, and what it used', async () => {
    const wallet = createWalletClient({
      account: privateKeyToAccount(anvilPayerKey),
      chain: lineaSepolia,
      transport: http(network.rpcUrl),
    });
    const data = encodeFunctionData({
      abi: paymentsAbi,
      functionName: 'pay',
      args: [payment.orderId, payment.salt, payment.payee],
    });
    const nonce = await readerFor(network).getTransactionCount({ address: payer });
    await chain.setAutomine(false);
    try {
      const send = (n: number) =>
        wallet.sendTransaction({
          to: network.paymentsAddress,
          data,
          value: valueWei,
          gas: 200_000n,
          nonce: n,
        });
      const first = await send(nonce);
      const second = await send(nonce + 1);
      await chain.mine({ blocks: 1 });

      expect(await waitForPayment(network, first)).toMatchObject({
        status: 'success',
        revertReason: null,
      });
      const reverted = await waitForPayment(network, second);
      expect(reverted).toMatchObject({ status: 'reverted', revertReason: 'AlreadyPaid' });
      expect(reverted.gasUsed).toBeGreaterThan(0n);
      expect(reverted.effectiveGasPrice).toBeGreaterThan(0n);
    } finally {
      await chain.setAutomine(true);
    }
  });

  // anvil answers a trace of a hash it never saw with an error: the reason cannot be found.
  test('a trace the node answers with an error gives unknown', async () => {
    const neverSent: Hex = `0x${'ab'.repeat(32)}`;
    expect(await revertReasonOf(readerFor(network), neverSent)).toBe('unknown');
  });

  test('paying the same order twice is refused as AlreadyPaid, before the key is read', async () => {
    const { store, get } = keyStore();
    await pay(store);
    get.mockClear();

    const refused = await signPayment(store, network, payment).catch((error) => error);

    expect(refused).toBeInstanceOf(PaymentRefused);
    expect(refused.reason).toBe('AlreadyPaid');
    expect(get).not.toHaveBeenCalled();
  });

  test('an orderId that does not match is refused as OrderIdMismatch, before the key is read', async () => {
    const { store, get } = keyStore();
    const tampered = { ...payment, valueWei: valueWei + 1n };

    const refused = await signPayment(store, network, tampered).catch((error) => error);

    expect(refused).toBeInstanceOf(PaymentRefused);
    expect(refused.reason).toBe('OrderIdMismatch');
    expect(get).not.toHaveBeenCalled();
  });
});
