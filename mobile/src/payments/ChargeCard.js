// The charge the pay tab is about to pay, as the card of `Pagar.dc.html` draws it: the amount,
// then one line per field, each with a check when something on the phone confirmed it.

import { StyleSheet, Text, View } from 'react-native';
import { formatEth, shortAddress } from '../theme/format';
import { Icon } from '../components/Icon';
import { colors, fonts, radius, space } from '../theme/theme';

const CHECK = 'M5 12.5l4.5 4.5L19 7';

/**
 * `verified` is true when the four values are what `decodeCharge` read from a pasted charge,
 * which checked the chain, the contract and the order id. A typed charge says nothing about its
 * network, so its chain and contract go unchecked; its order id was checked against payee,
 * amount and salt before `TypeChargeScreen` let it through, so the order id is checked either way.
 */
export function ChargeCard({ network, payee, valueWei, orderId, verified }) {
  if (!orderId) {
    return (
      <View style={styles.card}>
        <Text style={styles.empty}>Scan, paste or type a charge to pay.</Text>
      </View>
    );
  }

  const rows = [
    { name: 'Payee', value: shortAddress(payee), checked: false },
    {
      name: 'Network',
      value: network ? `${network.chain.name} · ${network.chain.id}` : '—',
      checked: verified,
    },
    {
      name: 'Contract',
      value: network ? `Payments ${shortAddress(network.paymentsAddress)}` : '—',
      checked: verified,
    },
    { name: 'Order id', value: shortAddress(orderId), checked: true },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.titleRow}>
          {verified && <Icon d={CHECK} color={colors.accent} size={18} strokeWidth={2} />}
          <Text style={styles.title}>{verified ? 'Charge verified' : 'Charge typed'}</Text>
        </View>
      </View>

      <View style={styles.amountRow}>
        {/* Every decimal is kept, so a tiny amount is long: it shrinks to fit beside "ETH"
            instead of wrapping and pushing the unit out of the card. */}
        <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
          {formatEth(BigInt(valueWei))}
        </Text>
        <Text style={styles.unit}>ETH</Text>
      </View>

      <View>
        {rows.map(({ name, value, checked }) => (
          <View key={name} style={styles.row}>
            <Text style={styles.rowName}>{name}</Text>
            <View style={styles.rowValue}>
              <Text style={styles.mono}>{value}</Text>
              {checked && <Icon d={CHECK} color={colors.accent} size={14} strokeWidth={2.25} />}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.gap,
    gap: 14,
    padding: space.cardPad,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  empty: { color: colors.text2, fontFamily: fonts.ui, fontSize: 14 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: colors.text, fontFamily: fonts.ui, fontSize: 14, fontWeight: '500' },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  // -0.03em of 34.
  amount: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 34,
    fontWeight: '500',
    letterSpacing: -1.02,
    flexShrink: 1,
  },
  unit: { color: colors.text2, fontFamily: fonts.ui, fontSize: 15 },
  row: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  rowName: { color: colors.text2, fontFamily: fonts.ui, fontSize: 13 },
  rowValue: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  mono: { color: colors.text, fontFamily: fonts.mono, fontSize: 12.5 },
});
