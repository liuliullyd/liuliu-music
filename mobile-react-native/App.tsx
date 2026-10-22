import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  type LayoutChangeEvent,
  PanResponder,
  Platform,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { BottomNav, Toast } from './src/components/UI';
import {
  ThemeBackground,
  themeBackgroundAllowed,
} from './src/components/ThemeBackground';
import {
  HomeMenuDrawer,
  requestHomeMenuClose,
} from './src/components/HomeMenuDrawer';
import { HomePlayerBar } from './src/components/HomePlayerBar';
import { EffectsChromeContext } from './src/components/EffectsChromeContext';
import { PlaybackQueueSheet } from './src/components/PlaybackQueueSheet';
import { useBottomPlayerHints } from './src/components/useBottomPlayerHints';
import { OrderedCoverScope } from './src/components/OrderedRemoteCover';
import {
  STARTUP_PALETTES,
  STARTUP_TRANSITION_MS,
  StartupSplash,
} from './src/components/StartupSplash';
import { HomeScreen } from './src/screens/HomeScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { PlayerBackdrop, PlayerScreen } from './src/screens/PlayerScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { AppProvider, useApp } from './src/state/AppContext';
import { PlaylistMembershipProvider } from './src/components/PlaylistMembershipPicker';
import { usePlayerBackdropSurfaceTone } from './src/services/playerAppearance';
import { LayoutProvider } from './src/state/LayoutContext';
import { useMediaNotificationControls, useMediaNotificationLyrics } from './src/state/useMediaNotification';
import { useCarLibrary } from './src/state/useCarLibrary';
import { usePlaylistClipboard } from './src/state/usePlaylistClipboard';
import { PlaylistImportDialog } from './src/components/PlaylistImportDialog';
import {
  LibraryDetailAppearanceContext,
} from './src/components/LibraryDetailAppearance';
import { StickyBackgroundProvider, StickyBackgroundViewport } from './src/components/StickyBackgroundExtension';
import {
  completedEdgeBackFrom,
  EDGE_BACK_ZONE,
  type EdgeBackSide,
  shouldStartEdgeBackFrom,
} from './src/edgeBackGesture';
import {
  createThemedStyles,
  light,
  paletteForTheme,
  ThemeProvider,
} from './src/theme';
import {
  BOTTOM_NAV_LIFT,
  BOTTOM_NAV_SEAM_OVERLAP,
  DESIGN_WIDTH,
  adaptivePageMetrics,
  fluidCanvasMetrics,
} from './src/layout';

