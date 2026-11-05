// The reading of the chosen account's `Payment` logs, owned here above the tabs so that two
// readings of one account never run at once: a round when the app opens, when the account or the
// network changes and when the older history is asked for, then a round every few seconds. Each
// round marks finalized the paid charges and the mined payments the finalized block passed, and
// puts up one notice for the charges that turned paid or finalized. How many blocks are left is
// shown under the header of every tab.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { listCharges, markChargesFinalized, newlyPaid } from '@nullius/core/charges';
import { readHistory } from '@nullius/core/history';
import { markFinalized } from '@nullius/core/payments';
import { useAdapters } from '../adapters';
import { styles as ui } from '../components/ui';
import { formatEth, shortAddress } from '../theme/format';

// How often a round runs while the app is open. Each round after the first is usually one
// slice: the block number and two log searches.
const watchMs = 10_000;

// Thrown from `onSlice` to stop a round whose account or network is no longer the one in use:
// `readHistory` saves the cursor before calling `onSlice`, so the slice read is kept.
class RoundStopped extends Error {}

/**
 * Runs the rounds for `account` on `network`. `askedFrom` changes when the older history is asked
 * for, and a round starts at once. Returns `rounds`, a count that grows after every slice and
 * every round, for the tabs to read their lists again, and `blocksLeft`, how many blocks the
 * running round still has to read, null when none runs.
 *
 * A round never starts while another runs, whichever account it reads: the next is skipped. A
 * round whose account or network stops being the one in use stops after its current slice. A
 * round that fails puts up a notice that stays until a round works.
 */
export function useHistoryReading(network, account, askedFrom, show, dismiss) {
  const { db } = useAdapters();
  const [rounds, setRounds] = useState(0);
  const [blocksLeft, setBlocksLeft] = useState(null);
  // Shared by every run of the effect below, so a round of the previous account blocks one of
  // the next until it stops.
  const reading = useRef(false);

  useEffect(() => {
    if (!network || !account) return;
    let stopped = false;
    async function round() {
      if (reading.current) return;
      reading.current = true;
      try {
        const before = await listCharges(db, account, network);
        await readHistory(db, network, account, (nextBlock, lastBlock) => {
          if (stopped) throw new RoundStopped();
          setBlocksLeft(lastBlock - nextBlock + 1n);
          setRounds((count) => count + 1);
        });
        const finalizedIds = await markChargesFinalized(db, network, account);
        await markFinalized(db, network, account);
        const after = await listCharges(db, account, network);
        if (stopped) return;
        dismiss('history-failure');
        setRounds((count) => count + 1);
        const paid = newlyPaid(before, after);
        const finalized = after.filter((charge) => finalizedIds.includes(charge.orderId));
        if (paid.length > 0 || finalized.length > 0) show(chargesNotice(paid, finalized));
      } catch (error) {
        if (!stopped) show(failureNotice(error));
      } finally {
        reading.current = false;
        if (!stopped) setBlocksLeft(null);
      }
    }
    round();
    const timer = setInterval(round, watchMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [db, network, account, askedFrom, show, dismiss]);

  return { rounds, blocksLeft };
}

/** What `App.js` provides: the `blocksLeft` of `useHistoryReading`. */
export const HistoryProgressContext = createContext(null);

/// The line under every tab's header while a round reads the history; nothing otherwise.
export function HistoryProgress() {
  const blocksLeft = useContext(HistoryProgressContext);
  if (blocksLeft === null || blocksLeft <= 0n) return null;
  return <Text style={ui.hint}>Reading the history: {String(blocksLeft)} blocks left.</Text>;
}

// A failed round, on every tab: the history is behind until a round works.
function failureNotice(error) {
  return {
    id: 'history-failure',
    kind: 'attention',
    tab: 'receive',
    title: 'History not read',
    body: error.shortMessage ?? error.message,
    detail: error.shortMessage ?? error.message,
  };
}

// One notice for everything a round found paid or finalized: two notices of the same kind would
// stack, and the one below would expire unseen. A charge paid and finalized in the same round
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
