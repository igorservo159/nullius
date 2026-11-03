import { expect, test } from 'vitest';
import { newlyPaid } from './newlyPaid';
import { orderId, randomSalt, type Charge } from './rules';

const payee = '0x1111111111111111111111111111111111111111';
const payingHash: `0x${string}` = `0x${'aa'.repeat(32)}`;

function newCharge(chargePayee: Charge['payee'], valueWei: bigint): Charge {
  const salt = randomSalt();
  return { payee: chargePayee, valueWei, salt, orderId: orderId(chargePayee, valueWei, salt) };
}

// Charge `waiting` stays pending, `paidNow` turns paid, `paidBefore` was paid already, and
// `rebuilt` appears paid without ever being pending.
test('newly paid charges are the pending ones that turned paid', () => {
  const waiting = { ...newCharge(payee, 1n), createdAt: 1, paidHash: null, paidBlock: null };
  const paidNow = { ...newCharge(payee, 2n), createdAt: 2, paidHash: null, paidBlock: null };
  const paidBefore = { ...newCharge(payee, 3n), createdAt: 3, paidHash: payingHash, paidBlock: 5n };
  const rebuilt = { ...newCharge(payee, 4n), createdAt: 4, paidHash: payingHash, paidBlock: 6n };
  const paidNowAfter = { ...paidNow, paidHash: payingHash, paidBlock: 7n };

  const before = [waiting, paidNow, paidBefore];
  const after = [waiting, paidNowAfter, paidBefore, rebuilt];
  expect(newlyPaid(before, after)).toEqual([paidNowAfter]);
});
