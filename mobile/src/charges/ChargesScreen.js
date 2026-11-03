// Every charge of the chosen account on the network in use, as `Recebidos.dc.html` draws them
// under the name "Charges": what was received and what is still to receive,
// filtered by whether they were paid, grouped by the day they were made.

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatEth, formatTime } from '../theme/format';
import { BackHeader, DayList, Filters, ScreenTitle } from '../components/ListScreen';
import { StatusChip } from '../components/StatusChip';
import { colors, fonts, radius, space } from '../theme/theme';
import { Page } from '../components/ui';

/// The chip of a charge: paid once a `Payment` log carried its order id, pending until then.
export function chargeChip(paid) {
  return paid ? { state: 'confirmed', label: 'Paid' } : { state: 'pending', label: 'Pending' };
}

// The filters of the board and whether each keeps paid charges; "Todas" keeps both.
const filters = [
  { label: 'All', paid: null },
  { label: 'Paid', paid: true },
  { label: 'Pending', paid: false },
];

/// Opened from "Ver todas" on the receive tab, with the same `charges` the tab keeps, so a charge
/// paid while it is open says so here too. `onOpen` hands a charge back to the tab's card.
export function ChargesScreen({ account, network, charges, onBack, onOpen }) {
  // The label of the chosen filter, as in the list of every payment.
  const [chosen, setChosen] = useState(filters[0].label);
  const filter = filters.find((each) => each.label === chosen);
  const shown =
    filter.paid === null
      ? charges
      : charges.filter((charge) => (charge.paidHash !== null) === filter.paid);
  // The two cards count every charge, whatever the filter.
  // The card counts every pending charge, whatever the filter.
  const pending = charges.filter((charge) => charge.paidHash === null);

  return (
    <Page
      header={
        <BackHeader
          label="Receive"
          aside={`${account.label} · ${network.chain.name}`}
          onBack={onBack}
        />
      }
    >
      <ScreenTitle title="Charges" />
      <ToReceive pending={pending} />
      <Filters filters={filters} chosen={chosen} onChoose={setChosen} />
      <DayList
        items={shown}
        at={(charge) => charge.createdAt}
        row={(charge) => <Row key={charge.orderId} charge={charge} onOpen={onOpen} />}
        empty="No charges in this filter."
      />
    </Page>
  );
}

/// What the pending charges add up to, in the warning color, and how many they are. The board's
/// card of what was received beside it is left out.
function ToReceive({ pending }) {
  const wei = pending.reduce((sum, charge) => sum + charge.valueWei, 0n);
  const words = pending.length === 1 ? 'pending charge' : 'pending charges';
  return (
    <View style={styles.card}>
      <Text style={styles.cardName}>To receive</Text>
      <Text style={styles.cardAmount} numberOfLines={1} adjustsFontSizeToFit>
        {formatEth(wei)} ETH
      </Text>
      <Text style={styles.cardCount}>
        {pending.length} {words}
      </Text>
    </View>
  );
}

/// When it was made; the day is the group's, and where it stands is the chip's.
/// A pending amount is dimmed: it was not received yet.
function Row({ charge, onOpen }) {
  const paid = charge.paidHash !== null;
  return (
    <Pressable style={styles.row} onPress={() => onOpen(charge)}>
      <View style={styles.middle}>
        <Text
          style={[styles.amount, !paid && styles.amountPending]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          +{formatEth(charge.valueWei)} ETH
        </Text>
        <Text style={styles.meta}>created at {formatTime(charge.createdAt)}</Text>
      </View>
      <StatusChip {...chargeChip(paid)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.gap,
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardName: { color: colors.text2, fontFamily: fonts.ui, fontSize: 12 },
  cardAmount: { color: colors.warn, fontFamily: fonts.mono, fontSize: 17 },
  cardCount: { color: colors.text3, fontFamily: fonts.ui, fontSize: 11.5 },
  // As the list of every payment: 54 tall, the divider in `surface`.
  row: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  middle: { flex: 1, minWidth: 0, gap: 3 },
  amount: { color: colors.text, fontFamily: fonts.mono, fontSize: 13 },
  amountPending: { color: colors.text2 },
  meta: { color: colors.text3, fontFamily: fonts.ui, fontSize: 12 },
});
