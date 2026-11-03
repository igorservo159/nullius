// A charge's code as a QR code across the screen: `qrcode-generator` makes the matrix and
// `react-native-svg` draws it, the same code Copy code copies. The receive tab opens it from
// a button of the charge's card.

import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import qrcode from 'qrcode-generator';
import Svg, { Path } from 'react-native-svg';
import { colors, radius, space } from '../theme/theme';

/**
 * The dark modules of `text`'s QR code as one SVG path, a module being one unit, and how many
 * modules a side has. Level L: a screen is neither smudged nor torn, and the lowest level gives
 * the fewest modules, so the largest ones. Each run of dark modules in a row is one rectangle:
 * fewer shapes, and no seam between two neighbours.
 */
function qrPath(text) {
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  let d = '';
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < count && qr.isDark(row, col)) col++;
      d += `M${start} ${row}h${col - start}v1h${start - col}z`;
    }
  }
  return { d, count };
}

/// `text`'s QR as wide as the screen allows, while `visible`. A tap outside it, or Android's back
/// button, calls `onClose`.
export function ChargeQr({ text, visible, onClose }) {
  const { width } = useWindowDimensions();
  // Made again only for another charge, not on every render of the tab.
  const { d, count } = useMemo(() => qrPath(text), [text]);
  // The screen less its sides and the frame around the QR.
  const size = width - 2 * space.screenX - 2 * styles.frame.padding;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.frame}>
          <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`}>
            <Path d={d} fill={colors.bg} />
          </Svg>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backdrop,
  },
  // 20 around the QR: about the four modules of light a reader needs around the code.
  frame: { padding: 20, borderRadius: radius.card, backgroundColor: colors.qrLight },
});
