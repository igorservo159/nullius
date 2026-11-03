// The charges paid while the app is open: a reading of the chosen account's logs every few
// seconds, and a notice for the charges that turned from pending to paid.

import { useEffect, useState } from 'react';
import { listCharges, newlyPaid } from '@nullius/core/charges';
import { readHistory } from '@nullius/core/history';
import { useAdapters } from '../adapters';
import { formatEth, shortAddress } from '../theme/format';

// How often the logs are read while the app is open. Each reading after the first is usually one
// slice: the block number and two log searches.
const watchMs = 10_000;

/**
 * Watches `account` on `network` and puts up a notice through `show` when charges get paid.
 * Returns the charges the last such reading found paid, so the receive tab can read its list
 * again. Only the chosen account is watched.
 *
 * A reading that has not finished when the next one is due is not doubled: the next one is
 * skipped. A reading that fails is dropped without a word; the tabs report their own readings,
 * and the next one here tries again.
 */
export function usePaidCharges(network, account, show) {
  const { db } = useAdapters();
  const [lastPaid, setLastPaid] = useState([]);

  useEffect(() => {
    if (!network || !account) return;
    let reading = false;
    let stopped = false;
    async function watch() {
      if (reading) return;
      reading = true;
      try {
        const before = await listCharges(db, account, network);
        await readHistory(db, network, account);
        const turned = newlyPaid(before, await listCharges(db, account, network));
        if (!stopped && turned.length > 0) {
          setLastPaid(turned);
          show(paidNotice(turned));
        }
      } catch {
        // The next reading tries again.
      } finally {
        reading = false;
      }
    }
    const timer = setInterval(watch, watchMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [db, network, account, show]);

  return lastPaid;
}

// One notice for everything a reading found paid: two notices of the same kind would stack, and
// the one below would expire unseen. The order id is what the payee's list of charges shows.
function paidNotice(turned) {
  const valueWei = turned.reduce((sum, charge) => sum + charge.valueWei, 0n);
  const one = turned.length === 1;
  return {
    id: 'paid',
    kind: 'success',
    tab: 'receive',
    title: one ? 'Charge paid' : `${turned.length} charges paid`,
    body: one
      ? `${formatEth(valueWei)} ETH · order ${shortAddress(turned[0].orderId)}`
      : `${formatEth(valueWei)} ETH in all`,
    expiresAfter: 6000,
  };
}
