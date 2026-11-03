// Nullius — the app for both sides of a payment.
//
// Five tabs. The account chosen here is the one the pay tab signs with, the one the receive tab
// charges to and the one the bridge tab moves, so it is kept above the tabs instead of inside one.
//
// Code, comments and what the user reads on screen are all in English.

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { keepChosenAccount, listAccounts, readChosenAccount } from '@nullius/core/accounts';
import { AccountsScreen } from './accounts/AccountsScreen';
import { AdaptersProvider, openAdapters, useAdapters } from './adapters';
import { BridgeScreen } from './bridge/BridgeScreen';
import { useClaimable } from './bridge/claimable';
import { openStoredNetwork } from '@nullius/core/network';
import { useOldHistory } from './history/OldHistory';
import { NoticesContext, useNoticeList } from './components/notices';
import { NetworkScreen } from './network/NetworkScreen';
import { usePaidCharges } from './charges/paidCharges';
import { PayScreen } from './payments/PayScreen';
import { ReceiveScreen } from './charges/ReceiveScreen';
import { TabBar } from './components/TabBar';
import { formatEth } from './theme/format';
import { colors, fonts, space } from './theme/theme';
import { PrimaryButton } from './components/ui';

/// Android draws this app edge to edge: the page runs under the status bar at the top and
/// under the navigation bar at the bottom, so padding alone lands behind them. The provider is
/// what measures those two bars.
export default function App() {
  return (
    <SafeAreaProvider>
      <OpenedAdapters />
    </SafeAreaProvider>
  );
}

/// The database is opened once, before any tab, since every tab reads or writes it; the tabs get
/// it, with the keystore, from `useAdapters()`. An opening that fails says why, and a tap opens
/// again.
function OpenedAdapters() {
  const [adapters, setAdapters] = useState(null);
  const [failure, setFailure] = useState(null);

  const open = useCallback(() => {
    setFailure(null);
    openAdapters().then(setAdapters, (error) => setFailure(error.message));
  }, []);

  useEffect(() => {
    open();
  }, [open]);

  if (adapters === null) return <Opening failure={failure} onRetry={open} />;
  return (
    <AdaptersProvider value={adapters}>
      <Nullius />
    </AdaptersProvider>
  );
}

/// What shows while the database opens, which is usually too short to see, or why it did not.
function Opening({ failure, onRetry }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.opening, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {failure !== null && (
        <>
          <Text style={styles.openingTitle}>The database did not open</Text>
          <Text style={styles.openingBody}>{failure}</Text>
          <PrimaryButton label="Try again" onPress={onRetry} />
        </>
      )}
    </View>
  );
}

