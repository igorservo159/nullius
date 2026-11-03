// Linea's canonical message service, on the L1 and on Linea: the part of its ABI the app uses,
// and where it lives on each network.

import { parseAbi, type Address } from 'viem';
import { linea } from 'viem/chains';

/**
 * The part of the message service's ABI the app uses, on either side. `MessageSent` indexes the
 * sender, the receiver and the message hash, as a log of it on Linea shows.
 */
export const messageServiceAbi = parseAbi([
  'function sendMessage(address _to, uint256 _fee, bytes _calldata) payable',
  'event MessageSent(address indexed _from, address indexed _to, uint256 _fee, uint256 _value, uint256 _nonce, bytes _calldata, bytes32 indexed _messageHash)',
  'function inboxL1L2MessageStatus(bytes32 messageHash) view returns (uint256)',
  'function minimumFeeInWei() view returns (uint256)',
]);

/**
 * The part of the L1 message service's ABI only the L1 has: the claim of a message sent from
 * Linea, with its proof, and whether a message number was claimed. As Linea's SDK declares them.
 */
export const l1MessageServiceAbi = parseAbi([
  'struct ClaimMessageWithProofParams { bytes32[] proof; uint256 messageNumber; uint32 leafIndex; address from; address to; uint256 fee; uint256 value; address feeRecipient; bytes32 merkleRoot; bytes data; }',
  'function claimMessageWithProof(ClaimMessageWithProofParams _params)',
  'function isMessageClaimed(uint256 _messageNumber) view returns (bool)',
]);

/**
 * Where the message service lives on each side, from Linea's documentation: on Ethereum and
 * Sepolia it is the rollup contract itself, on each Linea its own contract.
 */
export function messageServicesOf(chainId: number): { l1: Address; l2: Address } {
  return chainId === linea.id
    ? {
        l1: '0xd19d4B5d358258f05D7B411E21A1460D11B0876F',
        l2: '0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec',
      }
    : {
        l1: '0xB218f8A4Bc926cF1cA7b3423c154a0D627Bdb7E5',
        l2: '0x971e727e956690b9957be6d51Ec16E73AcAC83A7',
      };
}
