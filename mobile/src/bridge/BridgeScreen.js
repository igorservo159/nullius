// The bridge tab, as `Ponte.dc.html` draws it: moves ETH of the chosen account between the L1 and
// Linea, through Linea's canonical message service, and lists the transfers it made.

import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AccountWithoutKey, BiometricRefused } from '@nullius/core/accounts';
import { balancesOf } from '@nullius/core/balances';
import {
  claimWithdrawal,
  listTransfers,
  maximumTransfer,
  ProofNotReady,
  resolveTransfers,
  transfer,
  transferFee,
} from '@nullius/core/bridge';
import {
  NodeRejected,
  SendUnanswered,
  TransactionInFlight,
  TransactionNotKept,
} from '@nullius/core/transactions';
import { useAdapters } from '../adapters';
import { formatAgo, formatEth, formatWhen, weiOf } from '../theme/format';
import { AccountChip, Header } from '../components/Header';
import { FINGERPRINT_ICON, Icon } from '../components/Icon';
import { useNotices } from '../components/notices';
import { StatusChip } from '../components/StatusChip';
import { colors, fonts, radius, space } from '../theme/theme';
import { Page, PrimaryButton, styles as ui } from '../components/ui';

const ARROW = 'M5 12h14M13 6l6 6-6 6';

// The two layers as the cards name them.
const L1 = 'Ethereum · L1';
const L2 = 'Linea · L2';

const directionWords = { deposit: 'Deposit', withdrawal: 'Withdrawal' };

// The chip of each status that ends a transfer before the other side, or that waits on the
// origin layer; the others say where they stand in words, in `aboutOf`.
const chips = {
  signed: { state: 'signed', label: 'Signed' },
  rejected: { state: 'rejected', label: 'Rejected' },
  pending: { state: 'pending', label: 'Pending' },
  lost: { state: 'lost', label: 'Lost' },
  queued: { state: 'queued', label: 'Queued' },
  replaced: { state: 'replaced', label: 'Replaced' },
  reverted: { state: 'reverted', label: 'Reverted' },
  claimable: { state: 'claimable', label: 'Claimable' },
};

/**
 * The second line of a transfer and its color. On its way to the other side, how long it has
 * been travelling, since the app cannot know when the L1 gets a withdrawal's proof; once there,
 * who claimed it; otherwise when it was signed, beside its chip.
 */
function aboutOf(transfer) {
  const ago = formatAgo(transfer.sentAt);
  if (transfer.status === 'sent') {
    const where =
      transfer.direction === 'deposit' ? 'arriving on Linea' : 'waiting for the proof on L1';
    return { text: `${where} · sent ${ago}`, color: colors.warn };
  }
  if (transfer.status === 'claimed') {
    const who =
      transfer.direction === 'deposit' ? 'claimed automatically' : 'claimed on L1';
    return { text: who, color: colors.text2 };
  }
  return { text: formatWhen(transfer.sentAt), color: colors.text3 };
}

/**
 * A failure of the bridge tab as a notice, shown on this tab only: an error that goes away after
 * 6 s unless `fields` says otherwise, with `sentence` and the technical words behind a tap.
 */
function failureNotice(id, fields, error, sentence) {
  const technical = error.shortMessage ?? error.message;
  return {
    id,
    kind: 'error',
    tab: 'bridge',
    where: ['bridge'],
    expiresAfter: 6000,
    detail: sentence ? `${sentence}\n\n${technical}` : technical,
    ...fields,
  };
}

// What a send or a claim that stopped before it was kept says, as its notice's fields.
function sendFailure(error) {
  if (error instanceof AccountWithoutKey) {
    return { title: 'Account without a key', body: 'This account has no key on this phone' };
  }
  if (error instanceof TransactionInFlight) {
    return {
      kind: 'attention',
      title: 'Wait for the previous send',
      body: 'A transaction of this account has no block yet on this layer',
    };
  }
  if (error instanceof ProofNotReady) {
    return {
      kind: 'attention',
      title: 'Withdrawal not proven yet',
      body: 'Linea has not finalized this withdrawal on L1 yet',
    };
  }
  if (error instanceof BiometricRefused) {
    return { title: 'Fingerprint not confirmed', body: 'Nothing was signed or sent' };
  }
  if (error instanceof TransactionNotKept) {
    return { title: 'Transfer not recorded', body: 'Nothing was sent' };
  }
  if (error instanceof NodeRejected) {
    return { title: 'Node refused the transaction', body: 'Nothing was sent' };
  }
  if (error instanceof SendUnanswered) {
    return {
      kind: 'attention',
      title: 'Node did not answer',
      body: 'The transaction may have arrived; the list will tell',
    };
  }
  return { title: 'Transfer failed', body: error.shortMessage ?? error.message };
}