function Nullius() {
  const insets = useSafeAreaInsets();
  const { secretStore } = useAdapters();
  const [tab, setTab] = useState('pay');
  // The network in use, once `checkNode` accepted its node; null until then.
  const [network, setNetwork] = useState(null);
  // Why opening the network failed, as viem or `checkNode` worded it; null while it has not.
  const [networkFailure, setNetworkFailure] = useState(null);
  // The accounts in the keystore's index: labels and addresses, never a key.
  const [accounts, setAccounts] = useState([]);
  const [chosenAccount, setChosenAccount] = useState('');

  // Once, when the app opens. A failure leaves `network` null, which keeps the pay button off;
  // the network tab is where a kept node that fails is replaced or removed.
  useEffect(() => {
    async function open() {
      setNetwork(await openStoredNetwork(secretStore));
    }
    open().catch((error) => setNetworkFailure(error.shortMessage ?? error.message));
  }, [secretStore]);

  // The network tab saved a network or went back to the default: it is in use from now on, and
  // any failure at opening is over.
  function changeNetwork(accepted) {
    setNetwork(accepted);
    setNetworkFailure(null);
  }

  // Read when the app opens and again whenever the accounts tab changes what is stored. The one
  // chosen before, in this run or the last one, stays chosen while it is still listed; otherwise
  // the first.
  const loadAccounts = useCallback(async () => {
    const stored = await listAccounts(secretStore);
    const kept = await readChosenAccount(secretStore);
    setAccounts(stored);
    setChosenAccount((chosen) => {
      const listed = (address) => stored.some((account) => account.address === address);
      if (listed(chosen)) return chosen;
      return listed(kept) ? kept : (stored[0]?.address ?? '');
    });
  }, [secretStore]);

  // A choice made in the accounts tab is kept, so the app opens on it next time. A failed write
  // only loses that: the choice holds for this run.
  function chooseAccount(address) {
    setChosenAccount(address);
    keepChosenAccount(secretStore, address).catch(() => {});
  }

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const { notices, show, dismiss, hold } = useNoticeList();

  // Watched from here, above the tabs, so a charge paid while any tab is open is noticed. Opening
  // the receive tab, where the charge is, takes the notice down.
  const paidCharges = usePaidCharges(network, chosenAccount, show);

  // Checked from here too, so a withdrawal that became claimable is noticed on every tab but the
  // bridge, where the claim is. Opening the bridge takes the notice down until the next check.
  const claimable = useClaimable(network, chosenAccount);
  useEffect(() => {
    if (claimable.count === 0) {
      dismiss('claimable');
      return;
    }
    show({
      id: 'claimable',
      kind: 'action',
      tab: 'bridge',
      where: ['pay', 'receive', 'accounts', 'network'],
      title:
        claimable.count === 1
          ? 'Withdrawal ready on L1'
          : `${claimable.count} withdrawals ready on L1`,
      body: `${formatEth(claimable.valueWei)} ETH waiting for you to claim`,
    });
  }, [claimable, show, dismiss]);
  // A node that failed when the app opened leaves every tab without a network: the notice says so
  // on all of them, with viem's or `checkNode`'s words behind a tap, until the network tab puts a
  // node that passes in use.
  useEffect(() => {
    if (!networkFailure) {
      dismiss('network-failure');
      return;
    }
    show({
      id: 'network-failure',
      kind: 'error',
      tab: 'network',
      title: 'RPC node failed',
      body: 'The node in use failed its check when the app opened',
      detail: networkFailure,
    });
  }, [networkFailure, show, dismiss]);

  // Kept here, above the tabs, so the chosen account's cursor is started whichever tab is open.
  const oldHistory = useOldHistory(network, chosenAccount);

  useEffect(() => {
    if (tab === 'bridge') dismiss('claimable');
    if (tab === 'receive') dismiss('paid');
  }, [tab, dismiss]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* The tabs live at the bottom, so the status bar's height is kept clear up here. */}
      <NoticesContext.Provider value={{ notices, tab, show, dismiss, hold }}>
        <View style={{ flex: 1, paddingTop: insets.top }}>

          {tab === 'pay' && (
            <PayScreen
              network={network}
              networkFailure={networkFailure}
              accounts={accounts}
              payer={chosenAccount}
              onOpenAccounts={() => setTab('accounts')}
            />
          )}
          {tab === 'receive' && (
            <ReceiveScreen
              network={network}
              accounts={accounts}
              payee={chosenAccount}
              paidCharges={paidCharges}
              onOpenAccounts={() => setTab('accounts')}
            />
          )}
          {tab === 'bridge' && (
            <BridgeScreen
              network={network}
              accounts={accounts}
              account={chosenAccount}
              onOpenAccounts={() => setTab('accounts')}
            />
          )}
          {tab === 'accounts' && (
            <AccountsScreen
              network={network}
              accounts={accounts}
              chosen={chosenAccount}
              onChoose={chooseAccount}
              onChanged={loadAccounts}
              oldHistory={oldHistory}
            />
          )}
          {tab === 'network' && (
            <NetworkScreen
              network={network}
              networkFailure={networkFailure}
              onNetworkChanged={changeNetwork}
            />
          )}
        </View>
      </NoticesContext.Provider>
      <TabBar tab={tab} onChange={setTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  opening: {
    flex: 1,
    justifyContent: 'center',
    gap: space.gap,
    paddingHorizontal: space.screenX,
    backgroundColor: colors.bg,
  },
  openingTitle: { color: colors.text, fontFamily: fonts.ui, fontSize: 20, fontWeight: '500' },
  openingBody: { color: colors.text2, fontFamily: fonts.mono, fontSize: 13 },
});
