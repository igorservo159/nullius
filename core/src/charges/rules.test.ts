import { expect, test } from 'vitest';
import { linea, lineaSepolia, sepolia } from 'viem/chains';
import type { Network } from '../network/network';
import { ChargeOnOtherNetwork, decodeCharge, encodeCharge, orderId, randomSalt } from './rules';

// The vector pinned in `contracts/test/Payments.t.sol`, computed outside Solidity.
const pinnedPayee = '0x1111111111111111111111111111111111111111';
const pinnedValueWei = 10n ** 18n;
const pinnedSalt = '0x2222222222222222222222222222222222222222222222222222222222222222';
const pinnedOrderId = '0x869211b2d967910689ad25d3ba8335e13e467de5f15abeff18cb3aa3663fdfcb';

// If this fails, the wire format of the order id diverged between TypeScript and Solidity,
// and no submission is safe.
test('orderId matches the contract vector', () => {
  expect(orderId(pinnedPayee, pinnedValueWei, pinnedSalt)).toBe(pinnedOrderId);
});

// One wei apart yields a different order id: that is what lets the contract reject a call
// whose value is not the one the order committed to.
test('one wei changes the order id', () => {
  const orderIdOneWeiAbove = orderId(pinnedPayee, pinnedValueWei + 1n, pinnedSalt);
  expect(orderIdOneWeiAbove).not.toBe(pinnedOrderId);
});

// viem hashes a non-hex salt without an error, so orderId has to refuse it itself.
test('orderId refuses a non-hex salt', () => {
  const nonHexSalt = `0x${'zz'.repeat(32)}` as const;
  expect(() => orderId(pinnedPayee, pinnedValueWei, nonHexSalt)).toThrow('is not hex');
});

// `bytes32` in the encoding refuses any other size, so a salt of the wrong length would fail
// only when the order id is computed, far from where the salt was drawn.
test('randomSalt draws 32 bytes', () => {
  expect(randomSalt()).toMatch(/^0x[0-9a-f]{64}$/);
});

const pinnedCharge = {
  payee: pinnedPayee,
  valueWei: pinnedValueWei,
  salt: pinnedSalt,
  orderId: pinnedOrderId,
} as const;

// Only `chain.id` and `paymentsAddress` reach the charge; the node is never asked.
const sepoliaNetwork: Network = {
  chain: lineaSepolia,
  rpcUrl: 'https://unused.invalid',
  paymentsAddress: '0x3333333333333333333333333333333333333333',
  deployBlock: 0n,
  l1Chain: sepolia,
  l1RpcUrl: 'https://unused.invalid',
};

test('a charge is 256 characters of base64url', () => {
  expect(encodeCharge(pinnedCharge, sepoliaNetwork)).toMatch(/^[A-Za-z0-9_-]{256}$/);
});

test('a charge decodes to the four fields it was encoded from', () => {
  const text = encodeCharge(pinnedCharge, sepoliaNetwork);
  expect(decodeCharge(text, sepoliaNetwork)).toEqual(pinnedCharge);
});

// The order id is what the decoder checks the other three against: a text whose order id does
// not hash from its payee, amount and salt is refused before it reaches the pay tab's fields.
test('a charge whose order id does not match is refused', () => {
  const tampered = { ...pinnedCharge, valueWei: pinnedValueWei + 1n };
  expect(() => decodeCharge(encodeCharge(tampered, sepoliaNetwork), sepoliaNetwork)).toThrow(
    /does not match/,
  );
});

test('a charge made for another chain is refused', () => {
  const text = encodeCharge(pinnedCharge, { ...sepoliaNetwork, chain: linea });
  expect(() => decodeCharge(text, sepoliaNetwork)).toThrow(ChargeOnOtherNetwork);
});

test('a charge made for another contract is refused', () => {
  const otherContract = '0x4444444444444444444444444444444444444444';
  const text = encodeCharge(pinnedCharge, { ...sepoliaNetwork, paymentsAddress: otherContract });
  expect(() => decodeCharge(text, sepoliaNetwork)).toThrow(ChargeOnOtherNetwork);
});

test('a text that is not a charge is refused', () => {
  const text = encodeCharge(pinnedCharge, sepoliaNetwork);
  expect(() => decodeCharge('hello', sepoliaNetwork)).toThrow(/256 characters/);
  expect(() => decodeCharge(`${text}A`, sepoliaNetwork)).toThrow(/256 characters/);
  expect(() => decodeCharge(text.replace(/^./, '+'), sepoliaNetwork)).toThrow(/256 characters/);
});
