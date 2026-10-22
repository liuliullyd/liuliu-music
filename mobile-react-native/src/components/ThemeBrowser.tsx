import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { ThemeChoiceCard } from './ThemeChoiceCard';
import { useApp } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { themeDefaultAccents, useTheme } from '../theme';
import {
  themeFilters,
  themeOptions,
  themesForFilter,
  type ThemeFilter,
} from '../themeCatalog';

export function ThemeBrowser({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const theme = useTheme();
  const layout = useLayout();
  const [filter, setFilter] = useState<ThemeFilter>(() =>
    themeOptions.find(item => item.id === app.state.settings.theme)?.category ?? 'classic');
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // React Native Modal content is rendered outside App's transformed design
  // canvas. Reuse the same continuous canvas scale used by the queue Modal so
  // all browser geometry remains in the shared logical DP coordinate space.
  const q = (value: number) => Math.max(1, Math.round(value * layout.scale));
  const styles = createStyles(q);
  const cardWidth = Math.max(
    1,
    (width - insets.left - insets.right - q(40) - q(12)) / 2,
  );
  return (
    <Modal
      testID="theme-browser-modal"
      visible
      animationType={
        app.state.settings.motion === 'off' || app.state.settings.reducedMotion
          ? 'none'
          : 'fade'
      }
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View
        testID="theme-browser"
        style={[styles.root, { backgroundColor: theme.bg }]}
      >
        <SafeAreaView
          edges={['top', 'left', 'right', 'bottom']}
          style={styles.safe}
        >
          <View style={styles.header}>
            <Pressable
              testID="theme-browser-close"
              accessibilityRole="button"
              accessibilityLabel="返回外观主题"
              onPress={onClose}
              style={styles.back}
            >
              <Text style={[styles.backText, { color: theme.text }]}>‹</Text>
            </Pressable>
            <Text style={[styles.title, { color: theme.text }]}>全部主题</Text>
          </View>
          <View
            testID="theme-browser-filters"
            style={[styles.filters, styles.filterContent]}
          >
            {themeFilters.map(item => (
              <Pressable
                key={item.id}
                testID={`theme-filter-${item.id}`}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: item.id === filter }}
                onPress={() => setFilter(item.id)}
                style={[
                  styles.filter,
                  {
                    backgroundColor:
                      item.id === filter
                        ? theme.selectedSurface
                        : theme.panelSoft,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={[
                    styles.filterText,
                    { color: item.id === filter ? theme.accent : theme.text },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <FlatList
            key={filter}
            testID="theme-browser-grid"
            data={themesForFilter(filter)}
            keyExtractor={item => item.id}
            extraData={app.state.settings.theme}
            numColumns={2}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={3}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.columns}
            renderItem={({ item }) => (
              <ThemeChoiceCard
                option={item}
                width={cardWidth}
                scale={layout.scale}
                large
                testID={`theme-browser-${item.id}`}
                selected={app.state.settings.theme === item.id}
                onSelect={() => {
                  app.setSetting('theme', item.id);
                  app.setSetting('accent', themeDefaultAccents[item.id]);
                }}
              />
            )}
            showsHorizontalScrollIndicator={false}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const createStyles = (q: (value: number) => number) =>
  StyleSheet.create({
    root: { flex: 1 },
    safe: { flex: 1 },
    header: {
      height: q(64),
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: q(16),
    },
    back: {
      width: q(44),
      height: q(48),
      justifyContent: 'center',
      alignItems: 'center',
    },
    backText: { fontSize: q(36), lineHeight: q(42) },
    title: { flex: 1, fontSize: q(24), fontWeight: '600' },
    filters: { marginHorizontal: q(20), marginBottom: q(16) },
    filterContent: { flexDirection: 'row', gap: q(6) },
    filter: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: q(4),
      minHeight: q(44),
      borderRadius: q(12),
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterText: { fontSize: q(12), fontWeight: '500' },
    grid: { paddingHorizontal: q(20), paddingBottom: q(24), rowGap: q(16) },
    columns: { gap: q(12) },
  });
