// The sentence the user reads for each guard of `Payments.sol`. A `Record` over
// `RefusalReason` makes `npm run typecheck` fail when a guard has no sentence.

import type { RefusalReason, RevertReason } from '@nullius/core/payments';

export const refusalSentences: Record<RefusalReason, string> = {
  AlreadyPaid:
    'This charge was already paid. The contract keeps the order ids it settled and refuses a ' +
    'second payment of one: nothing left your account.',
  OrderIdMismatch:
    'The order id does not match payee, amount and salt. The contract hashes what it was given ' +
    'and refuses when the result is another.',
  ZeroPayee: 'The payee is the zero address, and sending there would burn the amount.',
  ZeroAmount: 'The amount is zero: it would be a payment of nothing.',
  TransferFailed: 'The payee refused the amount, so the whole transaction was undone.',
};

// The title of the notice for each guard that refused a payment at simulation.
export const refusalTitles: Record<RefusalReason, string> = {
  AlreadyPaid: 'Charge already paid',
  OrderIdMismatch: 'Order id does not match',
  ZeroPayee: 'Zero payee',
  ZeroAmount: 'Zero amount',
  TransferFailed: 'Payee refused the amount',
};

// The short name the list and the result give the guard that reverted a mined payment. Unlike
// the sentences above, nothing here says the account kept its money: the fee was paid.
export const revertWords: Record<RevertReason, string> = {
  AlreadyPaid: 'charge already paid',
  OrderIdMismatch: 'order id does not match',
  ZeroPayee: 'zero payee',
  ZeroAmount: 'zero amount',
  TransferFailed: 'payee refused the amount',
  unknown: 'unknown reason',
};
