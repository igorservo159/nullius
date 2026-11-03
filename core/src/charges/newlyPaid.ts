// Which charges turned paid between two readings of the list: the notice of a charge paid while
// the app is open.

import type { StoredCharge } from './storage';

/**
 * The charges pending in `before` that are paid in `after`: two readings of the same list, one
 * taken before the logs were read and one after. A charge that `after` holds and `before` did
 * not, a paid one rebuilt from the logs, was never seen pending, and is left out.
 */
export function newlyPaid(before: StoredCharge[], after: StoredCharge[]): StoredCharge[] {
  const pending = new Set(
    before.filter((charge) => charge.paidHash === null).map((charge) => charge.orderId),
  );
  return after.filter((charge) => charge.paidHash !== null && pending.has(charge.orderId));
}
