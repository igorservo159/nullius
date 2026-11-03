// The network tab, as `Rede.dc.html` draws it: which chain and contract the app pays on, and
// which nodes it asks. The fields are saved together, checked as one network, or not at all.

import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  chainById,
  defaultNetwork,
  l1ChainOf,
  NetworkRefused,
  readKeptFields,
  resetNetwork,
  saveNetwork,
} from '@nullius/core/network';
import { useAdapters } from '../adapters';
import appConfig from '../../app.json';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { useNotices } from '../components/notices';
import { colors, fonts, radius, space } from '../theme/theme';
import { Page, PrimaryButton, useFieldPosition } from '../components/ui';

const CHECK = 'M5 12.5l4.5 4.5L19 7';
const ALERT = 'M12 7v6M12 17h.01M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18';

// The chains the app knows, as their cards name them. Linea is the default; the test network's
// card shows only to whoever asks for it, or while it is the one in use.
const LINEA = 59144;
const chainChoices = [
  { id: 59141, label: 'Linea Sepolia', kind: 'test' },
  { id: 59144, label: 'Linea', kind: 'real' },
];

// For each check that refused a network, the field it is about and the sentence below that field,
// as the board puts a refusal under its own field.
const refusals = {
  notHttps: ['l2', 'The address must start with https://'],
  otherChain: ['l2', 'This node serves another chain'],
  l1NotHttps: ['l1', 'The address must start with https://'],
  otherL1Chain: ['l1', 'This node does not serve this chain\'s L1'],
  notAddress: ['contract', 'Not an address'],
  noContract: ['contract', 'No contract at this address on this chain'],
  notPayments: ['contract', 'This address does not hold the Payments contract'],
  notBlockNumber: ['deploy', 'Must be a number'],
  notDeployedAt: ['deploy', 'The contract does not exist at this block'],
  deployedBefore: ['deploy', 'The contract already existed before this block'],
  noOldState: ['deploy', 'The node keeps no old blocks: the block could not be checked'],
};

