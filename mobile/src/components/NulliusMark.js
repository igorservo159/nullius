// The Nullius mark from `nullius-design/nullius-mark.svg`: an open ring cut by a bar.

import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme/theme';

/// The mark drawn `size` points wide. The design draws it with a 3.5 stroke at 48 and thickens
/// the stroke to 4 at the header's 26, where 3.5 would read too thin; `strokeWidth` is that knob.
export function NulliusMark({ size = 48, strokeWidth = 3.5 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path
        d="M37.12 16.73 A15 15 0 0 1 16.73 37.12 M10.88 31.27 A15 15 0 0 1 31.27 10.88"
        stroke={colors.text}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path d="M9 39 L39 9" stroke={colors.accent} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