function Shell() {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [viewportSize, setViewportSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const canvas = viewportSize
    ? fluidCanvasMetrics(viewportSize.width, viewportSize.height)
    : fluidCanvasMetrics(
        window.width,
        window.height,
        insets.top,
        insets.bottom,
        insets.left,
        insets.right,
      );
  const layout = adaptivePageMetrics(canvas.designHeight, canvas.scale);
  const [bottomPlayerCollapsed, setBottomPlayerCollapsed] = useState(false);
  const libraryDetailContext = useMemo(
    () => ({
      topRatio: insets.top / Math.max(1, insets.top + 80 * canvas.scale),
    }),
    [insets.top, canvas.scale],
  );
  const bottomPlayerTranslateY = useRef(new Animated.Value(0)).current;
  const bottomPlayerHiddenOffset =
    layout.miniPlayerCoverSize + layout.bottomNavHeight + 24;
  const homeBackgroundScrollY = useRef(new Animated.Value(0)).current;
  const searchBackgroundScrollY = useRef(new Animated.Value(0)).current;
  const libraryBackgroundScrollY = useRef(new Animated.Value(0)).current;
  const settingsBackgroundScrollY = useRef(new Animated.Value(0)).current;
  const measureViewport = (event: LayoutChangeEvent) => {
    const width = Math.max(1, event.nativeEvent.layout.width);
    const height = Math.max(1, event.nativeEvent.layout.height);
    setViewportSize(current =>
      current && current.width === width && current.height === height
        ? current
        : { width, height },
    );
  };
  const app = useApp(),
    playerPage = ['player', 'lyrics', 'effects', 'queue'].includes(app.page),
    playerSurface =
      playerPage ||
      (app.page === 'home-menu' && app.homeMenuOrigin === 'player'),
    playerAppearance = playerSurface && app.page !== 'effects',
    movingPlayerPage = app.page === 'player' && Boolean(app.current),
    playerTone = usePlayerBackdropSurfaceTone(
      movingPlayerPage ? null : app.current,
    ),
    homeRoot = app.tab === 'discovery' && app.page === 'root',
    searchRoot = app.tab === 'search' && app.page === 'root',
    homeSurface =
      (app.tab === 'discovery' && app.page === 'root') ||
      (app.page === 'home-menu' && app.homeMenuOrigin === 'home'),
    themeBackgroundVisible = themeBackgroundAllowed({
      tab: app.tab,
      page: app.page,
      playerSurface,
      homeMenuOrigin: app.homeMenuOrigin,
    }),
    startupPalette = STARTUP_PALETTES[app.state.settings.theme],
    appPalette = paletteForTheme(
      app.state.settings.theme,
      app.state.settings.accent,
    ),
    reveal = useRef(new Animated.Value(app.startup.visible ? 0 : 1)).current;
  const hasBottomPlayer = Boolean(app.current);
  const bottomPlayerSurface = !playerSurface || app.page === 'effects';
  useMediaNotificationControls({ queue: app.queue, player: app.player,
    hasMore: app.queuePage.hasMore, reversed: app.queueReversed,
    ready: app.ready && !app.startup.visible, previous: app.previous, next: app.next,
    cancelPreparation: () => app.setPlaybackPlaying(false) });
  useMediaNotificationLyrics(app.current, app.player, app.startup.visible);
  useCarLibrary(app);
  usePlaylistClipboard(app);
  const bottomPlayerHints = useBottomPlayerHints(
    app.current
      ? `${app.current.provider}:${app.current.providerId ?? app.current.id}`
      : null,
    app.player.playing,
  );
  const bottomPlayerToggleAvailable =
    hasBottomPlayer && bottomPlayerSurface && !app.startup.visible;
  const showBottomPlayerHideHint =
    bottomPlayerToggleAvailable && bottomPlayerHints.visible('hide');
  const hideBottomPlayer = () => {
    setBottomPlayerCollapsed(true);
    bottomPlayerHints.learn('hide');
  };
  const showBottomPlayer = () => {
    setBottomPlayerCollapsed(false);
    bottomPlayerHints.learn('show');
  };
  const bottomChromeHeight =
    (layout.bottomNavHeight +
      (bottomPlayerToggleAvailable && !bottomPlayerCollapsed
        ? layout.miniPlayerHeight +
          Math.ceil(
            Math.max(
              0,
              (layout.miniPlayerCoverSize - layout.miniPlayerHeight) / 2 +
                Math.round(layout.miniPlayerCoverSize * 0.05),
            ),
          )
        : 0)) *
    canvas.scale;
  const effectsBottomInset =
    layout.bottomNavLift +
    (bottomPlayerToggleAvailable && !bottomPlayerCollapsed
      ? layout.miniPlayerHeight +
        Math.ceil(Math.max(0, (layout.miniPlayerCoverSize - layout.miniPlayerHeight) / 2 +
          Math.round(layout.miniPlayerCoverSize * 0.05)))
      : 0);
  useEffect(() => {
    if (hasBottomPlayer) return;
    setBottomPlayerCollapsed(false);
  }, [hasBottomPlayer]);
  useEffect(() => {
    const animation = Animated.spring(bottomPlayerTranslateY, {
      toValue: bottomPlayerCollapsed ? bottomPlayerHiddenOffset : 0,
      useNativeDriver: true,
      tension: 72,
      friction: 11,
      overshootClamping: true,
    });
    animation.start();
    return () => animation.stop();
  }, [bottomPlayerCollapsed, bottomPlayerHiddenOffset, bottomPlayerTranslateY]);
  const edgeBackResponders = useMemo(() => {
    const create = (side: EdgeBackSide) =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          shouldStartEdgeBackFrom(side, gesture.dx, gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (!completedEdgeBackFrom(side, gesture.dx, gesture.dy)) return;
          if (app.page === 'home-menu' && requestHomeMenuClose()) return;
          app.back();
        },
        onPanResponderTerminationRequest: () => false,
      });
    return { left: create('left'), right: create('right') };
  }, [app]);
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (app.page === 'home-menu' && requestHomeMenuClose()) return true;
        app.back();
        return true;
      },
    );
    return () => subscription.remove();
  }, [app]);
  useEffect(() => {
    Animated.timing(reveal, {
      toValue: app.startup.visible ? 0 : 1,
      duration: app.startup.visible ? 0 : STARTUP_TRANSITION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [app.startup.visible, reveal]);
  const screen =
    app.tab === 'discovery' && !playerSurface ? null : playerSurface ? (
      <PlayerScreen />
    ) : app.tab === 'search' ? (
      <SearchScreen backgroundScrollY={searchBackgroundScrollY} />
    ) : app.tab === 'library' ? (
      <LibraryScreen backgroundScrollY={libraryBackgroundScrollY} />
    ) : (
      <SettingsScreen backgroundScrollY={settingsBackgroundScrollY} />
    );
  const homeScreen = (
    <HomeScreen
      designHeight={canvas.designHeight}
      hidden={app.tab !== 'discovery' || playerSurface}
      backgroundScrollY={homeBackgroundScrollY}
    />
  );
  return (
    <ThemeProvider
      id={app.state.settings.theme}
      accent={app.state.settings.accent}
    >
      <PlaylistMembershipProvider>
      <LibraryDetailAppearanceContext.Provider value={libraryDetailContext}>
        <StickyBackgroundProvider scope={`${app.tab}:${app.page}:${app.pageRefreshToken}`}
          enabled={!app.startup.visible}>
        <View
          testID="app-edge-shell"
          style={[
            s.edgeShell,
            {
              backgroundColor: app.startup.visible
                ? startupPalette.background
                : movingPlayerPage
                ? 'transparent'
                : playerAppearance
                ? playerTone
                : appPalette.bg,
            },
          ]}
        >
          <ThemeBackground
            key={app.tab}
            visible={themeBackgroundVisible}
            diagnosticPage={
              app.tab === 'library' &&
              (app.page === 'root' || app.page === 'history')
                ? app.page
                : undefined
            }
            scrollY={
              homeRoot
                ? homeBackgroundScrollY
                : searchRoot
                ? searchBackgroundScrollY
                : app.tab === 'library'
                ? libraryBackgroundScrollY
                : app.tab === 'settings' && themeBackgroundVisible
                ? settingsBackgroundScrollY
                : undefined
            }
            scrollScale={canvas.scale}
          />
          {playerAppearance && !movingPlayerPage ? <PlayerBackdrop /> : null}
          <StatusBar
            barStyle={
              app.startup.visible && startupPalette.dark
                ? 'light-content'
                : app.page === 'home-menu'
                ? appPalette.dark ? 'light-content' : 'dark-content'
                : playerAppearance
                ? 'light-content'
                : (themeBackgroundVisible || app.page === 'effects') && appPalette.dark
                ? 'light-content'
                : ((app.tab === 'library' && app.page !== 'root') ||
                    (app.tab === 'search' && app.page === 'search-playlist')) &&
                  appPalette.dark
                ? 'light-content'
                : 'dark-content'
            }
            backgroundColor="transparent"
            translucent
          />
          <SafeAreaView
            testID="app-shell"
            edges={['top', 'left', 'right', 'bottom']}
            style={s.safe}
          >
            <LayoutProvider
              designHeight={canvas.designHeight}
              scale={canvas.scale}
            >
              <View
                testID="scaled-viewport"
                onLayout={measureViewport}
                style={[s.viewport, movingPlayerPage && s.playerViewport]}
              >
                <View
                  testID="fixed-design-canvas"
                  style={[
                    s.canvas,
                    {
                      height: canvas.designHeight,
                      backgroundColor:
                        playerSurface || themeBackgroundVisible
                          ? 'transparent'
                          : light.bg,
                      transform: [{ scale: canvas.scale }],
                    },
                  ]}
                >
                  <Animated.View
                    style={[
                      s.screen,
                      { opacity: reveal },
                      s.contentLayer,
                      playerSurface &&
                        app.playerOverlayOpen &&
                        s.playerOverlayScreen,
                    ]}
                  >
                    <React.Fragment
                      key={`${
                        playerSurface
                          ? app.page === 'home-menu'
                            ? 'player-menu'
                            : app.page
                          : app.tab
                      }:${app.pageRefreshToken}`}
                    >
                      <OrderedCoverScope
                        active={Boolean(screen)}
                        generationKey={`screen:${app.tab}:${app.page}:${app.pageRefreshToken}`}
                      >
                        <EffectsChromeContext.Provider value={app.page === 'effects' ? effectsBottomInset : 0}>
                          {screen}
                        </EffectsChromeContext.Provider>
                      </OrderedCoverScope>
                    </React.Fragment>
                    <OrderedCoverScope
                      active={
                        !app.startup.visible &&
                        !(app.tab !== 'discovery' || playerSurface)
                      }
                      generationKey={`home:${app.page}:${app.homeRefreshToken}`}
                    >
                      {homeScreen}
                    </OrderedCoverScope>
                  </Animated.View>
                  {/* Android hit testing excludes children outside a parent's
                    bounds. Give the drawer its own canvas region rather than
                    placing it above the navigation frame's short bounds. */}
                  {bottomPlayerSurface ? (
                    <Animated.View
                      testID="bottom-player-overlay"
                      pointerEvents={bottomPlayerCollapsed ? 'none' : 'auto'}
                      accessibilityElementsHidden={bottomPlayerCollapsed}
                      importantForAccessibility={
                        bottomPlayerCollapsed ? 'no-hide-descendants' : 'auto'
                      }
                      style={[
                        s.homeMiniOverlay,
                        {
                          bottom:
                            layout.bottomNavHeight +
                            layout.bottomNavLift -
                            BOTTOM_NAV_SEAM_OVERLAP -
                            Math.ceil(
                              Math.max(
                                0,
                                (layout.miniPlayerCoverSize -
                                  layout.miniPlayerHeight) /
                                  2 -
                                  Math.round(layout.miniPlayerCoverSize * 0.05),
                              ),
                            ),
                          transform: [{ translateY: bottomPlayerTranslateY }],
                        },
                      ]}
                    >
                      <OrderedCoverScope
                        active={!app.startup.visible}
                        generationKey={`mini-player:${
                          app.current?.id ?? 'empty'
                        }`}
                      >
                        <HomePlayerBar
                          onHide={hideBottomPlayer}
                          showHideHint={
                            showBottomPlayerHideHint && !bottomPlayerCollapsed
                          }
                          showPreviousHint={
                            bottomPlayerToggleAvailable &&
                            !bottomPlayerCollapsed &&
                            bottomPlayerHints.visible('previous')
                          }
                          showNextHint={
                            bottomPlayerToggleAvailable &&
                            !bottomPlayerCollapsed &&
                            bottomPlayerHints.visible('next')
                          }
                          onNavigate={bottomPlayerHints.navigate}
                        />
                      </OrderedCoverScope>
                    </Animated.View>
                  ) : null}
                  <View
                    testID={homeRoot ? 'home-bottom-frame' : 'bottom-frame'}
                    style={[
                      s.bottomFrame,
                      !playerAppearance && s.drawerBottomFrame,
                      { height: layout.bottomNavHeight },
                      (homeSurface || app.page === 'effects') && s.homeBottomFrame,
                      playerAppearance && s.playerBottomFrame,
                    ]}
                  >
                    <BottomNav
                      attached
                      transparent={playerAppearance}
                      playerCollapsed={bottomPlayerCollapsed}
                      showPlayerHint={
                        bottomPlayerToggleAvailable &&
                        bottomPlayerHints.visible('show')
                      }
                      onShowPlayer={
                        bottomPlayerToggleAvailable
                          ? showBottomPlayer
                          : undefined
                      }
                    />
                  </View>
                  {app.page === 'home-menu' ? <HomeMenuDrawer /> : null}
                  {((['podcast', 'audiobook'] as string[]).includes(app.page) ||
                    (homeRoot && app.message === '正在解析可播放音源…')) &&
                  !app.stateStorageError ? null : (
                    <Toast />
                  )}
                </View>
                <View
                  testID="edge-back-left"
                  {...edgeBackResponders.left.panHandlers}
                  style={[
                    s.edgeBackRegion,
                    s.edgeBackLeft,
                    app.page === 'effects' && {
                      top: Math.max(48, layout.playerHeaderHeight * canvas.scale),
                    },
                    bottomPlayerSurface && { bottom: bottomChromeHeight },
                  ]}
                />
                <View
                  testID="edge-back-right"
                  {...edgeBackResponders.right.panHandlers}
                  style={[
                    s.edgeBackRegion,
                    s.edgeBackRight,
                    bottomPlayerSurface && { bottom: bottomChromeHeight },
                  ]}
                />
              </View>
              {!app.startup.visible ? <PlaybackQueueSheet /> : null}
            </LayoutProvider>
          </SafeAreaView>
          {!playerAppearance && !app.startup.visible ? (
            <View
              testID="bottom-nav-edge-fill"
              pointerEvents="none"
              style={[
                s.bottomNavEdgeFill,
                {
                  // Paint outside the scaled/safe-area viewport so the lifted
                  // navigation surface still reaches the physical bottom edge.
                  height:
                    (layout.bottomNavLift + BOTTOM_NAV_SEAM_OVERLAP) *
                      canvas.scale +
                    insets.bottom,
                  backgroundColor: appPalette.bg,
                },
              ]}
            />
          ) : null}
          <StickyBackgroundViewport inset={insets.top} />
          {/* Startup is deliberately outside SafeAreaView so its opaque surface
            also covers the system status/navigation bars during launch. */}
          <StartupSplash />
          {!app.startup.visible && app.playlistImportRequest ? <PlaylistImportDialog
            key={app.playlistImportRequest.id} initialInput={app.playlistImportRequest.input}
            autoRead={app.playlistImportRequest.autoRead} onClose={app.closePlaylistImport}
            onCancel={app.cancelPlaylistImport} onSave={app.importPlaylist} isSaved={app.isPlaylistSaved}
          /> : null}
        </View>
        </StickyBackgroundProvider>
      </LibraryDetailAppearanceContext.Provider>
      </PlaylistMembershipProvider>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}

const s = createThemedStyles(
  StyleSheet.create({
    edgeShell: { flex: 1 },
    safe: { flex: 1, backgroundColor: 'transparent' },
    viewport: {
      flex: 1,
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
      overflow: 'hidden',
    },
    playerViewport: { overflow: 'visible' },
    edgeBackRegion: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      zIndex: 100,
      width: EDGE_BACK_ZONE,
    },
    edgeBackLeft: { left: 0 },
    edgeBackRight: { right: 0 },
    canvas: {
      width: DESIGN_WIDTH,
      backgroundColor: light.bg,
      transformOrigin: 'top left',
    },
    screen: { flex: 1 },
    contentLayer: { zIndex: 1 },
    bottomFrame: {},
    bottomNavEdgeFill: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      left: 0,
    },
    drawerBottomFrame: { zIndex: 10 },
    homeBottomFrame: {},
    playerBottomFrame: {
      // The moving player page paints behind this transparent navigation.
      // Keep its lifted center button above the screen sibling.
      backgroundColor: 'transparent',
      zIndex: 50,
      elevation: 50,
      overflow: 'visible',
    },
    playerOverlayScreen: { zIndex: 60, elevation: 60 },
    homeMiniOverlay: {
      position: 'absolute',
      right: 0,
      bottom: BOTTOM_NAV_LIFT,
      left: 0,
      zIndex: 9,
    },
  }),
);
