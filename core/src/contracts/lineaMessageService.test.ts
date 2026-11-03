import { expect, test } from 'vitest';
import { linea, lineaSepolia } from 'viem/chains';
import { messageServicesOf } from './lineaMessageService';

// The four addresses from Linea's documentation, each checked to hold code on its chain.
test('the message services are the documented ones', () => {
  expect(messageServicesOf(linea.id)).toEqual({
    l1: '0xd19d4B5d358258f05D7B411E21A1460D11B0876F',
    l2: '0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec',
  });
  expect(messageServicesOf(lineaSepolia.id)).toEqual({
    l1: '0xB218f8A4Bc926cF1cA7b3423c154a0D627Bdb7E5',
    l2: '0x971e727e956690b9957be6d51Ec16E73AcAC83A7',
  });
});
