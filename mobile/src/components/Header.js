// The header at the top of the tabs: the mark and the name on the left, and on the right what
// the tab puts there, which on the pay, receive and bridge tabs is the account in use.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { shortAddress } from '../theme/format';
import { HistoryProgress } from '../history/historyReading';
import { NoticeBar } from './Notice';
import { NulliusMark } from './NulliusMark';
import { colors, fonts, radius } from '../theme/theme';

/// The mark at 26 with the thicker stroke the boards use at that size, then the name; below
/// them, the line of the history reading while it runs, and the band with the notice that
/// matters most on this tab.
export function Header({ children }) {
  return (
    <>
      <View style={styles.header}>
        <View style={styles.brand}>
          <NulliusMark size={26} strokeWidth={4} />
          <Text style={styles.name}>nullius</Text>
        </View>
        {children}
      </View>
      <HistoryProgress />
      <NoticeBar />
    </>
  );
}

/// The account in use, and the way to the accounts tab, where it is changed. With no account
/// stored, `account` is undefined and the chip leads there to add one.
export function AccountChip({ account, onPress }) {
  return (
    <Pressable
      style={styles.chip}
      onPress={onPress}
      accessibilityLabel={account ? `Account ${account.label}, change account` : 'Add account'}
    >
      {account ? (
        <>
          <View style={styles.dot} />
          <Text style={styles.chipLabel}>{account.label}</Text>
          <Text style={styles.chipAddress}>{shortAddress(account.address)}</Text>
        </>
      ) : (
        <Text style={styles.chipLabel}>Add account</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // -0.03em of 18.
  name: {
    color: colors.text,
    fontFamily: fonts.ui,
    fontSize: 18,
    fontWeight: '500',
    letterSpacing: -0.54,
  },
  chip: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: radius.chip,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 7, height: 7, borderRadius: radius.chip, backgroundColor: colors.accent },
  chipLabel: { color: colors.text, fontFamily: fonts.ui, fontSize: 13, fontWeight: '500' },
  chipAddress: { color: colors.text2, fontFamily: fonts.mono, fontSize: 12 },
});
