// The accounts tab, as `Contas.dc.html` draws it: what this device can sign as, which account the
// other tabs use, and importing or removing one.

import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { maxAccounts, removeAccount } from '@nullius/core/accounts';
import { balancesOf } from '@nullius/core/balances';
import { useAdapters } from '../adapters';
import { formatEth, shortAddress } from '../theme/format';
import { Header } from '../components/Header';
import { OldHistoryLink } from '../history/OldHistory';
import { Icon } from '../components/Icon';
import { ImportKeyScreen } from './ImportKeyScreen';
import { useNotices } from '../components/notices';
import { colors, fonts, radius, space } from '../theme/theme';
import { Layer, Page, PrimaryButton } from '../components/ui';

const SHIELD = 'M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z';
const TRASH = 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12';
const KEY = 'M14 10a4 4 0 1 0-3.5 4L9 15.5V18H7v2H4v-3l6-6M15 9h.01';

// One balance as the card shows it: every decimal, since rounding would hide wei that are there;
// `…` while it is read.
function balanceText(balance) {
  if (balance === undefined) return '…';
  return 'error' in balance ? 'unavailable' : `${formatEth(balance.wei)} ETH`;
}

// The first failure of one layer among all the accounts: the same node failed for each, so it is
// said once.
function firstFailure(balances, layer) {
  return Object.values(balances).find((balance) => 'error' in balance[layer])?.[layer].error;
}

