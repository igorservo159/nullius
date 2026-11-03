// The withdrawals ready to be claimed on the L1, for a user who comes back hours after a
// withdrawal: the chosen account's transfers are resolved when the app opens, and again when the
// account or the network changes, and its claimable withdrawals are added up.

import { useEffect, useState } from 'react';
import { listTransfers, resolveTransfers } from '@nullius/core/bridge';
import { useAdapters } from '../adapters';

const none = { count: 0, valueWei: 0n };

/**
 * How many withdrawals of `account` on `network` can be claimed, and their value together, as the
 * last check found. A check that fails is dropped without a word: the bridge tab reports its own.
 */
export function useClaimable(network, account) {
  const { db } = useAdapters();
  const [claimable, setClaimable] = useState(none);

  useEffect(() => {
    setClaimable(none);
    if (!network || !account) return;
    let stopped = false;
    async function check() {
      try {
        await resolveTransfers(db, network, account);
        const transfers = await listTransfers(db, account, network);
        const claimable = transfers.filter(
          (transfer) => transfer.direction === 'withdrawal' && transfer.status === 'claimable',
        );
        const valueWei = claimable.reduce((sum, transfer) => sum + transfer.valueWei, 0n);
        if (!stopped) setClaimable({ count: claimable.length, valueWei });
      } catch {
        // The bridge tab says why, when it is opened.
      }
    }
    check();
    return () => {
      stopped = true;
    };
  }, [db, network, account]);

  return claimable;
}
