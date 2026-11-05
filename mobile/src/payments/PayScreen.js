// The pay tab: choose which stored account signs, and pay a charge through the contract.

import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { AccountWithoutKey, BiometricRefused } from '@nullius/core/accounts';
import { ChargeOnOtherNetwork, decodeCharge } from '@nullius/core/charges';
import {
  listSentPayments,
  markFinalized,
  PaymentRefused,
  payCharge,
  resolveSentPayments,
} from '@nullius/core/payments';
import {
  NodeRejected,
  SendUnanswered,
  TransactionInFlight,
  TransactionNotKept,
} from '@nullius/core/transactions';
import { useAdapters } from '../adapters';
import { AccountChip, Header } from '../components/Header';
import { ChargeCard } from './ChargeCard';
import { PaymentScreen } from './PaymentScreen';
import { TypeChargeScreen } from './TypeChargeScreen';
import { refusalSentences, refusalTitles, revertWords } from './refusals';
import { formatEth, groupDigits, shortAddress } from '../theme/format';
import { FINGERPRINT_ICON } from '../components/Icon';
import { useNotices } from '../components/notices';
import { ScanScreen } from './ScanScreen';
import { SentPaymentList } from './SentPaymentList';
import { SentPaymentsScreen } from './SentPaymentsScreen';
import { Layer, Page, PrimaryButton, styles, ToolButton } from '../components/ui';

const NO_KEY =
  'This account has no key on this phone; if the biometrics changed, the key was invalidated. ' +
  'Remove the account and add it again.';

/**
 * A failure of the pay tab as a notice: shown on this tab only, an error that goes away after
 * 6 s unless `fields` says otherwise. `detail` is what a tap on the notice opens:
 * `sentence`, when there is one, then the technical words of viem or of the node, which for a
 * refusal carry the values the contract derived. `shortMessage` is viem's first line, without
 * its documentation links and version.
 */
function failureNotice(id, fields, error, sentence) {
  const technical = error.shortMessage ?? error.message;
  return {
    id,
    kind: 'error',
    tab: 'pay',
    where: ['pay'],
    expiresAfter: 6000,
    detail: sentence ? `${sentence}\n\n${technical}` : technical,
    ...fields,
  };
}

// What a failed payment says, as the fields of its notice and the sentence of its detail. Anything
// not recognized here keeps viem's words as its line.
function payFailure(error, label) {
  if (error instanceof PaymentRefused) {
    return [
      {
        title: refusalTitles[error.reason],
        body: 'The contract refused in the simulation, no fee',
      },
      refusalSentences[error.reason],
    ];
  }
  if (error instanceof AccountWithoutKey) {
    // Up until the account changes or the next payment, since the key has to be added again.
    const body = `${label} has no key on this phone`;
    const fields = {
      tab: 'accounts',
      title: 'Account without a key',
      body,
      expiresAfter: undefined,
    };
    return [fields, NO_KEY];
  }
  if (error instanceof TransactionInFlight) {
    return [
      {
        kind: 'attention',
        title: 'Wait for the previous send',
        body: 'A transaction of this account has no block yet',
      },
    ];
  }
  if (error instanceof BiometricRefused) {
    return [{ title: 'Fingerprint not confirmed', body: 'Nothing was signed or sent' }];
  }
  return [{ title: 'Payment failed', body: error.shortMessage ?? error.message }];
}

// The icons of the three ways a charge comes in, from `Pagar.dc.html`.
const SCAN_ICON =
  'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8';
const PASTE_ICON =
  'M9 4h6v3H9zM9 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-3';
const TYPE_ICON = 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4';

// The result of a payment, on the pay tab only: sent and waiting for its block
// while `settled` is null, then executed or reverted, which go away by themselves after 6 s.
function paymentNotice(payment, settled) {
  const sent = `${formatEth(payment.valueWei)} ETH to ${shortAddress(payment.payee)}`;
  const notice = { id: 'payment', tab: 'pay', where: ['pay'] };
  if (settled === null) {
    return {
      ...notice,
      kind: 'attention',
      title: 'Payment sent',
      body: `${sent}, waiting for the block`,
    };
  }
  if (settled.status === 'success') {
    return {
      ...notice,
      kind: 'success',
      title: 'Payment confirmed',
      body: `${sent} in block ${groupDigits(settled.blockNumber)}`,
      expiresAfter: 6000,
    };
  }
  // A reverted transaction is in a block and paid its gas: only the value did not move.
  const reason = revertWords[settled.revertReason];
  return {
    ...notice,
    kind: 'error',
    title: 'Payment reverted',
    body: `${reason[0].toUpperCase()}${reason.slice(1)} · only the fee was charged`,
    expiresAfter: 6000,
  };
}

