import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  HOME_MENU_MODES,
  HOME_MENU_SCENES,
  HOME_MENU_BATCH_SIZE,
  HomeMenuLoadError,
  loadHomeMenuFirstBatch,
  type HomeMenuChoice,
} from '../services/homeMenuDiscovery';
import { shuffleHomeMenuSceneValues } from '../services/homeMenuSceneOrder';
import { constituentArtists } from '../services/liveDiscovery';
import { useApp } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { useTheme } from '../theme';
import { MenuBackgroundExtension } from './StickyBackgroundExtension';
import { favoriteStatisticsFor } from '../services/musicPreferenceStatistics';
import { SceneIcon } from './SceneIcon';
import { advanceExhaustedMenuRound, menuProgressEntry } from '../services/homeMenuProgress';

const DRAWER_HIDDEN_X = -390;
export const HOME_MENU_DRAWER_WIDTH = '86%' as const;
export const HOME_MENU_BACKDROP_OPACITY = 0.42;
let selectedChoiceId = 'mode-default';
let closeHomeMenuHandler: (() => void) | null = null;

export function getSelectedHomeMenuChoice() {
  return (
    [...HOME_MENU_MODES, ...HOME_MENU_SCENES].find(
      choice => choice.id === selectedChoiceId,
    ) ?? HOME_MENU_MODES[0]
  );
}

export function requestHomeMenuClose() {
  if (!closeHomeMenuHandler) return false;
  closeHomeMenuHandler();
  return true;
}

