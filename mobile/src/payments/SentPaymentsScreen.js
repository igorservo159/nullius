// Every payment of the chosen account on the network in use, as `Enviados.dc.html` draws them
// under the name "Payments": filtered by where they stand, grouped by day.

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatEth, formatTime, shortAddress } from '../theme/format';
import { BackHeader, DayList, Filters, ScreenTitle } from '../components/ListScreen';
import { revertWords } from './refusals';
import { chipOf } from './SentPaymentList';
import { StatusChip } from '../components/StatusChip';
import { colors, fonts } from '../theme/theme';
import { Page } from '../components/ui';

// The filters of the board and the statuses of `sent_payments` each keeps; "Todos" keeps them all.
const filters = [
  { label: 'All', statuses: null },
  { label: 'In progress', statuses: ['signed', 'pending', 'queued'] },
  { label: 'Done', statuses: ['success'] },
  { label: 'Problems', statuses: ['rejected', 'reverted', 'lost', 'replaced'] },
];

// The statuses whose value never reached the payee; their amount is dimmed.
const unmoved = filters[3].statuses;

/// Opened from "Ver todos" on the pay tab, with the same `sentPayments` the tab keeps, so a row
/// that changes while it is open changes here too. `onOpen` opens the detail of
/// the payment whose hash it is handed.
export function SentPaymentsScreen({ account, network, sentPayments, onBack, onOpen }) {
  // The label of the chosen filter, not the filter itself: a label stays equal across reloads.
  const [chosen, setChosen] = useState(filters[0].label);
  const filter = filters.find((each) => each.label === chosen);
  const shown = filter.statuses
    ? sentPayments.filter((sent) => filter.statuses.includes(sent.status))
    : sentPayments;

  return (
    <Page
      header={
        <BackHeader
          label="Pay"
          aside={`${account.label} · ${network.chain.name}`}
          onBack={onBack}
        />
      }
    >
      <ScreenTitle
        title="Payments"
        count={`${shown.length} ${shown.length === 1 ? 'payment' : 'payments'}`}
      />
      <Filters filters={filters} chosen={chosen} onChoose={setChosen} />
      <DayList
        items={shown}
        at={(sent) => sent.sentAt}
        row={(sent) => <Row key={sent.hash} sent={sent} onOpen={onOpen} />}
        empty="No payments in this filter."
      />
    </Page>
  );
}

/// The second line is the time and the order id, without its name, or the time and why the
/// contract reverted it.
function Row({ sent, onOpen }) {
  const about = sent.revertReason ? revertWords[sent.revertReason] : shortAddress(sent.orderId);
  return (
    <Pressable style={styles.row} onPress={() => onOpen(sent.hash)}>
      <View style={styles.middle}>
        <Text style={styles.payee}>{shortAddress(sent.payee)}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatTime(sent.sentAt)} · {about}
        </Text>
      </View>
      <View style={styles.right}>
        {/* As in the pay tab's list: U+2212, and a long amount shrinks instead of pushing. */}
        <Text
          style={[styles.amount, unmoved.includes(sent.status) && styles.amountUnmoved]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          −{formatEth(sent.valueWei)}
        </Text>
        <StatusChip {...chipOf(sent)} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The divider is #16181C on the board, which no token names; `surface` is the nearest.
  row: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  middle: { flexShrink: 0, gap: 3 },
  payee: { color: colors.text, fontFamily: fonts.mono, fontSize: 13 },
  meta: { color: colors.text3, fontFamily: fonts.ui, fontSize: 12 },
  right: { flex: 1, minWidth: 0, alignItems: 'flex-end', gap: 4 },
  amount: { color: colors.text, fontFamily: fonts.mono, fontSize: 13 },
  amountUnmoved: { color: colors.text3 },
});