export function AccountsScreen({
  network,
  accounts,
  chosen,
  onChoose,
  onChanged,
  oldHistory,
}) {
  const { show, dismiss } = useNotices();
  const { secretStore } = useAdapters();
  const [busy, setBusy] = useState(false);
  // Whether `ImportKeyScreen` is open over the tab.
  const [importing, setImporting] = useState(false);
  // Whether the security advice is open over the screen.
  const [advising, setAdvising] = useState(false);
  // Each account's balances on L2 and L1, by address, as `balancesOf` gave them; an account
  // missing here is being read.
  const [balances, setBalances] = useState({});

  // Read when the tab opens and when the accounts or the network change. The accounts are read at
  // once; `balancesOf` never throws, it says each failure. A layer that failed is said in a
  // notice that stays until a read works.
  const loadBalances = useCallback(async () => {
    setBalances({});
    if (!network) return;
    const read = Object.fromEntries(
      await Promise.all(
        accounts.map(async ({ address }) => [address, await balancesOf(network, address)]),
      ),
    );
    setBalances(read);
    const failures = [
      ['L2', firstFailure(read, 'l2')],
      ['L1', firstFailure(read, 'l1')],
    ].filter(([, failure]) => failure);
    if (failures.length === 0) {
      dismiss('balances-failure');
      return;
    }
    show({
      id: 'balances-failure',
      kind: 'attention',
      tab: 'accounts',
      where: ['accounts'],
      title: 'Balances not read',
      body: `The ${failures.map(([layer]) => layer).join(' and ')} node failed`,
      detail: failures.map(([layer, failure]) => `${layer}: ${failure}`).join('\n\n'),
    });
  }, [network, accounts, show, dismiss]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  // Android's back button closes the import open over the tab; with nothing open
  // it is left to Android, which leaves the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!importing) return false;
      setImporting(false);
      return true;
    });
    return () => subscription.remove();
  }, [importing]);

  const full = accounts.length >= maxAccounts;

  // A tap chooses an account, so copying its address is a long press. An address
  // is 42 characters that have to be exact, and selecting one by hand on a phone is where a
  // wrong one comes from.
  async function copy(account) {
    await Clipboard.setStringAsync(account.address);
    show({
      id: 'address-copied',
      kind: 'success',
      tab: 'accounts',
      where: ['accounts'],
      title: 'Address copied',
      body: `${account.label} · ${shortAddress(account.address)}`,
      expiresAfter: 3000,
    });
  }

  // Deleting takes the key with it, and this is the only copy the app has. Whoever has it
  // elsewhere can restore the account; whoever does not loses whatever it holds.
  function confirmRemoval(account) {
    Alert.alert(
      `Delete ${account.label}?`,
      'The private key is deleted with it. Without another copy of it, this account\'s ' +
        'balance is out of reach.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove(account) },
      ],
    );
  }

  async function remove(account) {
    setBusy(true);
    try {
      await removeAccount(secretStore, account.address);
      onChanged();
    } catch (error) {
      show({
        id: 'remove-failure',
        kind: 'error',
        tab: 'accounts',
        where: ['accounts'],
        title: 'Account not deleted',
        body: error.message,
        detail: error.message,
        expiresAfter: 6000,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Layer hidden={importing}>
        <Page
          header={
            <Header>
              <View style={styles.keystore}>
                <Icon d={SHIELD} color={colors.text2} size={16} />
                <Text style={styles.keystoreText}>Android Keystore</Text>
              </View>
            </Header>
          }
        >
          <View style={styles.titleRow}>
            <Text style={styles.title}>Accounts</Text>
            <Text style={styles.count}>
              {accounts.length} of {maxAccounts}
            </Text>
          </View>

          <View style={styles.cards}>
            {accounts.map((account) => (
              <AccountCard
                key={account.address}
                account={account}
                balances={balances[account.address]}
                on={chosen === account.address}
                onChoose={() => onChoose(account.address)}
                onCopy={() => copy(account)}
                onRemove={() => confirmRemoval(account)}
                busy={busy}
              />
            ))}
            {accounts.length === 0 && (
              <Text style={styles.empty}>No accounts yet. Import the first key.</Text>
            )}
          </View>

          {/* "Create account" is left out: a key made here would need a copy kept outside
              first. */}
          <Pressable
            style={[styles.import, full && styles.importOff]}
            onPress={() => setImporting(true)}
            disabled={full}
          >
            <Icon d={KEY} color={full ? colors.text3 : colors.text} size={18} />
            <Text style={[styles.importText, full && styles.importTextOff]}>
              {full ? `Limit of ${maxAccounts} accounts` : 'Import key'}
            </Text>
          </Pressable>

          <Text style={styles.footer}>
            Private keys are kept encrypted on this phone and read only with your fingerprint,
            when signing. Nothing leaves the phone but signed transactions.
          </Text>
          <Pressable style={styles.advice} onPress={() => setAdvising(true)}>
            <Icon d={SHIELD} color={colors.text} size={18} />
            <Text style={styles.adviceText}>Security advice</Text>
          </Pressable>
          {chosen && (
            <OldHistoryLink
              label={accounts.find((account) => account.address === chosen)?.label}
              history={oldHistory}
            />
          )}
          <SecurityAdvice visible={advising} onClose={() => setAdvising(false)} />
        </Page>
      </Layer>
      {importing && (
        <ImportKeyScreen
          nextLabel={`Account ${accounts.length + 1}`}
          onBack={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

/// One account: its name and address, then its balance on each layer, one per line so every
/// decimal fits. A tap chooses it, a long press copies its address, and the bin removes it.
function AccountCard({ account, balances, on, onChoose, onCopy, onRemove, busy }) {
  return (
    <View style={[styles.card, on && styles.cardOn]}>
      <Pressable
        style={styles.choose}
        onPress={onChoose}
        onLongPress={onCopy}
        accessibilityState={{ selected: on }}
        accessibilityHint="Long press to copy the address"
      >
        <View style={styles.nameRow}>
          <View style={[styles.dot, on && styles.dotOn]} />
          <Text style={styles.name}>{account.label}</Text>
          <Text style={styles.address}>{shortAddress(account.address)}</Text>
        </View>
        <Text style={styles.balance}>
          L1 <Text style={styles.balanceValue}>{balanceText(balances?.l1)}</Text>
        </Text>
        <Text style={styles.balance}>
          L2 <Text style={styles.balanceValue}>{balanceText(balances?.l2)}</Text>
        </Text>
      </Pressable>
      <Pressable
        style={styles.remove}
        onPress={onRemove}
        disabled={busy}
        accessibilityLabel={`Remove account ${account.label}`}
      >
        <Icon d={TRASH} color={colors.text3} size={18} />
      </Pressable>
    </View>
  );
}

/// Why a key kept only on this phone can be lost, and what to do about it. A tap
/// outside the card, "Entendi" or Android's back button closes it.
function SecurityAdvice({ visible, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Claims the touches on the card, so scrolling it does not close it. */}
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <Text style={styles.sheetTitle}>Security advice</Text>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Text style={styles.paragraph}>
              The private key is the account: whoever has the key moves the balance, and without it
              nobody does. Nullius keeps the key only in this phone's keystore, encrypted and
              bound to your biometrics. There is no server and no copy anywhere else.
            </Text>
            <Text style={styles.paragraph}>The key is lost, and the balance with it, if:</Text>
            <Text style={styles.item}>· the phone is lost, stolen or broken;</Text>
            <Text style={styles.item}>· the app is uninstalled or its data cleared;</Text>
            <Text style={styles.item}>· the phone is reset to factory settings;</Text>
            <Text style={styles.item}>
              · the enrolled fingerprints or face are changed or removed: Android invalidates the
              key bound to the old biometrics.
            </Text>
            <Text style={styles.paragraph}>
              Keep a copy of each key off the phone before putting a balance in the account: on
              paper, somewhere safe, or in a password manager. The app never shows the key again,
              so the copy is the one you had when importing it.
            </Text>
            <Text style={styles.paragraph}>
              Never send the key to anyone or take a photo of it. Nullius will never ask for your
              key.
            </Text>
          </ScrollView>
          <PrimaryButton label="Got it" onPress={onClose} />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keystore: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keystoreText: { color: colors.text2, fontFamily: fonts.ui, fontSize: 13 },
  titleRow: {
    marginTop: space.gap,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  // -0.03em of 28.
  title: {
    color: colors.text,
    fontFamily: fonts.ui,
    fontSize: 28,
    fontWeight: '500',
    letterSpacing: -0.84,
  },
  count: { color: colors.text2, fontFamily: fonts.mono, fontSize: 13 },
  cards: { marginTop: space.gap, gap: 8 },
  card: {
    flexDirection: 'row',
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardOn: { borderColor: colors.accent },
  choose: { flex: 1, minWidth: 0, gap: 6, paddingVertical: 14, paddingLeft: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // The boards dot an account not chosen in #3A404A, which no token names; `inputBorder` is the
  // nearest.
  dot: { width: 8, height: 8, borderRadius: radius.chip, backgroundColor: colors.inputBorder },
  dotOn: { backgroundColor: colors.accent },
  name: { color: colors.text, fontFamily: fonts.ui, fontSize: 15, fontWeight: '500' },
  address: { color: colors.text2, fontFamily: fonts.mono, fontSize: 12 },
  balance: { color: colors.text2, fontFamily: fonts.mono, fontSize: 12 },
  balanceValue: { color: colors.text },
  remove: { width: 48, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.text3, fontFamily: fonts.ui, fontSize: 13 },
  import: {
    marginTop: space.gap,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  importOff: { borderColor: colors.line },
  importText: { color: colors.text, fontFamily: fonts.ui, fontSize: 14, fontWeight: '500' },
  importTextOff: { color: colors.text3 },
  advice: {
    marginTop: space.gap,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.border,
  },
  adviceText: { color: colors.text, fontFamily: fonts.ui, fontSize: 14, fontWeight: '500' },
  // As the detail of a notice: the background dimmed, a card in the middle.
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: space.screenX,
    backgroundColor: colors.backdrop,
  },
  sheet: {
    maxHeight: '80%',
    gap: 12,
    padding: space.cardPad,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  sheetTitle: { color: colors.text, fontFamily: fonts.ui, fontSize: 17, fontWeight: '500' },
  sheetBody: { gap: 10 },
  paragraph: { color: colors.text2, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 },
  item: { paddingLeft: 8, color: colors.text2, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 },
  footer: {
    marginTop: space.gap,
    color: colors.text3,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 17.4,
  },
});
