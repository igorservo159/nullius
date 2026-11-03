// One payment of the chosen account, as `Pagamento.dc.html` draws it: where it stands, how far it
// went through the four steps of a payment, and what its transaction says.

import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { formatEth, formatWhen, groupDigits, shortAddress } from '../theme/format';
import { Icon } from '../components/Icon';
import { BackHeader } from '../components/ListScreen';
import { revertWords } from './refusals';
import { chipOf } from './SentPaymentList';
import { colors, fonts, radius, space, stateColors } from '../theme/theme';
import { Page } from '../components/ui';

const CHECK = 'M5 12.5l4.5 4.5L19 7';
const CLOCK = 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0';
const CROSS = 'M6 6l12 12M18 6L6 18';
const OUT = 'M7 17L17 7M9 7h8v8';

// The summary's title and icon for each chip state: a check once executed, a cross when the value
// will not move, a clock while it may still.
const summaries = {
  signed: { title: 'Payment signed', d: CLOCK },
  rejected: { title: 'Payment rejected', d: CROSS },
  pending: { title: 'Payment pending', d: CLOCK },
  lost: { title: 'Payment lost', d: CROSS },
  queued: { title: 'Payment queued', d: CLOCK },
  replaced: { title: 'Payment replaced', d: CROSS },
  confirmed: { title: 'Payment confirmed', d: CHECK },
  finalized: { title: 'Payment finalized', d: CHECK },
  reverted: { title: 'Payment reverted', d: CROSS },
};

/**
 * The four steps of a payment as `sent` went through them: each `done`,
 * `waiting`, `failed`, or `ahead` when an earlier one is still waiting. A failed step is the
 * last: the ones after it are not listed.
 */
function stepsOf(sent) {
  const nonce = `nonce ${sent.nonce}`;
  const block = sent.blockNumber === null ? '' : `block ${groupDigits(sent.blockNumber)}`;
  const signed = { title: 'Signed', mark: 'done', meta: nonce };
  const accepted = {
    title: 'Accepted by the node',
    mark: 'done',
    meta: 'the transaction reached the network',
  };
  const included = { title: 'Included in a block', mark: 'ahead', meta: '' };
  const finalized = { title: 'Finalized on Ethereum', mark: 'ahead', meta: '' };

  switch (sent.status) {
    case 'signed':
      return [
        signed,
        { ...accepted, mark: 'waiting', meta: 'waiting for the node to answer' },
        included,
        finalized,
      ];
    case 'rejected':
      return [signed, { ...accepted, mark: 'failed', meta: 'the node refused, nothing was sent' }];
    case 'pending': {
      const meta = 'waiting for the block';
      return [signed, accepted, { ...included, mark: 'waiting', meta }, finalized];
    }
    case 'queued': {
      const meta = 'waiting: an earlier nonce is not in';
      return [signed, accepted, { ...included, mark: 'waiting', meta }, finalized];
    }
    case 'lost': {
      const meta = 'gone from the node, sign again';
      return [signed, accepted, { ...included, mark: 'failed', meta }];
    }
    case 'replaced': {
      const meta = `another transaction used ${nonce}`;
      return [signed, accepted, { ...included, mark: 'failed', meta }];
    }
    case 'reverted': {
      const meta = `${block} · ${revertWords[sent.revertReason]}`;
      return [signed, accepted, { ...included, mark: 'failed', meta }];
    }
    default:
      return [
        signed,
        accepted,
        { ...included, mark: 'done', meta: `${block} · confirmed on L2` },
        sent.finalized
          ? { ...finalized, mark: 'done', meta: 'the block\'s proof reached L1' }
          : { ...finalized, mark: 'waiting', meta: 'waiting for the block\'s proof on L1' },
      ];
  }
}

// The dot of each mark, and the color of its title.
const marks = {
  done: { bg: colors.accent, border: colors.accent, title: colors.text },
  waiting: { bg: 'transparent', border: colors.warn, title: colors.warn },
  failed: { bg: colors.danger, border: colors.danger, title: colors.danger },
  ahead: { bg: 'transparent', border: colors.inputBorder, title: colors.text3 },
};

