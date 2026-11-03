// The small rounded label that says where a transaction stands, as the lists of the boards draw
// it: 20 tall, the state's colors from `stateColors`.

import { StyleSheet, Text, View } from 'react-native';
import { fonts, radius, stateColors } from '../theme/theme';

/// `state` is a key of `stateColors`; `label` is the word the user reads.
export function StatusChip({ state, label }) {
  const { bg, fg, border, dashed } = stateColors[state];
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: bg },
        border && { borderWidth: 1, borderColor: border, borderStyle: dashed ? 'dashed' : 'solid' },
      ]}
    >
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 20,
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: radius.chip,
  },
  label: { fontFamily: fonts.ui, fontSize: 11, fontWeight: '500' },
});
