// The receive tab, as `Receber.dc.html` draws it: the chosen account charges an amount, the
// charge is kept in the database, and the card shows it as one base64url text for the payer to
// paste into the pay tab.

import { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { createCharge, encodeCharge, listCharges } from '@nullius/core/charges';
import { readHistory } from '@nullius/core/history';
import { useAdapters } from '../adapters';
import { chargeChip, ChargesScreen } from './ChargesScreen';
import { ChargeQr } from './ChargeQr';
import { formatEth, formatWhen, groupDigits, shortAddress, weiOf } from '../theme/format';
import { AccountChip, Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { useNotices } from '../components/notices';
import { StatusChip } from '../components/StatusChip';
import { colors, fonts, radius, space } from '../theme/theme';
import { Layer, Page, styles as ui } from '../components/ui';

const RECEIVED_ICON = 'M17 7L7 17M15 17H7V9';
// The three actions of the charge's card, as icons only.
const QR_ICON =
  'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 20h2M18 18h2v2h-2z';
const COPY_ICON =
  'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM16 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3';
const SHARE_ICON =
  'M4 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M16 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M16 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7.8 11l8.4-4M7.8 13l8.4 4';

// How many charges the tab lists; the rest are a tap on "Ver todas" away.
const RECENT = 5;

/**
 * A failure of the receive tab as a notice, shown on this tab only: an error that goes away after
 * 6 s unless `fields` says otherwise, with viem's or the database's words behind a tap.
 */
function failureNotice(id, fields, error) {
  return {
    id,
    kind: 'error',
    tab: 'receive',
    where: ['receive'],
    expiresAfter: 6000,
    detail: error.shortMessage ?? error.message,
    ...fields,
  };
}

export function ReceiveScreen({ network, accounts, payee, paidCharges, onOpenAccounts }) {
  const { show, dismiss } = useNotices();
  const { db } = useAdapters();
  // The amount as typed, in ETH.
  const [eth, setEth] = useState('');
  // The charge last generated or picked from the list, `{ payee, valueWei, salt, orderId, text }`,
  // `text` being what `encodeCharge` wrote; null until then. It keeps its own payee and amount, so
  // editing the field or switching account afterwards does not change what was handed to the
  // payer.
  const [charge, setCharge] = useState(null);
  // The charges kept for the chosen account on the network in use, newest first.
  const [charges, setCharges] = useState([]);
  // How many blocks the history reading still has to read, while it reads; null otherwise.
  const [blocksLeft, setBlocksLeft] = useState(null);
  // Whether `ChargesScreen`, every charge of the account, is open over the tab.
  const [listing, setListing] = useState(false);
  // Whether the card's charge is open as a QR code across the screen.
  const [showingQr, setShowingQr] = useState(false);

  // Read again after a charge is kept, and by `checkCharges`. Without both an account and an
  // accepted network there is nothing to list. It never throws: a failed read empties the list,
  // so another account's charges are not left under this one, and says why in a notice that
  // stays until a read works.
  const loadCharges = useCallback(async () => {
    if (!network || !payee) {
      setCharges([]);
      return;
    }
    try {
      setCharges(await listCharges(db, payee, network));
      dismiss('charges-list-failure');
    } catch (error) {
      setCharges([]);
      const fields = { title: 'Charges not read', body: error.message, expiresAfter: undefined };
      show(failureNotice('charges-list-failure', fields, error));
    }
  }, [db, network, payee, show, dismiss]);

  // Reads the account's `Payment` logs, which marks its charges paid, then reads the list again:
  // when the tab opens, when the account or the network changes, and once the history question
  // is answered. The list is read first too, so the charges show while a long reading runs. It
  // never throws: a failed reading leaves the charges as kept and says why in a notice that stays
  // until a reading works.
  const checkCharges = useCallback(async () => {
    if (network && payee) {
      try {
        await loadCharges();
        await readHistory(db, network, payee, (nextBlock, lastBlock) =>
          setBlocksLeft(lastBlock - nextBlock + 1n),
        );
        dismiss('charges-check-failure');
      } catch (error) {
        const fields = {
          kind: 'attention',
          title: 'Charges not checked',
          body: error.shortMessage ?? error.message,
          expiresAfter: undefined,
        };
        show(failureNotice('charges-check-failure', fields, error));
      } finally {
        setBlocksLeft(null);
      }
    }
    await loadCharges();
  }, [db, network, payee, loadCharges, show, dismiss]);

  useEffect(() => {
    checkCharges();
  }, [checkCharges]);

  // A charge paid while the tab is open puts up a notice; the list is read again so it says paid
  // too.
  useEffect(() => {
    loadCharges();
  }, [paidCharges, loadCharges]);

  // `createCharge` draws the salt and keeps the charge before it comes back. The keyboard goes
  // down so the card it would cover shows.
  async function generate() {
    Keyboard.dismiss();
    dismiss('charge-save-failure');
    try {
      setCharge(await createCharge(db, network, payee, wei, Date.now()));
    } catch (error) {
      const notice = { title: 'Charge not saved', body: 'Nothing was made for the payer' };
      show(failureNotice('charge-save-failure', notice, error));
    }
    await loadCharges();
  }

  // Puts a charge, new or picked from either list, in the card with its text.
  function showCharge(fields) {
    setCharge({ ...fields, text: encodeCharge(fields, network) });
  }

  // Android's back button closes the list open over the tab; with nothing open
  // it is left to Android, which leaves the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!listing) return false;
      setListing(false);
      return true;
    });
    return () => subscription.remove();
  }, [listing]);

  const wei = weiOf(eth.trim());
  // The contract refuses a payment of nothing with `ZeroAmount()`, so no charge asks for one. The
  // charge carries the network's chain id and contract, so none is made before `checkNode` has
  // accepted the network.
  const incomplete = !network || !payee || wei === null || wei === 0n;
  // The card's charge as the list has it now, so the card says paid as soon as the list does.
  const paid = charges.find((stored) => stored.orderId === charge?.orderId)?.paidHash;
  const account = accounts.find((each) => each.address === payee);

  // The tab, and the list over it; the tab stays mounted under it, as it was. A
  // charge picked in the list goes to the tab's card, and the list closes on it.
  return (
    <>
      <Layer hidden={listing}>
        <Page
          header={
            <Header>
              <AccountChip account={account} onPress={onOpenAccounts} />
            </Header>
          }
        >
          {blocksLeft !== null && blocksLeft > 0n && (
            <Text style={ui.hint}>Reading the history: {String(blocksLeft)} blocks left.</Text>
          )}

          <Text style={styles.title}>New charge</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Amount to receive</Text>
            <View style={styles.valueRow}>
              <View style={styles.box}>
                <TextInput
                  style={styles.input}
                  value={eth}
                  onChangeText={setEth}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.text3}
                  accessibilityLabel="Amount to receive, in ETH"
                />
                <Text style={styles.unit}>ETH</Text>
              </View>
              <Pressable
                style={[styles.generate, incomplete && styles.generateOff]}
                onPress={generate}
                disabled={incomplete}
              >
                <Text style={[styles.generateText, incomplete && styles.generateTextOff]}>
                  Generate
                </Text>
              </Pressable>
            </View>
            {wei !== null && <Text style={styles.wei}>= {groupDigits(wei)} wei</Text>}
          </View>

          {charge && (
            <View style={styles.card}>
              <View style={styles.chargeChip}>
                <StatusChip {...chargeChip(paid)} />
              </View>
              <Detail name="Amount" value={`${formatEth(charge.valueWei)} ETH`} large />
              <Detail name="Order id" value={shortAddress(charge.orderId)} />
              <Detail name="Network" value={network.chain.name} plain />
              {/* All 256 characters are copied and shared; two lines say which code it is. */}
              <Detail name="Code" value={charge.text} code />
              <View style={styles.actions}>
                <Action d={QR_ICON} label="QR code" onPress={() => setShowingQr(true)} />
                <Action
                  d={COPY_ICON}
                  label="Copy code"
                  onPress={() => Clipboard.setStringAsync(charge.text)}
                />
                <Action
                  d={SHARE_ICON}
                  label="Share"
                  onPress={() => Share.share({ message: charge.text })}
                />
              </View>
              <ChargeQr
                text={charge.text}
                visible={showingQr}
                onClose={() => setShowingQr(false)}
              />
            </View>
          )}

          {charges.length > 0 && (
            <View style={styles.list}>
              <View style={styles.top}>
                <Text style={styles.heading}>Latest charges</Text>
                <Pressable style={styles.seeAll} onPress={() => setListing(true)} hitSlop={6}>
                  <Text style={styles.seeAllText}>See all</Text>
                </Pressable>
              </View>
              {charges.slice(0, RECENT).map((stored) => (
                <Pressable
                  key={stored.orderId}
                  style={styles.row}
                  onPress={() => showCharge(stored)}
                >
                  <View style={styles.tile}>
                    <Icon d={RECEIVED_ICON} color={colors.text2} size={16} />
                  </View>
                  <View style={styles.middle}>
                    <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
                      +{formatEth(stored.valueWei)} ETH
                    </Text>
                    {/* Only when it was made: where it stands is the chip's. */}
                    <Text style={styles.meta} numberOfLines={1}>
                      created {formatWhen(stored.createdAt)}
                    </Text>
                  </View>
                  <StatusChip {...chargeChip(stored.paidHash)} />
                </Pressable>
              ))}
            </View>
          )}
        </Page>
      </Layer>
      {listing && (
        <ChargesScreen
          account={account}
          network={network}
          charges={charges}
          onBack={() => setListing(false)}
          onOpen={(picked) => {
            showCharge(picked);
            setListing(false);
          }}
        />
      )}
    </>
  );
}

