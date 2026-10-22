import React, { createContext, useContext } from 'react';
import { ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme';

/** Page-local gradient geometry; no status-bar color or scroll publication. */
export const LibraryDetailAppearanceContext = createContext({ topRatio: 0 });

const blend = (background: string, tone: string, ratio: number) => {
  if (!/^#[a-f\d]{6}$/i.test(background) || !/^#[a-f\d]{6}$/i.test(tone))
    return background;
  return (
    '#' +
    [1, 3, 5]
      .map(index =>
        Math.round(
          parseInt(background.slice(index, index + 2), 16) * (1 - ratio) +
            parseInt(tone.slice(index, index + 2), 16) * ratio,
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
};

/** Preserve the shared scroll defaults and each caller's original callback. */
export function LibraryDetailScrollView(props: ScrollViewProps) {
  return (
    <ScrollView
      {...props}
      scrollEventThrottle={props.scrollEventThrottle ?? 16}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    />
  );
}

export function LibraryDetailTopGradient({ color }: { color: string }) {
  const theme = useTheme();
  const { topRatio } = useContext(LibraryDetailAppearanceContext);
  return (
    <Svg
      testID="library-detail-top-gradient"
      pointerEvents="none"
      width="100%"
      height={80}
      style={s.headerGradient}
    >
      <Defs>
        <LinearGradient id="libraryDetailTop" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={blend(theme.bg, color, topRatio)} />
          <Stop offset="1" stopColor={color} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#libraryDetailTop)" />
    </Svg>
  );
}
const s = StyleSheet.create({
  headerGradient: { position: 'absolute', top: 0, left: 0, right: 0 },
});
