// The charges paid or finalized while the app is open: a reading of the chosen account's logs
// every few seconds, the paid ones the finalized block passed marked finalized, and a notice for
// the charges that turned paid or finalized.

import { useEffect, useState } from 'react';
import { listCharges, markChargesFinalized, newlyPaid } from '@nullius/core/charges';
import { readHistory } from '@nullius/core/history';
import { useAdapters } from '../adapters';
import { formatEth, shortAddress } from '../theme/format';

// How often the logs are read while the app is open. Each reading after the first is usually one
// slice: the block number and two log searches.
const watchMs = 10_000;

/**
 * Watches `account` on `network` and puts up a notice through `show` when charges get paid or
 * finalized. Returns the charges the last such reading changed, so the receive tab can read its
 * list again. Only the chosen account is watched.
 *
 * A reading that has not finished when the next one is due is not doubled: the next one is
 * skipped. A reading that fails is dropped without a word; the tabs report their own readings,
 * and the next one here tries again.
 */
export function usePaidCharges(network, account, show) {
  const { db } = useAdapters();
  const [lastChanged, setLastChanged] = useState([]);

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
        const finalizedIds = await markChargesFinalized(db, network, account);
        const after = await listCharges(db, account, network);
        const paid = newlyPaid(before, after);
        const finalized = after.filter((charge) => finalizedIds.includes(charge.orderId));
        if (!stopped && (paid.length > 0 || finalized.length > 0)) {
          setLastChanged([...paid, ...finalized]);
          show(chargesNotice(paid, finalized));
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

  return lastChanged;
}

// One notice for everything a reading found paid or finalized: two notices of the same kind would
// stack, and the one below would expire unseen. A charge paid and finalized in the same reading
// counts in both groups.
function chargesNotice(paid, finalized) {
  return {
    id: 'charges',
    kind: 'success',
    tab: 'receive',
    ...noticeWords(paid, finalized),
    expiresAfter: 6000,
  };
}

// The title and body: one group alone as `groupWords` puts it, both groups counted in the title.
function noticeWords(paid, finalized) {
  if (finalized.length === 0) return groupWords(paid, 'paid');
  if (paid.length === 0) return groupWords(finalized, 'finalized');
  const charges = paid.length === 1 ? 'charge' : 'charges';
  return {
    title: `${paid.length} ${charges} paid, ${finalized.length} finalized`,
    body: `${formatEth(sumOf(paid))} ETH paid · ${formatEth(sumOf(finalized))} ETH finalized`,
  };
}

// One charge by its amount and order id, the id the payee's list of charges shows; several by
// their total.
function groupWords(charges, word) {
  if (charges.length === 1) {
    return {
      title: `Charge ${word}`,
      body: `${formatEth(charges[0].valueWei)} ETH · order ${shortAddress(charges[0].orderId)}`,
    };
  }
  return {
    title: `${charges.length} charges ${word}`,
    body: `${formatEth(sumOf(charges))} ETH in all`,
  };
}

function sumOf(charges) {
  return charges.reduce((sum, charge) => sum + charge.valueWei, 0n);
}
