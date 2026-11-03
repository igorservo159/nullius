// The last payments of the chosen account, as `Pagar.dc.html`'s "Enviados recentemente" draws
// them, under the name "Recent payments": one 52-tall row each, with the
// payee, when, the amount and the chip of its status.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatEth, formatWhen, shortAddress } from '../theme/format';
import { Icon } from '../components/Icon';
import { revertWords } from './refusals';
import { StatusChip } from '../components/StatusChip';
import { colors, fonts, radius, space } from '../theme/theme';

const SENT_ICON = 'M7 17L17 7M9 7h8v8';

// How many payments the pay tab shows; the rest are a tap on "Ver todos" away.
const RECENT = 5;

// The chip of each status of `sent_payments`: its `stateColors` entry, and the word.
const chips = {
  signed: { state: 'signed', label: 'Signed' },
  rejected: { state: 'rejected', label: 'Rejected' },
  pending: { state: 'pending', label: 'Pending' },
  lost: { state: 'lost', label: 'Lost' },
  queued: { state: 'queued', label: 'Queued' },
  replaced: { state: 'replaced', label: 'Replaced' },
  success: { state: 'confirmed', label: 'Confirmed' },
  reverted: { state: 'reverted', label: 'Reverted' },
};

// An executed payment whose block's proof reached Ethereum is past confirmed: finalized.
export function chipOf(sent) {
  if (sent.status === 'success' && sent.finalized) {
    return { state: 'finalized', label: 'Finalized' };
  }
  return chips[sent.status];
}

/// The first `RECENT` of `sentPayments`, which come newest first; `onSeeAll` opens them all, and
/// `onOpen` the detail of the payment whose hash it is handed.
export function SentPaymentList({ sentPayments, onSeeAll, onOpen }) {
  if (sentPayments.length === 0) return null;
  return (
    <View style={styles.list}>
      <View style={styles.top}>
        <Text style={styles.heading}>Recent payments</Text>
        <Pressable style={styles.seeAll} onPress={onSeeAll} hitSlop={6}>
          <Text style={styles.seeAllText}>See all</Text>
        </Pressable>
      </View>
      {sentPayments.slice(0, RECENT).map((sent) => (
        <Pressable
          key={sent.hash}
          style={styles.row}
          onPress={() => onOpen(sent.hash)}
        >
          <View style={styles.tile}>
            <Icon d={SENT_ICON} color={colors.text2} size={16} />
          </View>
          <View style={styles.middle}>
            <Text style={styles.payee}>{shortAddress(sent.payee)}</Text>
            <Text style={styles.when} numberOfLines={1}>
              {formatWhen(sent.sentAt)}
              {sent.revertReason && ` · ${revertWords[sent.revertReason]}`}
            </Text>
          </View>
          <View style={styles.right}>
            {/* U+2212, the minus sign: the hyphen is shorter and sits lower. */}
            {/* Every decimal is kept, so a tiny amount is long: it shrinks to fit instead of
                pushing the date out of its row. */}
            <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
              −{formatEth(sent.valueWei)}
            </Text>
            <StatusChip {...chipOf(sent)} />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: space.gap, gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { color: colors.text2, fontFamily: fonts.ui, fontSize: 13, fontWeight: '500' },
  // 32 tall as the board draws it, with the width of its word and a slop that takes it to 44.
  seeAll: { minHeight: 32, justifyContent: 'center' },
  seeAllText: { color: colors.accent, fontFamily: fonts.ui, fontSize: 13 },
  // The boards draw the divider in #16181C, which no token names; `surface` is the nearest.
  row: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  tile: {
    width: 34,
    height: 34,
    borderRadius: radius.iconTile,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flexShrink: 0, gap: 2 },
  payee: { color: colors.text, fontFamily: fonts.mono, fontSize: 13 },
  when: { color: colors.text3, fontFamily: fonts.ui, fontSize: 12 },
  right: { flex: 1, minWidth: 0, alignItems: 'flex-end', gap: 4 },
  amount: { color: colors.text, fontFamily: fonts.mono, fontSize: 13 },
});
