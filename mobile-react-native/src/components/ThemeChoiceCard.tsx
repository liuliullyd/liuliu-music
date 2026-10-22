import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ThemeArtwork } from './ThemeBackground';
import {
  THEME_PREVIEW_ASPECT_RATIO,
  ThemeMyPagePreview,
} from './ThemeMyPagePreview';
import { paletteForTheme, useTheme } from '../theme';
import type { ThemeOption } from '../themeCatalog';

export function ThemeChoiceCard({
  option,
  selected,
  onSelect,
  width,
  scale = 1,
  large = false,
  testID = `theme-${option.id}`,
}: {
  option: ThemeOption;
  selected: boolean;
  onSelect: () => void;
  width?: number;
  scale?: number;
  large?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const preview = paletteForTheme(option.id);
  const cardScale = large ? scale : 1;
  const q = (value: number) => Math.max(1, Math.round(value * cardScale));
  const styles = useMemo(
    () =>
      createStyles(value => Math.max(1, Math.round(value * cardScale)), large),
    [cardScale, large],
  );
  const frameWidth = large ? Math.max(1, (width ?? q(160)) - q(6)) : q(78);
  const framePadding = q(2);
  const previewWidth = Math.max(1, frameWidth - framePadding * 2);
  const previewHeight = Math.ceil(previewWidth / THEME_PREVIEW_ASPECT_RATIO);
  const frameHeight = previewHeight + framePadding * 2;
  const checkColor = theme.dark ? theme.bg : '#fff';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={option.label}
      accessibilityState={{ selected }}
      onPress={onSelect}
      style={[styles.card, large && { width: width ?? q(160) }]}
    >
      <View
        testID={`${testID}-frame`}
        style={[
          styles.frame,
          { width: frameWidth, height: frameHeight },
          selected && { backgroundColor: theme.selectedSurface },
        ]}
      >
        <View style={[styles.image, { backgroundColor: preview.bg }]}>
          <ThemeArtwork
            theme={preview}
            resizeMode="contain"
            artworkTestID={
              large ? `${testID}-artwork` : `theme-artwork-${option.id}`
            }
          />
          <ThemeMyPagePreview
            theme={preview}
            width={previewWidth}
            height={previewHeight}
            testID={`${testID}-ui`}
          />
        </View>
      </View>
      <View
        testID={`${testID}-caption`}
        style={[styles.caption, { width: frameWidth }]}
      >
        <View style={styles.captionHeading}>
          <Text
            style={[
              styles.label,
              large && styles.largeLabel,
              { color: theme.text },
            ]}
          >
            {option.label}
          </Text>
          {selected ? (
            <View
              testID={`${testID}-selected`}
              style={[styles.check, { backgroundColor: theme.accent }]}
            >
              <Text style={[styles.checkText, { color: checkColor }]}>✓</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.copy, { color: theme.muted }]}>{option.copy}</Text>
      </View>
    </Pressable>
  );
}

const createStyles = (q: (value: number) => number, large: boolean) =>
  StyleSheet.create({
    card: { width: q(84), alignItems: 'center' },
    frame: {
      borderRadius: q(large ? 16 : 10),
      padding: q(2),
      overflow: 'hidden',
    },
    image: { flex: 1 },
    caption: { paddingTop: q(7), paddingHorizontal: q(2) },
    captionHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: q(4),
    },
    label: { flex: 1, fontSize: q(12), fontWeight: '600' },
    largeLabel: { fontSize: q(16) },
    copy: { fontSize: q(10), marginTop: q(3) },
    check: {
      width: q(18),
      height: q(18),
      borderRadius: q(9),
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkText: { fontSize: q(12), fontWeight: '400' },
  });