/// One value of the charge under its name: the amount larger, on one line that shrinks when it is
/// wider than the card; the network in the UI font; and the code, the charge as one text
///, smaller and cut after two lines.
function Detail({ name, value, large, plain, code }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailName}>{name}</Text>
      <Text
        style={[
          styles.detailValue,
          large && styles.detailLarge,
          plain && styles.detailPlain,
          code && styles.detailCode,
        ]}
        numberOfLines={code ? 2 : large ? 1 : undefined}
        adjustsFontSizeToFit={large}
      >
        {value}
      </Text>
    </View>
  );
}

/// An action of the card as its icon alone; `label` is what a screen reader says.
function Action({ d, label, onPress }) {
  return (
    <Pressable style={styles.action} onPress={onPress} accessibilityLabel={label}>
      <Icon d={d} color={colors.text} size={20} />
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
  field: { marginTop: space.gap, gap: 6 },
  label: { color: colors.text2, fontFamily: fonts.ui, fontSize: 13 },
  valueRow: { flexDirection: 'row', gap: 8 },
  box: {
    flex: 1,
    minWidth: 0,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  input: { flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.mono, fontSize: 20 },
  unit: { color: colors.text2, fontFamily: fonts.ui, fontSize: 14 },
  generate: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: radius.field,
    backgroundColor: colors.accent,
  },
  // Off as the pay button is off: the line color behind the third text color.
  generateOff: { backgroundColor: colors.line },
  generateText: { color: colors.onAccent, fontFamily: fonts.ui, fontSize: 15, fontWeight: '600' },
  generateTextOff: { color: colors.text3 },
  wei: { color: colors.text3, fontFamily: fonts.mono, fontSize: 11.5 },
  card: {
    marginTop: space.gap,
    gap: 10,
    padding: space.cardPad,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chargeChip: { alignSelf: 'flex-start' },
  detail: { gap: 2 },
  detailName: { color: colors.text3, fontFamily: fonts.ui, fontSize: 11.5 },
  detailValue: { color: colors.text, fontFamily: fonts.mono, fontSize: 12.5 },
  detailLarge: { fontSize: 15 },
  detailPlain: { fontFamily: fonts.ui },
  detailCode: { fontSize: 11, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 10 },
  action: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  list: { marginTop: space.gap, gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { color: colors.text2, fontFamily: fonts.ui, fontSize: 13, fontWeight: '500' },
  // As "Ver todos" on the pay tab: 32 tall, 44 to the touch with its slop.
  seeAll: { minHeight: 32, justifyContent: 'center' },
  seeAllText: { color: colors.accent, fontFamily: fonts.ui, fontSize: 13 },
  // As the pay tab's list: the divider of the boards, #16181C, is nearest to `surface`.
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
  middle: { flex: 1, minWidth: 0, gap: 2 },
  amount: { color: colors.text, fontFamily: fonts.mono, fontSize: 13 },
  meta: { color: colors.text3, fontFamily: fonts.ui, fontSize: 12 },
});