// One balance as a card shows it.
function balanceText(balance) {
  if (balance === undefined) return '…';
  return 'error' in balance ? 'unavailable' : `${formatEth(balance.wei)} ETH`;
}

export function BridgeScreen({ network, accounts, account, onOpenAccounts }) {
  const { show, dismiss } = useNotices();
  const { db, secretStore } = useAdapters();
  // Which way the next transfer goes: `deposit`, L1 to L2, or `withdrawal`, L2 to L1.
  const [direction, setDirection] = useState('deposit');
  // The amount as typed, in ETH.
  const [amount, setAmount] = useState('');
  // True while "Max" asks the nodes for the maximum.
  const [measuring, setMeasuring] = useState(false);
  // Which way is being sent now, while it is; null otherwise.
  const [sending, setSending] = useState(null);
  // The hash of the withdrawal being claimed now, while one is; null otherwise.
  const [claiming, setClaiming] = useState(null);
  // The account's balances on L2 and L1, as `balancesOf` gave them; null while being read.
  const [balances, setBalances] = useState(null);
  // The fee a withdrawal pays now, read from Linea's contract when the tab opens; null until then.
  const [withdrawalFee, setWithdrawalFee] = useState(null);
  // The account's transfers on this network, newest first, as kept.
  const [transfers, setTransfers] = useState([]);

  const loadBalances = useCallback(async () => {
    setBalances(null);
    if (network && account) setBalances(await balancesOf(network, account));
  }, [network, account]);

  // It never throws: a failed read leaves the list empty, and the next write reads it again.
  const loadTransfers = useCallback(async () => {
    if (!network || !account) {
      setTransfers([]);
      return;
    }
    try {
      setTransfers(await listTransfers(db, account, network));
    } catch {
      setTransfers([]);
    }
  }, [db, network, account]);

  // Asks both layers about the account's transfers that have no final status, then reads the
  // list: when the tab opens, when the account or the network changes, and after a send. Never
  // in the middle of a send, where a row just signed and not yet sent would read as lost. It
  // never throws: a failed check leaves the rows as kept and says why in a notice that stays
  // until a check works.
  const checkTransfers = useCallback(async () => {
    if (network && account) {
      try {
        await resolveTransfers(db, network, account);
        dismiss('bridge-check-failure');
      } catch (error) {
        const fields = {
          kind: 'attention',
          title: 'Transfers not checked',
          body: error.shortMessage ?? error.message,
          expiresAfter: undefined,
        };
        show(failureNotice('bridge-check-failure', fields, error));
      }
    }
    await loadTransfers();
  }, [db, network, account, loadTransfers, show, dismiss]);

  useEffect(() => {
    loadBalances();
    checkTransfers();
  }, [loadBalances, checkTransfers]);

  useEffect(() => {
    if (!network) return;
    transferFee(network, 'withdrawal')
      .then(setWithdrawalFee)
      .catch(() => setWithdrawalFee(null));
  }, [network]);

  // Fills the field with the most the origin layer lets the account send now.
  async function fillMaximum() {
    setMeasuring(true);
    try {
      setAmount(formatEth(await maximumTransfer(network, account, direction)));
    } catch (error) {
      const fields = { title: 'Maximum not worked out', body: error.shortMessage ?? error.message };
      show(failureNotice('bridge-failure', fields, error));
    } finally {
      setMeasuring(false);
    }
  }

  // `transfer` keeps it before its bytes leave and returns once the origin layer's block is in;
  // each stage it reaches is read back into the list. What happens on the other side, hours
  // later for a withdrawal, waits for the next check.
  async function send() {
    setSending(direction);
    dismiss('bridge-failure');
    dismiss('bridge-record-failure');
    // A write after the bytes left that failed: the row is behind what happened, not missing.
    const onRecordFailure = (error) => {
      const fields = { title: 'Record not updated', body: error.message };
      show(failureNotice('bridge-record-failure', fields, error));
    };
    try {
      await transfer(db, secretStore, network, account, direction, wei, Date.now(), {
        onStage: () => loadTransfers(),
        onRecordFailure,
      });
      await checkTransfers();
      setAmount('');
      loadBalances();
    } catch (error) {
      show(failureNotice('bridge-failure', sendFailure(error), error));
      if (error instanceof NodeRejected) await loadTransfers();
    } finally {
      setSending(null);
    }
  }

  // Proves, signs and sends the claim of a claimable withdrawal on the L1, waits for its block,
  // and lets the resolution read, from the L1 contract, that the message was claimed. A claim the
  // node did not answer is left for the next check, which finds it claimed or still claimable.
  async function claim(withdrawal) {
    setClaiming(withdrawal.hash);
    dismiss('bridge-failure');
    dismiss('bridge-record-failure');
    try {
      await claimWithdrawal(secretStore, network, withdrawal);
      await checkTransfers();
      loadBalances();
    } catch (error) {
      show(failureNotice('bridge-failure', sendFailure(error), error));
    } finally {
      setClaiming(null);
    }
  }

  const wei = weiOf(amount.trim());
  const idle = sending === null && claiming === null;
  const ready = network && account && wei !== null && wei > 0n && idle;
  const depositing = direction === 'deposit';
  const from = depositing ? balances?.l1 : balances?.l2;
  const to = depositing ? balances?.l2 : balances?.l1;
  const feeText = withdrawalFee === null ? '' : `Bridge fee ${formatEth(withdrawalFee)} ETH. `;
  const sendWord = depositing ? 'Deposit' : 'Withdraw';
  const goingWord = depositing ? 'Depositing…' : 'Withdrawing…';
  const destination = depositing ? 'to Linea' : 'to L1';

  return (
    <Page
      header={
        <Header>
          <AccountChip
            account={accounts.find((each) => each.address === account)}
            onPress={onOpenAccounts}
          />
        </Header>
      }
    >
      {/* Only the name: the board's "Linea's canonical bridge" is left out. */}
      <Text style={styles.title}>Bridge</Text>

      <View style={styles.segments} accessibilityRole="radiogroup">
        <Segment label="Deposit" on={depositing} onPress={() => setDirection('deposit')} />
        <Segment label="Withdraw" on={!depositing} onPress={() => setDirection('withdrawal')} />
      </View>

      <View style={styles.sides}>
        <Side name={depositing ? L1 : L2} balance={balanceText(from)} role="from" origin />
        <View style={styles.arrow}>
          <Icon d={ARROW} color={colors.accent} size={22} />
        </View>
        <Side name={depositing ? L2 : L1} balance={balanceText(to)} role="to" />
      </View>

      <View style={styles.field}>
        <View style={styles.box}>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.text3}
            accessibilityLabel="Amount in ETH"
          />
          <Text style={styles.unit}>ETH</Text>
          <Pressable
            style={[styles.max, (measuring || !network || !account) && styles.maxOff]}
            onPress={fillMaximum}
            disabled={measuring || !network || !account}
          >
            <Text style={styles.maxText}>Max</Text>
          </Pressable>
        </View>
        <Text style={styles.info}>
          {depositing
            ? 'Arrives on Linea in about 20 minutes, once the L1 block is finalized. ' +
              'The claim on L2 is automatic.'
            : `${feeText}Arrives on L1 after the proof, in 2 to 12 hours; the app tells you when ` +
              'you can claim it.'}
        </Text>
      </View>

      <View style={ui.payAction}>
        <PrimaryButton
          d={FINGERPRINT_ICON}
          tall
          label={
            sending
              ? goingWord
              : wei !== null && wei > 0n
                ? `${sendWord} ${formatEth(wei)} ETH ${destination}`
                : sendWord
          }
          onPress={send}
          disabled={!ready}
        />
      </View>

      {transfers.length > 0 && (
        <View style={styles.list}>
          <Text style={styles.heading}>Transfers</Text>
          {transfers.map((transfer) => (
            <TransferRow
              key={transfer.hash}
              transfer={transfer}
              network={network}
              onClaim={idle ? () => claim(transfer) : null}
              claiming={claiming === transfer.hash}
            />
          ))}
        </View>
      )}
    </Page>
  );
}