export function HomeMenuDrawer() {
  const app = useApp();
  const cachedChoice = app.catalogViewState?.get('home-menu-choice') as string | undefined;
  if (cachedChoice && [...HOME_MENU_MODES, ...HOME_MENU_SCENES].some(choice => choice.id === cachedChoice)) selectedChoiceId = cachedChoice;
  const layout = useLayout();
  const palette = useTheme();
  const translateX = useRef(new Animated.Value(DRAWER_HIDDEN_X)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [activeMode, setActiveMode] = useState(
    getSelectedHomeMenuChoice()?.kind === 'mode'
      ? getSelectedHomeMenuChoice()!.id
      : 'mode-default',
  );
  const choiceRestoreVersion = useRef(app.catalogRestore?.version);
  if (choiceRestoreVersion.current !== app.catalogRestore?.version) {
    choiceRestoreVersion.current = app.catalogRestore?.version;
    if (app.catalogRestore?.keys.includes('home-menu-choice')) {
      setActiveMode(getSelectedHomeMenuChoice()?.kind === 'mode' ? selectedChoiceId : 'mode-default');
    }
  }
  const [loadingId, setLoadingId] = useState('');
  const [error, setError] = useState('');
  const [errorChoiceId, setErrorChoiceId] = useState('');
  const requestGeneration = useRef(0);
  const sceneRequestAbort = useRef<AbortController | null>(null);
  const closing = useRef(false);
  const closeBack = app.back;
  const closeMotion = app.state.settings.motion;
  const closeReducedMotion = app.state.settings.reducedMotion;

  const closeDrawer = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    requestGeneration.current += 1;
    sceneRequestAbort.current?.abort();
    const duration = closeMotion === 'off' || closeReducedMotion ? 0 : 180;
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: DRAWER_HIDDEN_X,
        duration,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => closeBack());
  }, [backdropOpacity, closeBack, closeMotion, closeReducedMotion, translateX]);

  useEffect(() => {
    const duration =
      app.state.settings.motion === 'off' || app.state.settings.reducedMotion
        ? 0
        : 260;
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: HOME_MENU_BACKDROP_OPACITY,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    app.state.settings.motion,
    app.state.settings.reducedMotion,
    backdropOpacity,
    translateX,
  ]);

  useEffect(() => {
    closeHomeMenuHandler = closeDrawer;
    return () => {
      requestGeneration.current += 1;
      sceneRequestAbort.current?.abort();
      if (closeHomeMenuHandler === closeDrawer) closeHomeMenuHandler = null;
    };
  }, [closeDrawer]);

  const playChoice = async (choice: HomeMenuChoice) => {
    if (loadingId) return;
    const queueOrigin = app.captureQueueOrigin?.(choice.label, { menuChoiceId: choice.id });
    selectedChoiceId = choice.id;
    app.catalogViewState?.set('home-menu-choice', choice.id);
    if (choice.kind === 'mode') {
      setActiveMode(choice.id);
    }
    setError('');
    setErrorChoiceId('');
    setLoadingId(choice.id);
    const generation = ++requestGeneration.current;
    const sceneAbort = new AbortController();
    sceneRequestAbort.current = sceneAbort;
    try {
      const platform = app.recommendationPlatforms.find(
        item => item.enabled && item.id === app.startupHealth?.first,
      );
      if (!platform) throw new Error('本次启动没有可用的音乐平台');
      const platforms = [platform];
      const savedProgress=menuProgressEntry(app.state.menuRecommendationProgress,choice.id,platform.id);
      const progress=advanceExhaustedMenuRound(savedProgress);
      if(progress && progress!==savedProgress){
        app.notify?.(`${choice.label}目录已进入第${progress.round}轮，保留近期去重`);
        console.info('[menu-catalog-round]',JSON.stringify({choice:choice.id,provider:platform.id,round:progress.round,
          queries:Object.fromEntries(Object.entries(progress.queries).map(([query,value])=>[query,value.page]))}));
      }
      const profile = choice.id === 'mode-default'
        ? { ...app.state.profile, favoriteStatistics: favoriteStatisticsFor(app.state) }
        : app.state.profile;
      const result = await loadHomeMenuFirstBatch(choice.id, platforms, profile, app.state.history, { progress, signal: sceneAbort.signal });
      if (generation !== requestGeneration.current || closing.current) return;
      app.rememberHomeMenuBatch?.(result.cursor,result.tracks);
      console.info('[menu-batch]', JSON.stringify({choice:choice.id,stage:'initial',revision:result.cursor.batchRevision,
        round:result.cursor.catalogRound ?? 1,keys:result.tracks.map(item=>`${item.provider}:${item.providerId ?? item.id}`),hasMore:result.hasMore}));
      const playbackTracks = choice.kind === 'scene'
        ? shuffleHomeMenuSceneValues(result.tracks)
        : result.tracks;
      await app.playTrack(playbackTracks[0]!, playbackTracks, 0, {
        queueOrigin,
        ...(choice.kind === 'scene' ? { allowFailureFallback: true } : {}),
        queueSource: {
          kind: 'home-menu',
          cursor: result.cursor,
          hasMore: result.hasMore,
          ...(result.hasMore
            ? { initialMenuBatch: {
                remaining: HOME_MENU_BATCH_SIZE - playbackTracks.length,
                artists: [...new Set(playbackTracks.flatMap(item => constituentArtists(item.artist)))],
              } }
            : {}),
        },
      });
    } catch (value) {
      if (generation !== requestGeneration.current || closing.current) return;
      if (value instanceof HomeMenuLoadError) app.rememberHomeMenuBatch?.(value.cursor,[]);
      setError(value instanceof Error ? value.message : '分类歌曲加载失败');
      setErrorChoiceId(choice.id);
    } finally {
      if (sceneRequestAbort.current === sceneAbort) sceneRequestAbort.current = null;
      if (generation === requestGeneration.current && !closing.current) {
        setLoadingId('');
      }
    }
  };

  return (
    <View testID="home-main-menu" style={styles.overlay}>
      <MenuBackgroundExtension color={palette.bg} shade={palette.shadow}
        translateX={translateX} opacity={backdropOpacity} scale={layout.scale} width={HOME_MENU_DRAWER_WIDTH} />
      <Animated.View
        testID="home-menu-animated-backdrop"
        style={[
          styles.backdrop,
          { opacity: backdropOpacity, backgroundColor: palette.shadow },
        ]}
      >
        <Pressable
          testID="home-menu-backdrop"
          accessibilityRole="button"
          accessibilityLabel="关闭功能菜单"
          onPress={closeDrawer}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Pressable
        testID="home-menu-dismiss-area"
        accessibilityRole="button"
        accessibilityLabel="关闭功能菜单"
        onPress={closeDrawer}
        style={styles.dismissArea}
      />
      <Animated.View
        testID="home-menu-drawer"
        style={[
          styles.drawer,
          {
            backgroundColor: palette.bg,
            borderColor: palette.line,
            transform: [{ translateX }],
          },
        ]}
      >
        <ScrollView
          testID="home-menu-scroll"
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: layout.pageTopPadding,
              paddingHorizontal: layout.pageHorizontalPadding,
              paddingBottom: layout.scrollBottomPadding,
            },
          ]}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        >
          <Text
            style={[
              styles.heading,
              {
                color: palette.text,
                fontSize: layout.homeTopNavigationFontSize,
              },
            ]}
          >
            听歌模式
          </Text>
          <View style={styles.modeList}>
            {HOME_MENU_MODES.map(choice => {
              const selected = activeMode === choice.id;
              const loading = loadingId === choice.id;
              return (
                <Pressable
                  key={choice.id}
                  testID={`home-menu-${choice.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`播放${choice.label}分类`}
                  accessibilityState={{ selected, busy: loading }}
                  disabled={Boolean(loadingId)}
                  onPress={() => playChoice(choice)}
                  style={[
                    styles.modeCard,
                    { minHeight: layout.trackRowHeight },
                    {
                      backgroundColor: selected
                        ? palette.selectedSurface
                        : palette.panelSoft,
                      borderColor: palette.line,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.modeTitle,
                      {
                        color: palette.muted,
                      },
                    ]}
                  >
                    {choice.label}
                  </Text>
                  <Text
                    style={[
                      styles.modeDescription,
                      {
                        color: palette.muted,
                      },
                    ]}
                  >
                    {loading ? '正在准备歌曲…' : choice.description}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text
            style={[
              styles.sceneHeading,
              { color: palette.text },
            ]}
          >
            场景选择
          </Text>
          {error ? (
            <Text
              accessibilityRole="alert"
              style={[
                styles.error,
                { color: palette.red },
              ]}
            >
              {error}
            </Text>
          ) : null}
          <View
            style={[
              styles.sceneGrid,
              {
                backgroundColor: palette.panelSoft,
              },
            ]}
          >
            {HOME_MENU_SCENES.map(choice => {
              const loading = loadingId === choice.id;
              return (
                <Pressable
                  key={choice.id}
                  testID={`home-menu-${choice.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`播放${choice.label}分类`}
                  accessibilityState={{ busy: loading }}
                  disabled={Boolean(loadingId)}
                  onPress={() => playChoice(choice)}
                  style={styles.sceneItem}
                >
                  <View style={styles.sceneGlyph}>
                    <SceneIcon id={choice.id} size={24} color={palette.muted} loading={loading} />
                  </View>
                  <Text
                    style={[
                      styles.sceneLabel,
                      {
                        color: palette.muted,
                      },
                    ]}
                  >
                    {loading ? '正在准备歌曲…' : choice.label}
                  </Text>
                  {errorChoiceId === choice.id ? <Text
                    testID={`home-menu-${choice.id}-feedback`}
                    accessibilityRole="alert"
                    numberOfLines={1}
                    style={{ color: palette.red, fontSize: 10, lineHeight: 14 }}
                  >{error.includes('已查询的目录暂无匹配') ? '目录已查询完，暂无匹配' : error.includes('配额') ? '本批数据暂缺，点击重试' : '请求未完成，点击重试'}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 70,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  dismissArea: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: HOME_MENU_DRAWER_WIDTH,
    zIndex: 3,
    elevation: 3,
  },
  drawer: {
    width: HOME_MENU_DRAWER_WIDTH,
    height: '100%',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    overflow: 'hidden',
    elevation: 18,
    zIndex: 2,
  },
  content: {
    paddingTop: 16,
    paddingHorizontal: 18,
    paddingBottom: 24,
  },
  heading: { fontSize: 20, lineHeight: 24, fontWeight: '400' },
  modeList: { marginTop: 8, gap: 5 },
  modeCard: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    justifyContent: 'center',
  },
  modeTitle: {
    textAlign: 'center',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '600',
  },
  modeDescription: {
    marginTop: 0,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 16,
  },
  sceneHeading: {
    marginTop: 12,
    marginBottom: 8,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '400',
  },
  error: { marginBottom: 12, fontSize: 13, lineHeight: 18 },
  sceneGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: 12,
    paddingBottom: 14,
    borderRadius: 16,
  },
  sceneItem: {
    width: '33.333%',
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  sceneGlyph: {
    height: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sceneLabel: {
    marginTop: 7,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 19,
  },
});