export function NetworkScreen({ network, networkFailure, onNetworkChanged }) {
  const { secretStore } = useAdapters();
  const { show, dismiss } = useNotices();
  // The network as the fields hold it, filled from what the phone keeps; `chainId` is null
  // until that is read.
  const [chainId, setChainId] = useState(null);
  const [contract, setContract] = useState('');
  const [deployBlock, setDeployBlock] = useState('');
  const [url, setUrl] = useState('');
  const [l1Url, setL1Url] = useState('');
  const [busy, setBusy] = useState(false);
  // The field a check refused and its sentence, `{ field, sentence }`; null while none did.
  const [refusal, setRefusal] = useState(null);
  // True once a field is changed after the fields were filled: the checks below them then speak
  // of the network in use, not of what is typed.
  const [edited, setEdited] = useState(false);
  // Whether the chain cards show: asked for under the footer, or forced by a test network in use.
  const [testing, setTesting] = useState(false);

  // Read from the store, not from `network`: a kept network that `checkNode` refused at opening
  // leaves `network` null, and the fields must still show what is kept.
  async function fillFromStore() {
    try {
      const kept = await readKeptFields(secretStore);
      setChainId(kept.chainId);
      setContract(kept.paymentsAddress);
      setDeployBlock(kept.deployBlock);
      setUrl(kept.rpcUrl);
      setL1Url(kept.l1RpcUrl);
      setEdited(false);
      dismiss('network-read-failure');
    } catch (error) {
      show({
        id: 'network-read-failure',
        kind: 'error',
        tab: 'network',
        where: ['network'],
        title: 'Saved network not read',
        body: error.message,
        detail: error.message,
      });
    }
  }

  useEffect(() => {
    fillFromStore();
  }, [secretStore]);

  // Choosing a chain fills its Payments, where it is published, and its public nodes: a contract
  // of another chain would only be refused.
  function chooseChain(id) {
    const chosen = defaultNetwork(id);
    edit(setChainId)(id);
    setContract(chosen.paymentsAddress);
    setDeployBlock(String(chosen.deployBlock));
    setUrl('');
    setL1Url('');
  }

  // Every field changes through here, which takes down the refusal of the last check.
  function edit(setField) {
    return (value) => {
      setField(value);
      setEdited(true);
      setRefusal(null);
    };
  }

  // Saving and going back to the default both end the same way: the network accepted is in use, and
  // the fields show what is kept now, the chain's public node in place of an empty one. A refusal
  // goes under its field; anything else, a node that did not answer, is a notice.
  async function change(apply) {
    setBusy(true);
    setRefusal(null);
    dismiss('network-save-failure');
    try {
      onNetworkChanged(await apply());
      await fillFromStore();
    } catch (error) {
      if (error instanceof NetworkRefused) {
        const [field, sentence] = refusals[error.reason];
        setRefusal({ field, sentence });
      } else {
        show({
          id: 'network-save-failure',
          kind: 'error',
          tab: 'network',
          where: ['network'],
          title: 'Network not checked',
          body: 'Nothing was saved',
          detail: error.shortMessage ?? error.message,
          expiresAfter: 6000,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  function save() {
    return change(() =>
      saveNetwork(secretStore, {
        chainId,
        paymentsAddress: contract,
        deployBlock,
        rpcUrl: url,
        l1RpcUrl: l1Url,
      }),
    );
  }

  // What is below a node's field when nothing was refused: the network in use passed its checks
  // when it was put in use, so while the fields are what it was filled from, they say so.
  const inUse = network && !edited && network.chain.id === chainId;
  const refusedHere = (field) => (refusal?.field === field ? refusal.sentence : null);

  return (
    <Page
      header={
        <Header>
          <Text style={styles.version}>
            v{appConfig.expo.version} · {Platform.OS === 'ios' ? 'iOS' : 'Android'}
          </Text>
        </Header>
      }
    >
      <Text style={styles.title}>Network</Text>

      {(testing || (chainId !== null && chainId !== LINEA)) && (
        <View style={styles.chains}>
          {chainChoices.map((choice) => {
            const on = chainId === choice.id;
            return (
              <Pressable
                key={choice.id}
                style={[styles.chain, on && styles.chainOn]}
                onPress={() => chooseChain(choice.id)}
                accessibilityState={{ selected: on }}
              >
                <Text style={styles.chainName}>{choice.label}</Text>
                <Text style={styles.chainId} numberOfLines={1} adjustsFontSizeToFit>
                  chain {choice.id} · {choice.kind}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <NetworkField
        label="Payments contract"
        value={contract}
        onChange={edit(setContract)}
        refused={refusedHere('contract')}
      />
      {/* Not on the board, which only writes the block: a contract published elsewhere needs its
          own, and the check that the contract was published in it. */}
      <NetworkField
        label="Deploy block"
        value={deployBlock}
        onChange={edit(setDeployBlock)}
        keyboardType="numeric"
        refused={refusedHere('deploy')}
      />
      <NetworkField
        label="Linea RPC node"
        value={url}
        onChange={edit(setUrl)}
        placeholder={chainId === null ? '' : chainById(chainId).rpcUrls.default.http[0]}
        keyboardType="url"
        refused={refusedHere('l2')}
        passed={inUse && `chain ${network.chain.id} · contract found`}
        waiting={!network && !networkFailure && 'checking the node…'}
      />
      <NetworkField
        label="Ethereum RPC node"
        value={l1Url}
        onChange={edit(setL1Url)}
        placeholder={
          chainId === null ? '' : l1ChainOf(chainById(chainId)).rpcUrls.default.http[0]
        }
        keyboardType="url"
        refused={refusedHere('l1')}
        passed={inUse && `chain ${network.l1Chain.id}`}
      />

      <View style={styles.actions}>
        <Pressable
          style={[styles.restore, busy && styles.restoreOff]}
          onPress={() => change(() => resetNetwork(secretStore))}
          disabled={busy}
        >
          <Text style={styles.restoreText}>Restore default</Text>
        </Pressable>
        <View style={styles.saveSlot}>
          <PrimaryButton
            label={busy ? 'Checking…' : 'Check and save'}
            onPress={save}
            disabled={busy || chainId === null}
          />
        </View>
      </View>

      <Text style={styles.footer}>
        No server: the app talks only to these nodes, straight from your phone. Left empty, each
        node is its chain's public one.
      </Text>

      {!testing && chainId === LINEA && (
        <Pressable onPress={() => setTesting(true)}>
          <Text style={styles.testLink}>Use the test network</Text>
        </Pressable>
      )}
    </Page>
  );
}

/// A label, the input, and below it what the last check said of this field: refused in red, the
/// box red too; passed in green; or still being checked. A value wider than the box shows its
/// start while the field is not being typed in: Android would leave it scrolled to its end, and
/// an address or a node is read from its start.
function NetworkField({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  refused,
  passed,
  waiting,
}) {
  const { onLayout, onFocus } = useFieldPosition(label);
  const [typing, setTyping] = useState(false);
  return (
    <View style={styles.field} onLayout={onLayout}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, refused && styles.inputRefused]}
        value={value}
        onChangeText={onChange}
        onFocus={() => {
          setTyping(true);
          onFocus();
        }}
        onBlur={() => setTyping(false)}
        selection={typing ? undefined : { start: 0 }}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
      />
      {refused ? (
        <View style={styles.result}>
          <Icon d={ALERT} color={colors.danger} size={14} strokeWidth={2} />
          <Text style={[styles.resultText, { color: colors.danger }]}>{refused}</Text>
        </View>
      ) : passed ? (
        <View style={styles.result}>
          <Icon d={CHECK} color={colors.accent} size={14} strokeWidth={2.25} />
          <Text style={[styles.resultText, { color: colors.accent }]}>{passed}</Text>
        </View>
      ) : (
        waiting && <Text style={styles.waiting}>{waiting}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  version: { color: colors.text3, fontFamily: fonts.mono, fontSize: 12 },
  // -0.03em of 28.
  title: {
    marginTop: space.gap,
    color: colors.text,
    fontFamily: fonts.ui,
    fontSize: 28,
    fontWeight: '500',
    letterSpacing: -0.84,
  },
  chains: { marginTop: space.gap, flexDirection: 'row', gap: 8 },
  chain: {
    flex: 1,
    height: 60,
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 14,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chainOn: { borderColor: colors.accent },
  chainName: { color: colors.text, fontFamily: fonts.ui, fontSize: 14, fontWeight: '500' },
  chainId: { color: colors.text2, fontFamily: fonts.mono, fontSize: 11.5 },
  field: { marginTop: space.gap, gap: 6 },
  label: { color: colors.text2, fontFamily: fonts.ui, fontSize: 13 },
  input: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 12.5,
  },
  inputRefused: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  result: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultText: { flex: 1, fontFamily: fonts.ui, fontSize: 12 },
  waiting: { color: colors.text3, fontFamily: fonts.ui, fontSize: 12 },
  actions: { marginTop: space.gap, flexDirection: 'row', gap: 8 },
  restore: {
    flex: 1,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
  },
  restoreOff: { opacity: 0.5 },
  restoreText: { color: colors.text, fontFamily: fonts.ui, fontSize: 14, fontWeight: '500' },
  saveSlot: { flex: 1 },
  footer: {
    marginTop: space.gap,
    color: colors.text3,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 17.4,
  },
  // Below the footer and in its color, so it reads as small print: the test network is for
  // whoever came looking for it.
  testLink: {
    marginTop: 12,
    color: colors.text3,
    fontFamily: fonts.ui,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
