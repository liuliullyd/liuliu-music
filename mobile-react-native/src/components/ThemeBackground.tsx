import React, { useEffect, useMemo } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { themeBackgroundArtwork } from '../assets/themeBackgrounds';
import type { AppPage, AppTab } from '../state/AppContext';
import { useTheme, type ThemePalette } from '../theme';
import {
  setRoamBackgroundDiagnosticScene,
  traceRoamBackground,
} from './roamBackgroundDiagnostic';
/** The preview and page use the same complete bitmap, without a scene overlay. */
export function ThemeArtwork({
  theme,
  artworkTestID,
  diagnostic = false,
  resizeMode = 'cover',
}: {
  theme: Pick<ThemePalette, 'id' | 'bg'>;
  artworkTestID?: string;
  diagnostic?: boolean;
  resizeMode?: 'cover' | 'contain';
}) {
  return (
    <Image
      testID={artworkTestID ?? `theme-artwork-${theme.id}`}
      source={themeBackgroundArtwork[theme.id]}
      resizeMode={resizeMode}
      style={[styles.image, { backgroundColor: theme.bg }]}
      onLoadStart={
        diagnostic ? () => traceRoamBackground('image-load-start') : undefined
      }
      onLoad={
        diagnostic
          ? event =>
              traceRoamBackground('image-loaded', {
                width: event.nativeEvent.source.width,
                height: event.nativeEvent.source.height,
              })
          : undefined
      }
      onLoadEnd={
        diagnostic ? () => traceRoamBackground('image-load-end') : undefined
      }
      onError={
        diagnostic
          ? event =>
              traceRoamBackground('image-error', {
                error: event.nativeEvent.error,
              })
          : undefined
      }
    />
  );
}
export type ThemeBackgroundSurface = {
  tab: AppTab;
  page: AppPage;
  playerSurface: boolean;
  homeMenuOrigin: 'home' | 'player' | null;
};
/** Root shells retain artwork; opaque detail/player surfaces own their tone. */
export const themeBackgroundAllowed = ({
  tab,
  page,
  playerSurface,
  homeMenuOrigin,
}: ThemeBackgroundSurface) => {
  if (playerSurface) return false;
  if (tab === 'discovery') {
    return (
      page === 'root' || (page === 'home-menu' && homeMenuOrigin === 'home')
    );
  }
  if (tab === 'search') return page === 'root';
  if (tab === 'library') return page === 'root';
  return ['root', 'appearance', 'playback', 'sources', 'data'].includes(page);
};
export function ThemeBackground({
  visible = true,
  scrollY,
  scrollScale = 1,
  diagnosticPage,
}: {
  visible?: boolean;
  scrollY?: Animated.Value;
  scrollScale?: number;
  diagnosticPage?: 'root' | 'history';
}) {
  const theme = useTheme();
  useEffect(() => {
    setRoamBackgroundDiagnosticScene(
      diagnosticPage
        ? {
            page: diagnosticPage,
            theme: theme.id,
            visible,
            scrollScale,
            scrollY,
          }
        : null,
    );
    if (!diagnosticPage) return undefined;
    traceRoamBackground('surface-committed');
    const timers = [150, 800].map(delay =>
      setTimeout(
        () => traceRoamBackground('surface-settled', { delay }, true),
        delay,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [diagnosticPage, theme.id, visible, scrollScale, scrollY]);
  return (
    <ThemeBackgroundView
      visible={visible}
      scrollY={scrollY}
      scrollScale={scrollScale}
      diagnosticPage={diagnosticPage}
      themeId={theme.id}
      backgroundColor={theme.bg}
    />
  );
}
// Playback/catalog context updates must not re-submit a stale JS scroll sample
// over the transform that the native scroll driver is currently displaying.
const ThemeBackgroundView = React.memo(function BackgroundView({
  visible,
  scrollY,
  scrollScale,
  diagnosticPage,
  themeId,
  backgroundColor,
}: {
  visible: boolean;
  scrollY?: Animated.Value;
  scrollScale: number;
  diagnosticPage?: 'root' | 'history';
  themeId: ThemePalette['id'];
  backgroundColor: string;
}) {
  const theme = useMemo(
    () => ({ id: themeId, bg: backgroundColor }),
    [themeId, backgroundColor],
  );
  const translateY = useMemo(
    () =>
      scrollY?.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -scrollScale],
        extrapolateLeft: 'clamp',
        extrapolateRight: 'extend',
      }),
    [scrollY, scrollScale],
  );
  if (!visible) return null;
  return (
    <View
      testID="theme-background"
      pointerEvents="none"
      accessible={false}
      style={[styles.root, { backgroundColor: theme.bg }]}
      onLayout={
        diagnosticPage
          ? event =>
              traceRoamBackground('background-layout', {
                width: event.nativeEvent.layout.width,
                height: event.nativeEvent.layout.height,
              })
          : undefined
      }
    >
      <View
        testID="theme-background-base"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]}
      />
      <Animated.View
        testID="theme-background-artwork"
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          translateY ? { transform: [{ translateY }] } : undefined,
        ]}
      >
        <ThemeArtwork
          theme={theme}
          diagnostic={Boolean(diagnosticPage)}
          artworkTestID={
            theme.id === 'white'
              ? 'theme-background-character'
              : 'theme-background-theme-image'
          }
        />
      </Animated.View>
    </View>
  );
});
const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    zIndex: 0,
  },
  image: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
});
