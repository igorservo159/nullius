// The Payments contract as the app knows it: the part of its ABI the app uses, written by hand
// from `contracts/src/Payments.sol`, the hash of its code, and where it is published.
// `payments.test.ts` pins every selector against `cast sig`, so a signature typed wrong here fails
// a test instead of a payment.

import { parseAbi, type Address } from 'viem';

export const paymentsAbi = parseAbi([
  'function pay(bytes32 orderId, bytes32 salt, address payee) payable',
  'function paid(bytes32) view returns (bool)',
  'event Payment(bytes32 indexed orderId, address indexed payer, address indexed payee, uint256 amount)',
  'error ZeroPayee()',
  'error ZeroAmount()',
  'error OrderIdMismatch(bytes32 presented, bytes32 derived)',
  'error AlreadyPaid(bytes32 orderId)',
  'error TransferFailed()',
]);

/**
 * keccak256 of the code `Payments.sol` leaves at its address once published. The contract has no
 * constructor and no immutable value, so every deployment of it holds exactly this code: an
 * address whose code hashes to anything else is not Payments. `payments.test.ts` checks it
 * against the output of `forge build`.
 */
export const paymentsCodeHash = '0x623c70c37c272223c538ba83bb848dab2fa2f098842b3228bff7fc32a50194e3';

/**
 * Where Payments is published on each Linea, and the block that published it: no `Payment` log
 * is older. Both are verified on Lineascan; a contract published elsewhere is typed in the network
 * tab instead.
 */
export const paymentsDeployments: Record<number, { address: Address; deployBlock: bigint }> = {
  59144: { address: '0xd04011796E34457a4Df4952879464673824DC1CF', deployBlock: 32490807n },
  59141: { address: '0xD2807905E71f4AA10e322aD90726040457ebE825', deployBlock: 32601971n },
};
