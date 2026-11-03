// The pieces the screens are built from: the page that handles the keyboard, the layers of
// screens opened over a tab, and the buttons.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from './Icon';
import { colors, fonts, radius, space } from '../theme/theme';

// How a field tells the page where it is and that it is being typed into. It travels as
// context so that adding a field does not mean threading two more props through every screen.
const Scrolling = createContext(null);

/// One screen of a stack: kept mounted while another is on top of it, so going back finds it
/// as it was left, scrolled and filtered. `hidden` takes it out of the layout.
export function Layer({ hidden, children }) {
  return <View style={[styles.layer, hidden && styles.hidden]}>{children}</View>;
}

/// A scrolling page that stays usable with the keyboard open.
///
/// Android draws this app edge to edge: the keyboard covers the page instead of resizing it, so
/// the page grows by the height of the keyboard while it is open. The navigation bar is the tab
/// bar's to keep clear, since the tab bar sits under the page.
export function Page({ header, children }) {
  const [keyboard, setKeyboard] = useState(0);
  const [focused, setFocused] = useState(null);
  const scroller = useRef(null);
  const offsets = useRef({});

  useEffect(() => {
    const opening = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const closing = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const open = Keyboard.addListener(opening, (event) => setKeyboard(event.endCoordinates.height));
    const close = Keyboard.addListener(closing, () => setKeyboard(0));
    return () => {
      open.remove();
      close.remove();
    };
  }, []);

  // Focusing a field and the keyboard finishing its way up are two different moments, and the
  // scroll has to happen on the second: at focus time the page has not grown yet, so a scroll
  // then is clamped to a page that is still short.
  useEffect(() => {
    const y = offsets.current[focused];
    if (keyboard > 0 && y != null) {
      scroller.current?.scrollTo({ y: Math.max(y - 24, 0), animated: true });
    }
  }, [keyboard, focused]);

  const scrolling = {
    remember: (label, y) => {
      offsets.current[label] = y;
    },
    focus: setFocused,
  };

  // The header, with its notice band, stays above the scroll: the page scrolls a field up to the
  // keyboard, and a band scrolled away with it would hide a failure shown while typing.
  return (
    <Scrolling.Provider value={scrolling}>
      {header && <View style={styles.pinned}>{header}</View>}
      <ScrollView
        ref={scroller}
        style={styles.page}
        contentContainerStyle={[
          styles.content,
          header && styles.contentUnderHeader,
          { paddingBottom: keyboard > 0 ? keyboard + 40 : space.gap },
        ]}
        // A tap on a button while the keyboard is open does its own job instead of being spent
        // closing the keyboard. Dragging never dismisses: reading a field while typing into it
        // is the normal thing to do.
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </Scrolling.Provider>
  );
}

/// What an input inside a `Page` hands the page: `onLayout` for the view placed directly in the
/// page, which is where its position is measured, and `onFocus` for the `TextInput` itself. With
/// both, the page brings the input above the keyboard without anyone hardcoding where it sits.
export function useFieldPosition(label) {
  const scrolling = useContext(Scrolling);
  return {
    onLayout: (event) => scrolling?.remember(label, event.nativeEvent.layout.y),
    onFocus: () => scrolling?.focus(label),
  };
}

/// A screen's main action, on the accent: `Digitar.dc.html`'s Conferir cobrança at 52, and
/// `Pagar.dc.html`'s pay button at 56 (`tall`) with its icon `d` before the label.
export function PrimaryButton({ label, onPress, disabled, d, tall }) {
  const color = disabled ? colors.text3 : colors.onAccent;
  return (
    <Pressable
      style={[styles.primary, tall && styles.primaryTall, disabled && styles.primaryOff]}
      onPress={onPress}
      disabled={disabled}
    >
      {d && <Icon d={d} color={color} size={20} />}
      {/* A label carrying an amount keeps every decimal, so a long one shrinks to fit one line
          beside the icon instead of wrapping out of the button. */}
      <Text style={[styles.primaryText, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </Pressable>
  );
}

/// One of the ways a charge comes into the pay tab, its icon above its name: the boards'
/// Scan, Paste and Type, which share a row in equal thirds.
export function ToolButton({ d, label, onPress, disabled }) {
  return (
    <Pressable
      style={[styles.tool, disabled && styles.toolOff]}
      onPress={onPress}
      disabled={disabled}
    >
      <Icon d={d} color={colors.text} size={18} />
      <Text style={styles.toolText}>{label}</Text>
    </Pressable>
  );
}

/// The space between a `Page`'s content and the sides of the screen, for a view that reaches
/// past it to the edges.
export const pageGutter = 24;

export const styles = StyleSheet.create({
  layer: { flex: 1 },
  hidden: { display: 'none' },
  page: { flex: 1, backgroundColor: colors.bg },
  content: { padding: pageGutter, paddingTop: 8 },
  pinned: { paddingHorizontal: pageGutter, paddingTop: 8, backgroundColor: colors.bg },
  contentUnderHeader: { paddingTop: 0 },
  // A line of progress under a tab's header, as the history reading's.
  hint: { marginTop: 6, color: colors.text3, fontFamily: fonts.ui, fontSize: 12 },
  primary: {
    height: 52,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    backgroundColor: colors.accent,
  },
  // The boards dim it to #1F2329, which no token names; `line` is the nearest, #1F2228.
  primaryTall: { height: 56 },
  primaryOff: { backgroundColor: colors.line },
  primaryText: { flexShrink: 1, fontFamily: fonts.ui, fontSize: 16, fontWeight: '600' },
  payAction: { marginTop: space.gap },
  tools: { marginTop: space.gap, flexDirection: 'row', gap: 8 },
  // The boards round these at 12, between the field's 14 and the icon tile's 10.
  tool: {
    flex: 1,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toolOff: { opacity: 0.5 },
  toolText: { color: colors.text, fontFamily: fonts.ui, fontSize: 13, fontWeight: '500' },
});