/// One half of the direction switch.
function Segment({ label, on, onPress }) {
  return (
    <Pressable
      style={[styles.segment, on && styles.segmentOn]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
    >
      <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{label}</Text>
    </Pressable>
  );
}

/// One layer and the account's balance on it; the origin's border is the field's, a step
/// brighter than the destination's.
function Side({ name, balance, role, origin }) {
  return (
    <View style={[styles.side, origin && styles.sideOrigin]}>
      <Text style={styles.sideName}>{name}</Text>
      <Text style={styles.sideBalance} numberOfLines={1} adjustsFontSizeToFit>
        {balance}
      </Text>
      <Text style={styles.sideRole}>{role}</Text>
    </View>
  );
}

/// One transfer: which way and how much, then where it stands. A tap opens its transaction in
/// the origin layer's explorer. A claimable withdrawal offers its claim, off while another send or
/// claim runs.
function TransferRow({ transfer, network, onClaim, claiming }) {
  const origin = transfer.direction === 'deposit' ? network.l1Chain : network.chain;
  const explorer = origin.blockExplorers?.default.url;
  const claimable = transfer.direction === 'withdrawal' && transfer.status === 'claimable';
  const chip = chips[transfer.status];
  const about = aboutOf(transfer);
  return (
    <Pressable
      style={styles.row}
      onPress={() => explorer && Linking.openURL(`${explorer}/tx/${transfer.hash}`)}
    >
      <View style={styles.rowText}>
        <View style={styles.what}>
          <Text style={styles.way}>{directionWords[transfer.direction]}</Text>
          <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
            {formatEth(transfer.valueWei)} ETH
          </Text>
        </View>
        {chip ? (
          <View style={styles.chipRow}>
            <StatusChip {...chip} />
            {!claimable && <Text style={styles.when}>{about.text}</Text>}
          </View>
        ) : (
          <Text style={[styles.about, { color: about.color }]} numberOfLines={1}>
            {about.text}
          </Text>
        )}
      </View>
      {claimable && (
        <Pressable
          style={[styles.claim, onClaim === null && styles.claimOff]}
          onPress={onClaim}
          disabled={onClaim === null}
        >
          <Text style={styles.claimText}>{claiming ? 'Claiming…' : 'Claim on L1'}</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // -0.03em of 28.
  title: {
    marginTop: space.gap,
    color: colors.text,
    fontFamily: fonts.ui,
    fontSize: 28,
    fontWeight: '500',
    letterSpacing: -0.84,
  },
  segments: {
    marginTop: space.gap,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  segment: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.iconTile,
  },
  segmentOn: { backgroundColor: colors.border },
  segmentText: { color: colors.text2, fontFamily: fonts.ui, fontSize: 14, fontWeight: '500' },
  segmentTextOn: { color: colors.text },
  sides: { marginTop: space.gap, flexDirection: 'row', gap: 8 },
  side: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  sideOrigin: { borderColor: colors.inputBorder },
  sideName: { color: colors.text2, fontFamily: fonts.ui, fontSize: 12 },
  sideBalance: { color: colors.text, fontFamily: fonts.mono, fontSize: 16 },
  sideRole: { color: colors.text3, fontFamily: fonts.ui, fontSize: 11.5 },
  arrow: { justifyContent: 'center' },
  field: { marginTop: space.gap, gap: 8 },
  box: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  input: { flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.mono, fontSize: 20 },
  unit: { color: colors.text2, fontFamily: fonts.ui, fontSize: 14 },
  // The board's #1F2329 is not a token; `line`, #1F2228, is the nearest.
  max: {
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radius.iconTile,
    backgroundColor: colors.line,
  },
  maxOff: { opacity: 0.5 },
  maxText: { color: colors.text, fontFamily: fonts.ui, fontSize: 13, fontWeight: '500' },
  info: { color: colors.text2, fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17.5 },
  list: { marginTop: space.gap, gap: 4 },
  heading: {
    marginBottom: 2,
    color: colors.text2,
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: '500',
  },
  // As the other lists: the boards' divider, #16181C, is nearest to `surface`.
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  rowText: { flex: 1, minWidth: 0, gap: 4 },
  what: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  way: { color: colors.text, fontFamily: fonts.ui, fontSize: 14, fontWeight: '500' },
  amount: { flexShrink: 1, color: colors.text, fontFamily: fonts.mono, fontSize: 13 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  when: { color: colors.text3, fontFamily: fonts.ui, fontSize: 12 },
  about: { fontFamily: fonts.ui, fontSize: 12 },
  claim: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  claimOff: { opacity: 0.5 },
  claimText: { color: colors.onAccent, fontFamily: fonts.ui, fontSize: 13, fontWeight: '600' },
});
