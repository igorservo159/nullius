// The design tokens from `nullius-design/DESIGN.md`: every color, radius, spacing and font the
// screens use is named here once, so a screen never writes a hex value of its own.

export const colors = {
  bg: '#0A0B0D',
  tabBar: '#0D0E11',
  // Cards and fields.
  surface: '#14161A',
  surface2: '#1A1D22',
  // Dividers inside a card.
  line: '#1F2228',
  // The border of a secondary button.
  border: '#262A31',
  inputBorder: '#333944',
  text: '#ECEEF0',
  text2: '#9AA1AB',
  text3: '#7D848F',
  // The main action, success and the active tab.
  accent: '#C6F36B',
  onAccent: '#0A0B0D',
  // Pending, or waiting for a proof.
  warn: '#F2B84B',
  // Reverted, or a field's error.
  danger: '#FF8B7E',
  // Behind a refused field, from `Rede.dc.html`: `danger` at a few percent over `bg`.
  dangerBg: '#1A1311',
  // The light side of a QR code, from `Receber.dc.html`; its dark modules are `bg`.
  qrLight: '#F4F5F2',
  // Behind a popup: the background, at 80%, over the screen it covers. Not on the boards.
  backdrop: 'rgba(10, 11, 13, 0.8)',
};

export const radius = { chip: 999, field: 14, card: 18, button: 16, iconTile: 10 };

export const space = { screenX: 20, gap: 16, cardPad: 16 };

// The family names `app.json` gives the embedded files; `fontWeight` picks among 400, 500 and
// 600 for `ui`, and among 400 and 500 for `mono`.
export const fonts = { ui: 'Geist', mono: 'Geist Mono' };

// The chip of each state a transaction can be in: background, text, and the border when it has
// one. The first six are `DESIGN.md`'s; queued, rejected and replaced are not on the boards.
export const stateColors = {
  signed: { bg: colors.surface2, fg: colors.text2 },
  pending: { bg: '#2A2213', fg: colors.warn },
  confirmed: { bg: '#1C2412', fg: colors.accent },
  finalized: { bg: colors.accent, fg: colors.onAccent },
  reverted: { bg: '#2A1715', fg: colors.danger },
  lost: { bg: 'transparent', fg: colors.text2, border: '#4A505A', dashed: true },
  queued: { bg: '#2A2213', fg: colors.warn, border: colors.warn, dashed: true },
  rejected: { bg: 'transparent', fg: colors.danger, border: colors.danger },
  replaced: { bg: '#1F1B2E', fg: '#C2B5FF' },
  // A withdrawal whose proof reached the L1, waiting for the account to claim it: `Ponte.dc.html`.
  claimable: { bg: 'transparent', fg: colors.accent, border: colors.accent },
};

// The five kinds of notice from `Avisos.dc.html`: the band's background and border, and the
// circle around the tab icon, its fill, its ring and the icon's color.
export const noticeColors = {
  success: {
    bg: '#151C0E',
    border: '#2C3A18',
    circle: colors.accent,
    ring: colors.accent,
    icon: colors.onAccent,
  },
  action: {
    bg: colors.surface,
    border: colors.accent,
    circle: 'transparent',
    ring: colors.accent,
    icon: colors.accent,
  },
  question: {
    bg: colors.surface,
    border: colors.inputBorder,
    circle: colors.border,
    ring: colors.border,
    icon: colors.text,
  },
  attention: {
    bg: '#1C170D',
    border: '#4A3A17',
    circle: 'transparent',
    ring: colors.warn,
    icon: colors.warn,
  },
  error: {
    bg: '#1A1311',
    border: '#4A2622',
    circle: colors.danger,
    ring: colors.danger,
    icon: colors.onAccent,
  },
};
