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
  const unpaid = { paidHash: null, paidBlock: null, paidFinalized: false };
  const waiting = { ...newCharge(payee, 1n), createdAt: 1, ...unpaid };
  const paidNow = { ...newCharge(payee, 2n), createdAt: 2, ...unpaid };
  const paidBefore = {
    ...newCharge(payee, 3n),
    createdAt: 3,
    paidHash: payingHash,
    paidBlock: 5n,
    paidFinalized: false,
  };
  const rebuilt = {
    ...newCharge(payee, 4n),
    createdAt: 4,
    paidHash: payingHash,
    paidBlock: 6n,
    paidFinalized: false,
  };
  const paidNowAfter = { ...paidNow, paidHash: payingHash, paidBlock: 7n };

  const before = [waiting, paidNow, paidBefore];
  const after = [waiting, paidNowAfter, paidBefore, rebuilt];
  expect(newlyPaid(before, after)).toEqual([paidNowAfter]);
});