export function PayScreen({ network, networkFailure, accounts, payer, rounds, onOpenAccounts }) {
  const { show, dismiss } = useNotices();
  const { db, secretStore } = useAdapters();
  const [payee, setPayee] = useState('');
  const [valueWei, setValueWei] = useState('');
  // Empty until a charge comes in: the salt comes from the payee, never from this tab.
  const [salt, setSalt] = useState('');
  const [orderId, setOrderId] = useState('');
  // True when the four values are what `decodeCharge` read from a pasted charge, false when they
  // were typed. The card says "verificada" only while it is true.
  const [verified, setVerified] = useState(false);
  // Whether `TypeChargeScreen` is open over the tab.
  const [typing, setTyping] = useState(false);
  // Whether `ScanScreen`, the camera reading a charge's QR code, is open over the tab.
  const [scanning, setScanning] = useState(false);
  // Whether `SentPaymentsScreen`, every payment of the payer, is open over the tab.
  const [listing, setListing] = useState(false);
  // The hash of the payment whose `PaymentScreen` is open over the tab or the list; null while
  // none is.
  const [openedHash, setOpenedHash] = useState(null);
  // True from the tap on Pay until `waitForPayment` ends, so a second tap cannot pay again.
  const [sending, setSending] = useState(false);
  // The payments kept for the chosen payer on the network in use, newest first.
  const [sentPayments, setSentPayments] = useState([]);

  // Read again after every write, by `checkSentPayments`, and after every slice and round of the
  // history reading above the tabs, which `rounds` counts. It never throws: a failed read
  // empties the list, so another payer's payments are not left under this one, and says why in a
  // notice that stays until a read works: the payments may all be kept, only reading them failed.
  const loadSentPayments = useCallback(async () => {
    if (!network || !payer) {
      setSentPayments([]);
      return;
    }
    try {
      setSentPayments(await listSentPayments(db, payer, network));
      dismiss('list-failure');
    } catch (error) {
      setSentPayments([]);
      const fields = {
        title: 'Sent payments not read',
        body: error.message,
        expiresAfter: undefined,
      };
      show(failureNotice('list-failure', fields, error));
    }
  }, [db, network, payer, show, dismiss]);

  // Asks the node about the payer's payments that have no final status and about the finalized
  // block, then reads the list: when the tab opens, when the payer or the network changes, before
  // a payment, and after a send the node did not answer. The `Payment` logs are the history
  // reading's, above the tabs. Never in the middle of a payment, where a row just signed and not
  // yet sent would read as lost. It never throws: a failed check leaves the rows as kept and says
  // why in a notice that stays until a check works.
  const checkSentPayments = useCallback(async () => {
    if (network && payer) {
      try {
        await resolveSentPayments(db, network, payer);
        await markFinalized(db, network, payer);
        dismiss('check-failure');
      } catch (error) {
        const fields = {
          kind: 'attention',
          title: 'Payments not checked',
          body: error.shortMessage ?? error.message,
          expiresAfter: undefined,
        };
        show(failureNotice('check-failure', fields, error));
      }
    }
    await loadSentPayments();
  }, [db, network, payer, loadSentPayments, show, dismiss]);

  useEffect(() => {
    checkSentPayments();
  }, [checkSentPayments]);

  // A payment the history reading found or finalized shows in the list too.
  useEffect(() => {
    loadSentPayments();
  }, [rounds, loadSentPayments]);

  // A failed payment belongs to the account that tried it: another account starts clean.
  useEffect(() => {
    dismiss('pay-failure');
  }, [payer, dismiss]);

  // Fills the four values from the payee's charge, pasted or read from its QR code;
  // `decodeCharge` already checked the order id against the other three, and the chain and the
  // contract against the network in use. Says whether `text` was a charge of this network; when
  // it was not, a notice says so, `from` naming where the text came from.
  function takeCharge(text, from) {
    try {
      const charge = decodeCharge(text, network);
      setPayee(charge.payee);
      setValueWei(String(charge.valueWei));
      setSalt(charge.salt);
      setOrderId(charge.orderId);
      setVerified(true);
      dismiss('charge-failure');
      dismiss('pay-failure');
      return true;
    } catch (error) {
      const title =
        error instanceof ChargeOnOtherNetwork ? 'Charge from another network' : 'Not a charge';
      const body = `${from} is not a charge on this network`;
      show(failureNotice('charge-failure', { title, body }, error));
      return false;
    }
  }

  async function pasteCharge() {
    if (!network) return;
    takeCharge(await Clipboard.getStringAsync(), 'The pasted text');
  }

  // A charge read closes the camera; anything else leaves it reading, under its notice.
  function scanCharge(text) {
    const taken = takeCharge(text, 'The QR code read');
    if (taken) setScanning(false);
    return taken;
  }

  // The four values from `TypeChargeScreen`, which let them through only once the order id was the
  // hash of the other three.
  function confirmTyped(typed) {
    setPayee(typed.payee);
    setValueWei(String(typed.valueWei));
    setSalt(typed.salt);
    setOrderId(typed.orderId);
    setVerified(false);
    dismiss('charge-failure');
    dismiss('pay-failure');
    setTyping(false);
  }

  async function pay() {
    setSending(true);
    dismiss('payment');
    dismiss('pay-failure');
    dismiss('record-failure');
    await checkSentPayments();
    const payment = { payer, payee, valueWei: BigInt(valueWei), salt, orderId };
    // `payCharge` keeps the payment before its bytes leave the phone; each stage it reaches is
    // read back into the list, and the sent and settled ones also get their notice.
    const onStage = ({ stage, outcome }) => {
      if (stage === 'sent') show(paymentNotice(payment, null));
      if (stage === 'settled') show(paymentNotice(payment, outcome));
      loadSentPayments();
    };
    // A write after the bytes left that failed: the row is behind what happened, not missing.
    const onRecordFailure = (error) => {
      const fields = { title: 'Record not updated', body: error.message };
      show(failureNotice('record-failure', fields, error));
    };
    try {
      await payCharge(db, secretStore, network, payment, Date.now(), {
        onStage,
        onRecordFailure,
      });
    } catch (error) {
      if (error instanceof TransactionNotKept) {
        const fields = { title: 'Payment not recorded', body: 'Nothing was sent' };
        show(failureNotice('pay-failure', fields, error));
      } else if (error instanceof NodeRejected) {
        const fields = { title: 'Node refused the transaction', body: 'Nothing was sent' };
        show(failureNotice('pay-failure', fields, error));
        await loadSentPayments();
      } else if (error instanceof SendUnanswered) {
        const fields = {
          kind: 'attention',
          title: 'Node did not answer',
          body: 'The transaction may have arrived; the list will tell',
        };
        show(failureNotice('pay-failure', fields, error));
        await checkSentPayments();
      } else {
        const label = accounts.find((account) => account.address === payer)?.label;
        const [fields, sentence] = payFailure(error, label);
        show(failureNotice('pay-failure', fields, error, sentence));
      }
    } finally {
      setSending(false);
    }
  }

  const incomplete = !network || !payer || !payee || !valueWei || !salt || !orderId;
  const explorer = network?.chain.blockExplorers?.default.url;
  const account = accounts.find((each) => each.address === payer);
  // Looked up on every render, so the detail follows its row as it changes. A row that went away
  // with the list, on a failed read, closes the detail.
  const opened = sentPayments.find((sent) => sent.hash === openedHash);

  // Android's back button closes what is open over the tab, the top one first.
  // With nothing open it is left to Android, which leaves the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (opened) setOpenedHash(null);
      else if (listing) setListing(false);
      else if (typing) setTyping(false);
      else if (scanning) setScanning(false);
      else return false;
      return true;
    });
    return () => subscription.remove();
  }, [opened, listing, typing, scanning]);

  // The tab, then what opens over it: the camera, the typed charge or the list, and over the tab
  // or the list the detail of a payment. Only the top one shows.
  return (
    <>
      <Layer hidden={typing || scanning || listing || opened !== undefined}>
        <Page
          header={
            <Header>
              <AccountChip account={account} onPress={onOpenAccounts} />
            </Header>
          }
        >
          {/* While the node is checked when the app opens; a failure is a notice from `App.js`. */}
          {!network && !networkFailure && <Text style={styles.hint}>checking the node…</Text>}

          <View style={styles.tools}>
            <ToolButton
              d={SCAN_ICON}
              label="Scan"
              onPress={() => setScanning(true)}
              disabled={!network}
            />
            <ToolButton d={PASTE_ICON} label="Paste" onPress={pasteCharge} disabled={!network} />
            <ToolButton d={TYPE_ICON} label="Type" onPress={() => setTyping(true)} />
          </View>

          <ChargeCard
            network={network}
            payee={payee}
            valueWei={valueWei}
            orderId={orderId}
            verified={verified}
          />

          <View style={styles.payAction}>
            <PrimaryButton
              d={FINGERPRINT_ICON}
              tall
              label={
                sending
                  ? 'Paying…'
                  : orderId
                    ? `Pay ${formatEth(BigInt(valueWei))} ETH`
                    : 'Pay'
              }
              onPress={pay}
              disabled={sending || incomplete}
            />
          </View>

          <SentPaymentList
            sentPayments={sentPayments}
            onSeeAll={() => setListing(true)}
            onOpen={setOpenedHash}
          />
        </Page>
      </Layer>
      {/* Mounted only while open: one camera at a time, and none left running under the tab. */}
      {scanning && (
        <ScanScreen network={network} onBack={() => setScanning(false)} onScanned={scanCharge} />
      )}
      {typing && (
        <TypeChargeScreen
          network={network}
          onBack={() => setTyping(false)}
          onConfirm={confirmTyped}
        />
      )}
      {listing && (
        <Layer hidden={opened !== undefined}>
          <SentPaymentsScreen
            account={account}
            network={network}
            sentPayments={sentPayments}
            onBack={() => setListing(false)}
            onOpen={setOpenedHash}
          />
        </Layer>
      )}
      {opened && (
        <PaymentScreen
          sent={opened}
          explorer={explorer}
          backLabel={listing ? 'Payments' : 'Pay'}
          onBack={() => setOpenedHash(null)}
        />
      )}
    </>
  );
}
