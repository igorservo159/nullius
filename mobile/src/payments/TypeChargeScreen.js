// The charge typed by hand, as `Digitar.dc.html` draws it: the four fields of a charge, and the
// order id checked against the other three before the pay tab takes them.

import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { orderId as deriveOrderId } from '@nullius/core/charges';
import { isAddress, isHex } from 'viem';
import { groupDigits, shortAddress, weiOf } from '../theme/format';
import { Icon } from '../components/Icon';
import { BackHeader } from '../components/ListScreen';
import { colors, fonts, space } from '../theme/theme';
import { Page, PrimaryButton, useFieldPosition } from '../components/ui';

const PASTE =
  'M9 4h6v3H9zM9 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-3';
const CHECK = 'M5 12.5l4.5 4.5L19 7';
const CROSS = 'M6 6l12 12M18 6L6 18';

// A salt and an order id are both 32 bytes: `0x` and 64 hex digits. viem hashes a shorter or
// non-hex salt without complaining, so the length is checked here.
function isBytes32(text) {
  return isHex(text) && text.length === 66;
}

/// `onConfirm` gets `{ payee, valueWei, salt, orderId }` once the order id is the hash of the
/// other three; until then the button stays off, since the contract would revert the call with
/// `OrderIdMismatch` and the payer would pay the fee for nothing.
export function TypeChargeScreen({ network, onBack, onConfirm }) {
  const [payee, setPayee] = useState('');
  const [eth, setEth] = useState('');
  const [salt, setSalt] = useState('');
  const [orderId, setOrderId] = useState('');

  const wei = weiOf(eth.trim());
  const complete =
    isAddress(payee) && wei !== null && wei > 0n && isBytes32(salt) && isBytes32(orderId);
  // `keccak256` writes lowercase hex; the typed order id may come in either case.
  const derived = complete ? deriveOrderId(payee, wei, salt) : null;
  const matches = derived !== null && derived === orderId.toLowerCase();

  async function paste(setField) {
    setField((await Clipboard.getStringAsync()).trim());
  }

  return (
    <Page header={<BackHeader label="Pay" aside={network?.chain.name} onBack={onBack} />}>

      <View style={styles.intro}>
        <Text style={styles.title}>Type charge</Text>
        <Text style={styles.subtitle}>
          Payee, Amount and Salt must match the Order id. Every field is required.
        </Text>
      </View>

      <ChargeInput label="Payee" value={payee} onChange={setPayee}>
        <PasteIcon label="Paste payee" onPress={() => paste(setPayee)} />
      </ChargeInput>

      <ChargeInput
        label="Amount"
        value={eth}
        onChange={setEth}
        keyboardType="decimal-pad"
        large
        below={wei !== null && <Text style={styles.wei}>= {groupDigits(wei)} wei</Text>}
      >
        <Text style={styles.unit}>ETH</Text>
      </ChargeInput>

      <ChargeInput label="Salt" value={salt} onChange={setSalt}>
        <Pressable style={styles.pasteText} onPress={() => paste(setSalt)}>
          <Text style={styles.pasteTextLabel}>Paste</Text>
        </Pressable>
      </ChargeInput>

      <ChargeInput
        label="Order id"
        value={orderId}
        onChange={setOrderId}
        below={
          !complete ? (
            <Text style={styles.hint}>0x and 64 more characters, as the payee showed it</Text>
          ) : matches ? (
            <Feedback d={CHECK} color={colors.accent}>
              It matches: this salt with the payee and the amount makes the typed order id.
            </Feedback>
          ) : (
            <Feedback d={CROSS} color={colors.danger}>
              It does not match: this salt with the payee and the amount makes{' '}
              {shortAddress(derived)}, not the typed order id. Check the fields with the payee.
            </Feedback>
          )
        }
      >
        <PasteIcon label="Paste order id" onPress={() => paste(setOrderId)} />
      </ChargeInput>

      <View style={styles.confirm}>
        <PrimaryButton
          label="Check charge"
          disabled={!matches}
          onPress={() => onConfirm({ payee, valueWei: wei, salt, orderId })}
        />
      </View>
    </Page>
  );
}

/// A label, the box with the input and whatever the field puts at its right end, and the line
/// below the box. Placed directly in the `Page`, so the page can scroll it above the keyboard.
function ChargeInput({ label, value, onChange, keyboardType, large, below, children }) {
  const { onLayout, onFocus } = useFieldPosition(label);
  return (
    <View style={styles.field} onLayout={onLayout}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.box}>
        <TextInput
          style={[styles.input, large && styles.inputLarge]}
          value={value}
          onChangeText={onChange}
          onFocus={onFocus}
          keyboardType={keyboardType}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
        />
        {children}
      </View>
      {below}
    </View>
  );
}

function PasteIcon({ label, onPress }) {
  return (
    <Pressable style={styles.pasteIcon} onPress={onPress} accessibilityLabel={label}>
      <Icon d={PASTE} color={colors.text2} size={18} />
    </Pressable>
  );
}

/// The line below the order id once all four fields are filled: whether they agree.
function Feedback({ d, color, children }) {
  return (
    <View style={styles.feedback}>
      <Icon d={d} color={color} size={14} strokeWidth={2.25} />
      <Text style={[styles.feedbackText, { color }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: space.gap, gap: 4 },
  // -0.02em of 24.
  title: {
    color: colors.text,
    fontFamily: fonts.ui,
    fontSize: 24,
    fontWeight: '500',
    letterSpacing: -0.48,
  },
  subtitle: { color: colors.text2, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 },
  field: { marginTop: space.gap, gap: 6 },
  label: { color: colors.text2, fontFamily: fonts.ui, fontSize: 13 },
  box: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 14,
    paddingRight: 2,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  // `minWidth: 0` lets the input narrow below its text, so a 66-character value scrolls inside
  // the box instead of pushing the paste button out of it.
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 12.5,
  },
  inputLarge: { fontSize: 18 },
  unit: { marginRight: 12, color: colors.text2, fontFamily: fonts.ui, fontSize: 14 },
  pasteIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The boards fill it with #1F2329, which no token names; `line` is the nearest, #1F2228.
  pasteText: {
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.line,
  },
  pasteTextLabel: { color: colors.text, fontFamily: fonts.ui, fontSize: 13, fontWeight: '500' },
  wei: { color: colors.text3, fontFamily: fonts.mono, fontSize: 11.5 },
  hint: { color: colors.text3, fontFamily: fonts.ui, fontSize: 12 },
  feedback: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  feedbackText: { flex: 1, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
  confirm: { marginTop: space.gap },
});
