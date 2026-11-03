// One notice as `Avisos.dc.html` draws it, 60 tall, the band under the header that shows the one
// notice that matters most on the open tab, and the popup a notice with a detail opens.

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { useNotices } from './notices';
import { tabIcons } from './TabBar';
import { colors, fonts, noticeColors, radius, space } from '../theme/theme';

const CLOSE = 'M6 6l12 12M18 6L6 18';

// The order the boards rank the kinds in: an error first, a passing success last.
const priority = ['error', 'action', 'question', 'attention', 'success'];

/// The notice of highest priority among those shown on the open tab; between two of the same
/// kind, the one put up last. Nothing while there is none.
///
/// A notice with a `detail` opens it on a tap. While it is open the notice's time
/// is held, so it cannot go away under the popup; closing the popup shows the notice again, which
/// starts its time over.
export function NoticeBar() {
  const { notices, tab, show, dismiss, hold } = useNotices();
  const [detailOpen, setDetailOpen] = useState(false);
  const [shown] = notices
    .filter((notice) => !notice.where || notice.where.includes(tab))
    .reverse()
    .sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind));
  if (!shown) return null;

  function openDetail() {
    hold(shown.id);
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
    show(shown);
  }

  return (
    <>
      <Notice
        {...shown}
        onPress={shown.detail ? openDetail : undefined}
        onClose={() => dismiss(shown.id)}
      />
      {shown.detail && (
        <NoticeDetail
          visible={detailOpen}
          title={shown.title}
          detail={shown.detail}
          onClose={closeDetail}
        />
      )}
    </>
  );
}

/// The icon of the tab the notice is about, so the user knows where to go. The only taps are the
/// ×, and `onPress` when the notice has a detail to open.
export function Notice({ kind, tab, title, body, onPress, onClose }) {
  const tone = noticeColors[kind];
  return (
    <Pressable
      style={[styles.notice, { backgroundColor: tone.bg, borderColor: tone.border }]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityHint={onPress ? 'Tap to see the detail' : undefined}
    >
      <View style={[styles.circle, { backgroundColor: tone.circle, borderColor: tone.ring }]}>
        <Icon d={tabIcons[tab]} color={tone.icon} size={16} strokeWidth={2} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.body} numberOfLines={1}>
          {body}
        </Text>
      </View>
      {/* 24 drawn, 44 to the touch with the slop around it. */}
      <Pressable
        style={styles.close}
        onPress={onClose}
        hitSlop={10}
        accessibilityLabel="Close notice"
      >
        <Icon d={CLOSE} color={colors.text3} size={14} />
      </Pressable>
    </Pressable>
  );
}

/// The detail of a notice over the whole screen. A tap outside the card closes it, and so does
/// Android's back button, which a `Modal` hands to `onRequestClose`.
function NoticeDetail({ visible, title, detail, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Claims the touches on the card, so selecting the detail does not close it. */}
        <View style={styles.card} onStartShouldSetResponder={() => true}>
          <Text style={styles.cardTitle}>{title}</Text>
          <ScrollView>
            <Text style={styles.detail} selectable>
              {detail}
            </Text>
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  notice: {
    marginTop: space.gap,
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 12,
    paddingRight: 8,
    borderRadius: radius.field,
    borderWidth: 1,
  },
  circle: {
    width: 28,
    height: 28,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `minWidth: 0` lets the text narrow below its length, which is what lets it end in "…".
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: colors.text, fontFamily: fonts.ui, fontSize: 13, fontWeight: '500' },
  body: { color: colors.text2, fontFamily: fonts.ui, fontSize: 12 },
  close: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: space.screenX,
    backgroundColor: colors.backdrop,
  },
  card: {
    maxHeight: '70%',
    gap: 12,
    padding: space.cardPad,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTitle: { color: colors.text, fontFamily: fonts.ui, fontSize: 15, fontWeight: '500' },
  detail: { color: colors.text2, fontFamily: fonts.mono, fontSize: 12, lineHeight: 18 },
});
