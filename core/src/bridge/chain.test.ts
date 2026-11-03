import { expect, test } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Hex, type TransactionReceipt } from 'viem';
import { messageServiceAbi } from '../contracts/lineaMessageService';
import { messageOf } from './chain';

const service = '0xB218f8A4Bc926cF1cA7b3423c154a0D627Bdb7E5';
const account = '0x575A0b393816aC71bc8E647a466A8aB88c69acbE';
const messageHash: Hex = `0x${'ab'.repeat(32)}`;

// A `MessageSent` log as the message service emits it: sender, receiver and hash as topics; fee,
// value, nonce and data in the body.
function messageSentLog(address: string) {
  return {
    address,
    topics: encodeEventTopics({
      abi: messageServiceAbi,
      eventName: 'MessageSent',
      args: { _from: account, _to: account, _messageHash: messageHash },
    }),
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }],
      [0n, 10n ** 16n, 7n, '0x'],
    ),
  };
}

function receiptWith(logs: ReturnType<typeof messageSentLog>[]): TransactionReceipt {
  return {
    transactionHash: `0x${'cd'.repeat(32)}`,
    blockNumber: 99n,
    logs,
  } as unknown as TransactionReceipt;
}

test('the message is read from the MessageSent the message service emitted', () => {
  expect(messageOf(receiptWith([messageSentLog(service)]), service)).toEqual({
    blockNumber: 99n,
    messageHash,
    messageNonce: 7n,
  });
});

// The same event from another address is not the message service's, and is not read.
test('a receipt without the message service own MessageSent is refused', () => {
  const other = '0x00000000000000000000000000000000000000aa';
  expect(() => messageOf(receiptWith([messageSentLog(other)]), service)).toThrow(
    'no MessageSent',
  );
});
