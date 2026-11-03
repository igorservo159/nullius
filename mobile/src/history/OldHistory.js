// From which block the chosen account's history is read on the network in use. An account seen
// for the first time on a network is read from the current block on, with nothing asked; reading
// its older payments and charges, from the block that published Payments, is a small link on the
// accounts tab for whoever needs them.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { readCursor, startCursor } from '@nullius/core/history';
import { useAdapters } from '../adapters';
import { colors, fonts, space } from '../theme/theme';

/**
 * Starts the cursor of `account` on `network` at the current block when it has none, and gives
 * `readFromDeploy`, which moves it back to the block that published Payments. The readings the
 * tabs already make, every time they open and every few seconds on the receive side, then go
 * through the older blocks. `failure` says why starting or moving the cursor failed; null while
 * nothing failed. `moved` is true once the cursor was moved back, until the account or network
 * changes.
 */
export function useOldHistory(network, account) {
  const { db } = useAdapters();
  const [busy, setBusy] = useState(false);
  const [moved, setMoved] = useState(false);
  const [failure, setFailure] = useState(null);

  // Each account has its own cursor on each network. Starting it asks the node for its current
  // block, which can fail; the next opening, or the next change of account, tries again.
  useEffect(() => {
    setMoved(false);
    setFailure(null);
    if (!network || !account) return;
    readCursor(db, account, network)
      .then((cursor) => (cursor === null ? startCursor(db, account, network, false) : undefined))
      .catch((error) => setFailure(error.shortMessage ?? error.message));
  }, [db, network, account]);

  const readFromDeploy = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      await startCursor(db, account, network, true);
      setMoved(true);
    } catch (error) {
      setFailure(error.shortMessage ?? error.message);
    } finally {
      setBusy(false);
    }
  }, [db, network, account]);

  return { busy, moved, failure, readFromDeploy };
}

/// The link under the accounts, in the small print's color: it reads the chosen account's older
/// payments and charges. Once tapped it says the reading is on its way instead.
export function OldHistoryLink({ label, history }) {
  const { busy, moved, failure, readFromDeploy } = history;
  return (
    <View style={styles.box}>
      {moved ? (
        <Text style={styles.note}>
          Reading {label}'s history since the contract was deployed: Pay and Receive show how far
          it got.
        </Text>
      ) : (
        <Pressable onPress={readFromDeploy} disabled={busy}>
          <Text style={styles.link}>Find {label}'s older payments and charges</Text>
        </Pressable>
      )}
      {failure && <Text style={styles.failure}>{failure}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: space.gap, gap: 6 },
  link: {
    color: colors.text3,
    fontFamily: fonts.ui,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  note: { color: colors.text3, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 },
  failure: { color: colors.danger, fontFamily: fonts.ui, fontSize: 12 },
});
