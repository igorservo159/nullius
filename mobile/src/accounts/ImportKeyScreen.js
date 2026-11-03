// Importing an account's private key, over the accounts tab. No board draws it: it
// is laid out as Type charge is, a name and a key, and the button that keeps them behind a
// fingerprint.

import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { addAccount, BiometricRefused, maxAccounts } from '@nullius/core/accounts';
import { useAdapters } from '../adapters';
import { FINGERPRINT_ICON, Icon } from '../components/Icon';
import { BackHeader } from '../components/ListScreen';
import { useNotices } from '../components/notices';
import { colors, fonts, radius, space } from '../theme/theme';
import { Page, PrimaryButton, useFieldPosition } from '../components/ui';

const PASTE =
  'M9 4h6v3H9zM9 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-3';
const EYE = 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0';
const EYE_OFF = `${EYE}M4 4l16 16`;

// What a refusal of `addAccount` says, as its notice's fields: picked by the error's code or its
// technical message; anything not recognized keeps its own words. A key write that fails puts the
// previous index back, so a refused prompt leaves no account behind.
function importFailure(error) {
  if (error instanceof BiometricRefused) {
    return { title: 'Fingerprint not confirmed', body: 'The account was not saved' };
  }
  if (/private key/.test(error.message)) {
    return { title: 'Invalid private key', body: '64 hexadecimal digits, with or without 0x' };
  }
  if (/limit/.test(error.message)) {
    return { title: `Limit of ${maxAccounts} accounts`, body: 'Delete one to add another' };
  }
  return { title: 'Account not saved', body: error.message };
}

/// `onImported` runs once the key is kept; `nextLabel` is the name an account gets when none is
/// typed.
export function ImportKeyScreen({ nextLabel, onBack, onImported }) {
  const { secretStore, canStoreKeys } = useAdapters();
  const { show, dismiss } = useNotices();
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  // The key is typed hidden, as a password is; the eye shows it.
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);

  async function save() {
    dismiss('import-failure');
    const failure = { id: 'import-failure', kind: 'error', tab: 'accounts', where: ['accounts'] };
    // Checked before anything is written: without a strong biometric the key write fails, and
    // by then the index already lists the account.
    if (!canStoreKeys()) {
      show({
        ...failure,
        title: 'No biometrics enrolled',
        body: 'Enroll a fingerprint or face in Android',
        detail:
          'Enroll a fingerprint or face in Android\'s settings: the key is only saved with ' +
          'biometric confirmation.',
      });
      return;
    }
    // Pasted keys often carry spaces or come without 0x (MetaMask exports 64 bare digits).
    const pasted = key.trim();
    const privateKey = pasted.startsWith('0x') ? pasted : `0x${pasted}`;

    setBusy(true);
    try {
      // The address is not typed: `addAccount` derives it from the key, which is the only way
      // the two cannot disagree.
      await addAccount(secretStore, label.trim() || nextLabel, privateKey);
      onImported();
    } catch (error) {
      show({ ...failure, ...importFailure(error), expiresAfter: 6000, detail: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page header={<BackHeader label="Accounts" onBack={onBack} />}>
      <View style={styles.intro}>
        <Text style={styles.title}>Import key</Text>
        <Text style={styles.subtitle}>
          The address is not typed: it is derived from the key. The key stays in this phone's
          keystore and never comes back to the screen.
        </Text>
      </View>

      <KeyInput label="Name" value={label} onChange={setLabel} placeholder={nextLabel} plain />
      <KeyInput
        label="Private key"
        value={key}
        onChange={setKey}
        placeholder="0x…"
        secure={hidden}
      >
        <Pressable
          style={styles.icon}
          onPress={() => setHidden(!hidden)}
          accessibilityLabel={hidden ? 'Show the key' : 'Hide the key'}
        >
          <Icon d={hidden ? EYE : EYE_OFF} color={colors.text2} size={18} />
        </Pressable>
        <Pressable
          style={styles.icon}
          onPress={async () => setKey((await Clipboard.getStringAsync()).trim())}
          accessibilityLabel="Paste key"
        >
          <Icon d={PASTE} color={colors.text2} size={18} />
        </Pressable>
      </KeyInput>

      <View style={styles.confirm}>
        <PrimaryButton
          d={FINGERPRINT_ICON}
          label={busy ? 'Saving…' : 'Save account'}
          onPress={save}
          disabled={busy || !key.trim()}
        />
      </View>
    </Page>
  );
}

/// A label, the box with the input and the field's buttons at its right end, as Type charge's
/// fields.
/// Placed directly in the `Page`, so the page can scroll it above the keyboard.
function KeyInput({ label, value, onChange, placeholder, plain, secure, children }) {
  const { onLayout, onFocus } = useFieldPosition(label);
  return (
    <View style={styles.field} onLayout={onLayout}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.box}>
        <TextInput
          style={[styles.input, plain && styles.inputPlain]}
          value={value}
          onChangeText={onChange}
          onFocus={onFocus}
          placeholder={placeholder}
          placeholderTextColor={colors.text3}
          secureTextEntry={secure}
          autoCapitalize={plain ? 'sentences' : 'none'}
          autoCorrect={false}
          spellCheck={false}
        />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: space.gap, gap: 4 },
  // -0.02em of 24, as Type charge's title.
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
  // As in Type charge: `minWidth: 0` keeps a 66-character key scrolling inside the box.
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 12.5,
  },
  inputPlain: { fontFamily: fonts.ui, fontSize: 15 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirm: { marginTop: space.gap },
});
