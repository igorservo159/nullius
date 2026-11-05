// The pieces of a screen opened over a tab: the header that goes back, the title,
// and, for the lists of every payment and every charge, the filters and the runs of days.

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatDay } from '../theme/format';
import { Icon } from './Icon';
import { HistoryProgress } from '../history/historyReading';
import { NoticeBar } from './Notice';
import { colors, fonts, radius, space } from '../theme/theme';
import { pageGutter } from './ui';

const BACK = 'M15 5l-7 7 7 7';

/// "‹ `label`", which calls `onBack`, and `aside` on the right when given; below them, as under
/// the tabs' header, the line of the history reading and the band with the notice that matters
/// most on this tab.
export function BackHeader({ label, aside, onBack }) {
  return (
    <>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={onBack}>
          <Icon d={BACK} color={colors.text} size={22} />
          <Text style={styles.backText}>{label}</Text>
        </Pressable>
        {aside !== undefined && <Text style={styles.aside}>{aside}</Text>}
      </View>
      <HistoryProgress />
      <NoticeBar />
    </>
  );
}

/// The screen's name, and `count` on the same baseline at the right when given.
export function ScreenTitle({ title, count }) {
  return (
    <View style={styles.titleRow}>
      <Text style={styles.title}>{title}</Text>
      {count !== undefined && <Text style={styles.count}>{count}</Text>}
    </View>
  );
}

/// One pill for each of `filters`, which are `{ label }`; `chosen` is the label of the one on.
/// Wider than a 384-wide phone, they scroll sideways, from edge to edge of the
/// screen, so the one cut at the edge says there is more.
export function Filters({ filters, chosen, onChoose }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.filterScroll}
      contentContainerStyle={styles.filters}
    >
      {filters.map(({ label }) => {
        const on = label === chosen;
        return (
          <Pressable
            key={label}
            style={[styles.filter, on && styles.filterOn]}
            onPress={() => onChoose(label)}
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.filterText, on && styles.filterTextOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/// `items`, newest first, in runs of the day `at(item)` falls on, each under that day; `row(item)`
/// draws one, with its key. `empty` is said when there is none.
export function DayList({ items, at, row, empty }) {
  if (items.length === 0) return <Text style={styles.empty}>{empty}</Text>;
  const days = [];
  for (const item of items) {
    const day = formatDay(at(item));
    if (days.at(-1)?.day !== day) days.push({ day, items: [] });
    days.at(-1).items.push(item);
  }
  return (
    <View style={styles.days}>
      {days.map((each) => (
        <View key={each.day}>
          <Text style={styles.day}>{each.day}</Text>
          {each.items.map(row)}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 12 },
  backText: { color: colors.text, fontFamily: fonts.ui, fontSize: 15 },
  aside: { color: colors.text2, fontFamily: fonts.ui, fontSize: 13 },
  titleRow: {
    marginTop: space.gap,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  // -0.02em of 24.
  title: {
    color: colors.text,
    fontFamily: fonts.ui,
    fontSize: 24,
    fontWeight: '500',
    letterSpacing: -0.48,
  },
  count: { color: colors.text2, fontFamily: fonts.mono, fontSize: 12.5 },
  filterScroll: { marginTop: space.gap, marginHorizontal: -pageGutter, flexGrow: 0 },
  filters: { gap: 6, paddingHorizontal: pageGutter },
  filter: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderRadius: radius.chip,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterOn: { backgroundColor: colors.text, borderColor: colors.text },
  filterText: { color: colors.text, fontFamily: fonts.ui, fontSize: 12.5, fontWeight: '500' },
  filterTextOn: { color: colors.bg },
  days: { marginTop: 8, gap: 6 },
  // 0.06em of 12.
  day: {
    paddingTop: 8,
    paddingBottom: 4,
    color: colors.text3,
    fontFamily: fonts.ui,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.72,
    textTransform: 'uppercase',
  },
  empty: {
    marginTop: 24,
    textAlign: 'center',
    color: colors.text3,
    fontFamily: fonts.ui,
    fontSize: 13,
  },
});
