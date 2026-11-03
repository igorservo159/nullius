// The stroke icons of the design: every one is a single path on a 24 by 24 grid with round ends,
// so only the path, the color and now and then the stroke change between them.

import Svg, { Path } from 'react-native-svg';

// The fingerprint on the buttons that sign, on the pay and bridge tabs: the key is read only
// after it.
export const FINGERPRINT_ICON =
  'M7.5 5.5A8 8 0 0 1 20 12v1M4 12a8 8 0 0 1 1.2-4.2M8 12a4 4 0 0 1 8 0v1.5a10 10 0 0 1-1.2 4.8M12 12v2a14 14 0 0 1-1.8 6.8M4.5 16c.3-1 .5-2 .5-3M8.4 20.4A14 14 0 0 0 8 15';

/// The icon whose path is `d`, copied from a `nullius-design/screens/*.dc.html` board. Most
/// boards stroke at 1.75; the checks are drawn heavier, at 2 and 2.25.
export function Icon({ d, color, size = 24, strokeWidth = 1.75 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={d}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
