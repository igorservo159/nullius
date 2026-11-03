// A charge: the order id the Payments contract checks, and the text a payee hands to a payer.

import {
  bytesToHex,
  decodeAbiParameters,
  encodeAbiParameters,
  hexToBytes,
  isAddressEqual,
  isHex,
  keccak256,
  type Address,
  type Hex,
} from 'viem';
import type { Network } from '../network/network';

/** The four fields a payee hands to a payer: everything `pay()` needs except who signs. */
export type Charge = { payee: Address; valueWei: bigint; salt: Hex; orderId: Hex };

// The order `encodeCharge` writes the network and the four fields in, and `decodeCharge` reads
// them back in: six ABI words of 32 bytes, 192 bytes in all.
const chargeLayout = [
  { type: 'uint256' },
  { type: 'address' },
  { type: 'address' },
  { type: 'uint256' },
  { type: 'bytes32' },
  { type: 'bytes32' },
] as const;

// 192 bytes in base64url: every 3 bytes become 4 characters, and 192 is a multiple of 3, so
// there is no `=` padding at the end.
const chargeText = /^[A-Za-z0-9_-]{256}$/;

/** A well-formed charge made for another chain or another Payments contract than this one. */
export class ChargeOnOtherNetwork extends Error {
  readonly chainId: bigint;
  readonly paymentsAddress: Address;

  constructor(chainId: bigint, paymentsAddress: Address) {
    super(`the charge is for contract ${paymentsAddress} on chain ${chainId}`);
    this.name = 'ChargeOnOtherNetwork';
    this.chainId = chainId;
    this.paymentsAddress = paymentsAddress;
  }
}

/**
 * 32 random bytes from the platform's cryptographic generator, as 0x-prefixed hex.
 *
 * The salt is what separates two charges that are otherwise identical: payee and amount are
 * public and guessable, so all of the order id's unpredictability comes from here. On the phone,
 * `crypto.getRandomValues` exists only because `mobile/index.js` imports
 * `react-native-get-random-values` first.
 */
export function randomSalt(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * The order id of a charge: `keccak256(abi.encode(payee, valueWei, salt))`.
 *
 * `encodeAbiParameters` takes the three values as a parameter list, which is what Solidity's
 * `abi.encode(a, b, c)` produces. The vector pinned in `contracts/test/Payments.t.sol` is what
 * holds that equality, and `charge.test.ts` is what catches a one-byte divergence here before
 * it reaches the chain with money in the transaction.
 *
 * viem already throws on a malformed payee, on a value outside uint256 and on a salt that is
 * not 32 bytes long, but it hashes a salt with non-hex characters without complaining. The
 * check below closes that one gap.
 */
export function orderId(payee: Address, valueWei: bigint, salt: Hex): Hex {
  if (!isHex(salt)) throw new Error(`salt "${salt}" is not hex`);
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
      [payee, valueWei, salt],
    ),
  );
}

/**
 * The charge as one base64url text of 256 characters: `abi.encode(chainId, paymentsAddress,
 * payee, valueWei, salt, orderId)` of the network it is to be paid on. No field name and no
 * app name in it; encoding is not hiding — anyone decodes it, and every field is public in the
 * pay transaction anyway.
 */
export function encodeCharge(charge: Charge, network: Network): string {
  return toBase64Url(
    encodeAbiParameters(chargeLayout, [
      BigInt(network.chain.id),
      network.paymentsAddress,
      charge.payee,
      charge.valueWei,
      charge.salt,
      charge.orderId,
    ]),
  );
}

/**
 * The charge written in `text` by `encodeCharge`, or an error.
 *
 * A charge for another chain or contract is refused with `ChargeOnOtherNetwork` even when it is
 * well formed: paid here, its value would go through a contract the payee is not watching. The
 * order id recomputed from payee, amount and salt is what proves the text is a charge, and that
 * no field changed between the payee's screen and this one.
 */
export function decodeCharge(text: string, network: Network): Charge {
  const trimmed = text.trim();
  if (!chargeText.test(trimmed)) {
    throw new Error('a charge is 256 characters of base64url');
  }
  const [chainId, paymentsAddress, payee, valueWei, salt, presented] = decodeAbiParameters(
    chargeLayout,
    fromBase64Url(trimmed),
  );
  if (
    chainId !== BigInt(network.chain.id) ||
    !isAddressEqual(paymentsAddress, network.paymentsAddress)
  ) {
    throw new ChargeOnOtherNetwork(chainId, paymentsAddress);
  }
  const derived = orderId(payee, valueWei, salt);
  if (derived !== presented) {
    throw new Error(`order id ${presented} does not match ${derived}`);
  }
  return { payee, valueWei, salt, orderId: presented };
}

// `btoa` and `atob` work on "binary strings", one character per byte; base64url is base64 with
// `-` and `_` in place of `+` and `/`, the two characters a URL would need escaped.
function toBase64Url(hex: Hex): string {
  const binary = String.fromCharCode(...hexToBytes(hex));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64Url(text: string): Hex {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return bytesToHex(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}