/// `backLabel` names the screen `onBack` returns to: the pay tab, or the list of every payment.
export function PaymentScreen({ sent, explorer, backLabel, onBack }) {
  const chip = chipOf(sent);
  const summary = summaries[chip.state];
  const tone = stateColors[chip.state];
  const steps = stepsOf(sent);
  // Gas and price come with the receipt: before it there is no fee to show.
  const details = [
    { key: 'Hash', value: shortAddress(sent.hash) },
    { key: 'Order id', value: shortAddress(sent.orderId) },
    sent.gasUsed !== null && { key: 'Gas used', value: groupDigits(sent.gasUsed) },
    sent.gasUsed !== null && {
      key: 'Fee',
      value: `${formatEth(sent.gasUsed * sent.effectiveGasPrice)} ETH`,
    },
  ].filter(Boolean);

  return (
    <Page header={<BackHeader label={backLabel} aside={formatWhen(sent.sentAt)} onBack={onBack} />}>

      <View style={styles.summary}>
        <View style={styles.titleRow}>
          <View
            style={[
              styles.badge,
              { backgroundColor: tone.bg },
              tone.border && {
                borderWidth: 1,
                borderColor: tone.border,
                borderStyle: tone.dashed ? 'dashed' : 'solid',
              },
            ]}
          >
            <Icon d={summary.d} color={tone.fg} size={18} strokeWidth={2.5} />
          </View>
          <Text style={styles.title}>{summary.title}</Text>
        </View>
        <View style={styles.amountRow}>
          <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
            {formatEth(sent.valueWei)}
          </Text>
          <Text style={styles.unit}>ETH</Text>
        </View>
        <Text style={styles.to}>
          to <Text style={styles.payee}>{shortAddress(sent.payee)}</Text>
        </Text>
      </View>

      <View style={[styles.card, styles.steps]}>
        {steps.map((step, index) => {
          const mark = marks[step.mark];
          const last = index === steps.length - 1;
          return (
            <View key={step.title} style={styles.step}>
              <View style={styles.rail}>
                <View
                  style={[styles.dot, { backgroundColor: mark.bg, borderColor: mark.border }]}
                />
                {/* The line down to the next step: green once this one is done. */}
                {!last && (
                  <View
                    style={[
                      styles.line,
                      step.mark === 'done' && { backgroundColor: stateColors.confirmed.bg },
                    ]}
                  />
                )}
              </View>
              <View style={styles.stepText}>
                <Text style={[styles.stepTitle, { color: mark.title }]}>{step.title}</Text>
                {step.meta !== '' && <Text style={styles.stepMeta}>{step.meta}</Text>}
              </View>
            </View>
          );
        })}
      </View>

      <View style={[styles.card, styles.details]}>
        {details.map((detail, index) => (
          <View
            key={detail.key}
            style={[styles.detail, index === details.length - 1 && styles.detailLast]}
          >
            <Text style={styles.detailKey}>{detail.key}</Text>
            <Text style={styles.detailValue}>{detail.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={() => Clipboard.setStringAsync(sent.hash)}>
          <Text style={styles.actionText}>Copy hash</Text>
        </Pressable>
        <Pressable
          style={styles.action}
          onPress={() => Linking.openURL(`${explorer}/tx/${sent.hash}`)}
          disabled={!explorer}
        >
          <Text style={styles.actionText}>View on explorer</Text>
          <Icon d={OUT} color={colors.text} size={16} />
        </Pressable>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  summary: { marginTop: space.gap, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: {
    width: 32,
    height: 32,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // -0.02em of 22.
  title: {
    color: colors.text,
    fontFamily: fonts.ui,
    fontSize: 22,
    fontWeight: '500',
    letterSpacing: -0.44,
  },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingTop: 6 },
  // -0.03em of 34.
  amount: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 34,
    fontWeight: '500',
    letterSpacing: -1.02,
  },
  unit: { color: colors.text2, fontFamily: fonts.ui, fontSize: 15 },
  to: { color: colors.text2, fontFamily: fonts.ui, fontSize: 13 },
  payee: { color: colors.text, fontFamily: fonts.mono },
  card: {
    marginTop: space.gap,
    paddingHorizontal: space.cardPad,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  steps: { paddingVertical: 14 },
  step: { flexDirection: 'row', gap: 12, minHeight: 48 },
  rail: { width: 18, alignItems: 'center' },
  dot: { width: 12, height: 12, marginTop: 3, borderRadius: radius.chip, borderWidth: 2 },
  // The boards draw a done step's line in #2E3A1C, which no token names; the confirmed chip's
  // background is the nearest.
  line: { flex: 1, width: 2, marginVertical: 4, backgroundColor: colors.line },
  stepText: { flex: 1, gap: 2, paddingBottom: 10 },
  stepTitle: { fontFamily: fonts.ui, fontSize: 14, fontWeight: '500' },
  stepMeta: { color: colors.text2, fontFamily: fonts.ui, fontSize: 12 },
  details: { paddingVertical: 4 },
  detail: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  detailLast: { borderBottomWidth: 0 },
  detailKey: { color: colors.text2, fontFamily: fonts.ui, fontSize: 13 },
  detailValue: { color: colors.text, fontFamily: fonts.mono, fontSize: 12.5 },
  actions: { marginTop: space.gap, flexDirection: 'row', gap: 10 },
  action: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: { color: colors.text, fontFamily: fonts.ui, fontSize: 14, fontWeight: '500' },
});
