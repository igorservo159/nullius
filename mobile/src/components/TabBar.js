// The five tabs at the bottom of the app, as the `<nav>` of the design boards draws them.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { colors, fonts } from '../theme/theme';

// Each tab's icon path from the boards, by the value `App.js` keeps in `tab`. A notice draws the
// icon of the tab it is about, so these are shared.
export const tabIcons = {
  pay: 'M7 17L17 7M9 7h8v8',
  receive: 'M17 7L7 17M15 17H7V9',
  bridge: 'M3 18h18M4 18c0-5 3.6-9 8-9s8 4 8 9M12 9v9',
  accounts: 'M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4zM4 7V6a2 2 0 0 1 2-2h10M16 13h1',
  network:
    'M10 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M3 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 7v4M12 11l-6 6M12 11l6 6',
};

const tabs = [
  { id: 'pay', label: 'Pay' },
  { id: 'receive', label: 'Receive' },
  { id: 'bridge', label: 'Bridge' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'network', label: 'Network' },
];

/// The bar is 76 tall on the boards, 16 of them below the labels. On the phone those 16 are the
/// gesture area when it fits in them, and grow to it when it does not.
export function TabBar({ tab, onChange }) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 16);
  return (
    <View style={[styles.bar, { height: 60 + bottom, paddingBottom: bottom }]}>
      {tabs.map(({ id, label }) => {
        const color = id === tab ? colors.accent : colors.text3;
        return (
          <Pressable key={id} style={styles.tab} onPress={() => onChange(id)}>
            <Icon d={tabIcons[id]} color={color} size={22} />
            {/* At the phone's larger font scale a word could run past its fifth of the
                width; it shrinks to fit instead. */}
            <Text style={[styles.label, { color }]} numberOfLines={1} adjustsFontSizeToFit>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: 6,
    paddingHorizontal: 8,
    backgroundColor: colors.tabBar,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  tab: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: { fontFamily: fonts.ui, fontSize: 11, fontWeight: '500' },
});
