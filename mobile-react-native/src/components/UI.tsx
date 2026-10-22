import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  ImageBackground,
  ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { covers } from '../assets/covers';
import type { CoverKey, Track } from '../domain/types';
import { createThemedStyles, dark, light, serif, useTheme } from '../theme';
import { EXIT_HINT_MESSAGE, useApp, type AppTab } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { BOTTOM_NAV_HEIGHT, BOTTOM_NAV_LIFT } from '../layout';
import { OrderedRemoteCover } from './OrderedRemoteCover';
import { trackCoverCandidates } from '../services/onlineCatalog';
import { platformDisplayText, sourceSettingsText } from '../services/platformPresentation';
import { platformLabel, isSpokenCollection } from './platformLabels';
import { PlayerGestureArrow } from './PlayerGestureArrow';
import { useDrawerSwipe } from './useDrawerSwipe';
import { TrackActionIcon } from './TrackActionIcon';

export function Glyph({
  children,
  size = 22,
  color,
}: {
  children: string;
  size?: number;
  color?: string;
}) {
  return <Text style={glyphStyle(size, color)}>{children}</Text>;
}

export function PlayPauseIcon({
  playing,
  color,
  size = 24,
}: {
  playing: boolean;
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {playing ? (
        <Path
          d="M7 5v14M17 5v14"
          stroke={color}
          strokeWidth={3.2}
          strokeLinecap="round"
        />
      ) : (
        <Path
          d="M8 5.5 18 12 8 18.5Z"
          fill={color}
          stroke={color}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
      )}
    </Svg>
  );
}
export function BrandBar({
  onSearch,
  trailing,
  name = '六六Music',
}: {
  onSearch?: () => void;
  trailing?: React.ReactNode;
  name?: string;
}) {
  return (
    <View style={s.brandBar}>
      <View style={s.brandLockup}>
        <View accessibilityLabel="六六Music 图标" style={s.brandMark}>
          <Text style={s.brandNote}>♪</Text>
        </View>
        <Text style={s.brandName}>{name}</Text>
      </View>
      <View style={s.brandActions}>
        {onSearch ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="搜索"
            onPress={onSearch}
            style={s.roundAction}
          >
            <Glyph color={light.text} size={27}>
              ⌕
            </Glyph>
          </Pressable>
        ) : null}
        {trailing}
      </View>
    </View>
  );
}
export function AppHeader({
  title,
  subtitle,
  darkMode = true,
  back = false,
  onBack,
  onSearch,
  trailing,
}: {
  title: string;
  subtitle?: string;
  darkMode?: boolean;
  back?: boolean;
  onBack?: () => void;
  onSearch?: () => void;
  trailing?: React.ReactNode;
}) {
  const c = darkMode ? dark : light;
  const app = useApp();
  const layout = useLayout();
  return (
    <View
      style={[
        s.header,
        {
          minHeight: layout.headerHeight,
          paddingHorizontal: layout.pageHorizontalPadding,
        },
      ]}
    >
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={onBack ?? app.back}
          style={[
            s.headerButton,
            { width: layout.headerButtonSize, height: layout.headerButtonSize },
          ]}
        >
          <Glyph color={c.text} size={32}>
            ‹
          </Glyph>
        </Pressable>
      ) : null}
      <View style={s.headerCopy}>
        <Text style={[s.headerTitle, { color: c.text, fontFamily: serif }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[s.headerSub, { color: c.muted }]}>{subtitle}</Text>
        ) : null}
      </View>
      {onSearch ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="搜索"
          onPress={onSearch}
          style={[
            s.headerButton,
            { width: layout.headerButtonSize, height: layout.headerButtonSize },
          ]}
        >
          <Glyph color={c.text} size={28}>
            ⌕
          </Glyph>
        </Pressable>
      ) : null}
      {trailing}
      {!onSearch && !trailing && back ? (
        <View
          style={[
            s.headerButton,
            { width: layout.headerButtonSize, height: layout.headerButtonSize },
          ]}
        />
      ) : null}
    </View>
  );
}
export function SectionTitle({
  title,
  action,
  onPress,
  actionTestID,
  hideActionLabel = false,
  darkMode = true,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
  actionTestID?: string;
  hideActionLabel?: boolean;
  darkMode?: boolean;
}) {
  const c = darkMode ? dark : light;
  const layout = useLayout();
  return (
    <View
      style={[
        s.section,
        {
          paddingHorizontal: layout.pageHorizontalPadding,
        },
      ]}
    >
      <Text style={[s.sectionText, { color: c.text, fontFamily: serif }]}>
        {title}
      </Text>
      {action ? (
        <Pressable
          testID={actionTestID}
          accessibilityRole="button"
          accessibilityLabel={action}
          onPress={onPress}
          style={[
            s.sectionActionButton,
            {
              minWidth: layout.headerButtonSize,
              minHeight: layout.headerButtonSize,
            },
          ]}
          hitSlop={10}
        >
          <Text
            style={[
              s.sectionAction,
              hideActionLabel && s.sectionActionArrowOnly,
              { color: c.accent },
            ]}
          >
            {hideActionLabel ? '›' : `${action}　›`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
export function Cover({
  coverKey,
  uri,
  fallbackUris = [],
  onExhausted,
  moduleKey,
  priority,
  resolution,
  fallbackWhileLoading,
  testID,
  size = 52,
  radius = 8,
}: {
  coverKey: CoverKey;
  uri?: string;
  fallbackUris?: string[];
  onExhausted?: () => void;
  moduleKey?: string;
  priority?: import('./OrderedRemoteCover').CoverPriority;
  resolution?: import('./homeCover').CoverResolution;
  fallbackWhileLoading?: boolean;
  testID?: string;
  size?: number;
  radius?: number;
}) {
  const imageStyle = { width: size, height: size, borderRadius: radius };
  return (
    <OrderedRemoteCover
      uris={[uri, ...fallbackUris]}
      fallback={covers[coverKey]}
      moduleKey={moduleKey}
      priority={priority}
      resolution={resolution}
      fallbackWhileLoading={fallbackWhileLoading}
      testID={testID}
      style={imageStyle}
      imageStyle={imageStyle}
      onExhausted={onExhausted}
    />
  );
}

export function ReferenceCrop({
  source,
  cropX,
  cropY,
  width,
  height,
  radius = 0,
}: {
  source: ImageSourcePropType;
  cropX: number;
  cropY: number;
  width: number;
  height: number;
  radius?: number;
}) {
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={[s.referenceCrop, { width, height, borderRadius: radius }]}
    >
      <Image
        source={source}
        resizeMode="stretch"
        style={[s.referenceImage, { left: -cropX, top: -cropY }]}
      />
    </View>
  );
}
export function TrackPlatformDuration({
  track,
  color,
  testIDPrefix = 'track',
  fontSize = 11,
  lineHeight = 15,
  durationMarginTop = 0,
}: {
  track: Track;
  color: string;
  testIDPrefix?: string;
  fontSize?: number;
  lineHeight?: number;
  durationMarginTop?: number;
}) {
  const label = platformLabel(track.provider);
  if (!label || isSpokenCollection(track.metadata)) return null;
  return (
    <View style={s.trackDurationColumn}>
      <Text
        testID={`${testIDPrefix}-provider-${track.id}`}
        numberOfLines={1}
        style={[s.trackProvider, { color, fontSize, lineHeight }]}
      >
        {label}
      </Text>
      <Text
        testID={`${testIDPrefix}-duration-${track.id}`}
        style={[
          s.trackProviderDuration,
          { color, fontSize, lineHeight, marginTop: durationMarginTop },
        ]}
      >
        {formatTime(track.duration)}
      </Text>
    </View>
  );
}

export function TrackRow({
  track,
  index,
  onPlay,
  onFavorite,
  favorite,
  trailing,
  active = false,
  rowPress = false,
  showPlayButton = true,
  showQuality = true,
  showProvider = true,
  showDivider = true,
}: {
  track: Track;
  index?: number;
  onPlay: () => void;
  onFavorite?: () => void;
  favorite?: boolean;
  trailing?: React.ReactNode;
  darkMode?: boolean;
  active?: boolean;
  rowPress?: boolean;
  showPlayButton?: boolean;
  showQuality?: boolean;
  showProvider?: boolean;
  showDivider?: boolean;
}) {
  const c = useTheme();
  const layout = useLayout();
  const providerLabel =
    showProvider && !isSpokenCollection(track.metadata)
      ? platformLabel(track.provider)
      : '';
  const content = (
    <>
      {index !== undefined ? (
        <Text style={[s.trackIndex, { color: active ? c.accent : c.muted }]}>
          {index}
        </Text>
      ) : null}
      <Cover
        coverKey={track.coverKey}
        uri={track.cover}
        fallbackUris={trackCoverCandidates(track)}
        moduleKey="track-rows"
        size={layout.trackCoverSize}
        radius={10}
      />
      <View style={s.trackCopy}>
        <Text numberOfLines={1} style={[s.trackTitle, { color: c.text }]}>
          {track.title}
        </Text>
        <View style={s.trackMetaLine}>
          <Text numberOfLines={1} style={[s.trackMeta, { color: c.muted }]}>
            {track.artist} · {track.album}
          </Text>
          {!providerLabel ? (
            <Text style={[s.duration, { color: c.muted }]}>
              {formatTime(track.duration)}
            </Text>
          ) : null}
          {showQuality ? (
            <View
              style={[
                s.quality,
                { borderColor: track.quality === 'Hi-Res' ? c.gold : c.muted },
              ]}
            >
              <Text
                style={[
                  s.qualityText,
                  { color: track.quality === 'Hi-Res' ? c.gold : c.muted },
                ]}
              >
                {track.quality ?? 'SQ'}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {providerLabel ? (
        <TrackPlatformDuration track={track} color={c.muted} />
      ) : null}
    </>
  );
  return (
    <View
      style={[
        s.track,
        {
          borderBottomColor: c.line,
          minHeight: layout.trackRowHeight,
          paddingHorizontal: layout.pageHorizontalPadding - 8,
        },
        !showDivider && s.trackWithoutDivider,
        active && { backgroundColor: c.panelSoft },
      ]}
    >
      {rowPress ? (
        <Pressable
          testID={`track-body-${track.id}`}
          accessibilityRole="button"
          accessibilityLabel={`播放 ${track.title}`}
          onPress={onPlay}
          style={[s.trackBody, { minHeight: layout.trackRowHeight }]}
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
      {onFavorite ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={favorite ? '取消收藏' : '收藏'}
          onPress={onFavorite}
          style={s.smallAction}
        >
          <TrackActionIcon kind="favorite" active={favorite} size={21}
            color={favorite ? c.accent : c.text} />
        </Pressable>
      ) : null}
      {trailing}
      {showPlayButton ? (
        <Pressable
          testID={`play-${track.id}`}
          accessibilityRole="button"
          accessibilityLabel={`播放 ${track.title}`}
          onPress={onPlay}
          style={[s.playSmall, { backgroundColor: c.panelSoft }]}
        >
          <Glyph color={c.text} size={15}>
            ▶
          </Glyph>
        </Pressable>
      ) : null}
    </View>
  );
}
const glyphStyle = (size: number, color?: string) => ({
  fontSize: size,
  color: color ?? dark.text,
  fontWeight: '400' as const,
});
const tabs: { id: AppTab; icon: string; label: string }[] = [
  { id: 'discovery', icon: '⌂', label: '首页' },
  { id: 'search', icon: '⌕', label: '探索' },
  { id: 'library', icon: '♫', label: '漫游' },
  { id: 'settings', icon: '⚙', label: '我的' },
];
const fixedPlayerNav = {
  bg: 'transparent',
  line: 'transparent',
  accent: '#FFFFFF',
  muted: 'rgba(255,255,255,0.68)',
  panelSoft: 'rgba(255,255,255,0.16)',
  text: '#FFFFFF',
  playerBorder: 'rgba(255,255,255,0.72)',
};
export function BottomNav({
  attached = false,
  transparent = false,
  playerCollapsed = false,
  showPlayerHint = false,
  onShowPlayer,
}: {
  attached?: boolean;
  transparent?: boolean;
  playerCollapsed?: boolean;
  showPlayerHint?: boolean;
  onShowPlayer?: () => void;
}) {
  const app = useApp();
  const theme = useTheme();
  const layout = useLayout();
  const playerPage = ['player', 'lyrics', 'effects', 'queue'].includes(
    app.page,
  );
  const playerNavAppearance = playerPage && app.page !== 'effects';
  const miniPlayerSurface = !playerPage || app.page === 'effects';
  const transparentNav = transparent || playerNavAppearance;
  const colors = playerNavAppearance
    ? fixedPlayerNav
    : {
        bg: theme.bg,
        line: theme.line,
        accent: theme.accent,
        muted: theme.muted,
        panelSoft: theme.panelSoft,
        text: theme.text,
        playerBorder: theme.line,
      };
  const playerLabel = app.player.playing ? '暂停' : '播放';
  const pulse = useRef(new Animated.Value(0.35)).current;
  const drawerSwipe = useDrawerSwipe(
    'up',
    playerCollapsed && miniPlayerSurface ? onShowPlayer : undefined,
  );
  useEffect(() => {
    if (playerNavAppearance || !app.player.playing) {
      pulse.stopAnimation();
      pulse.setValue(0.35);
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [app.player.playing, playerNavAppearance, pulse]);
  const openOrTogglePlayer = () => {
    if (drawerSwipe.swipeActive.current) return;
    if (playerPage) {
      if (app.current) app.togglePlay();
      else app.playDefaultTrack();
      return;
    }
    if (app.current) app.open('player');
    else app.playDefaultTrack();
  };
  return (
    <View
      testID="bottom-nav"
      {...drawerSwipe.touchHandlers}
      style={[
        s.nav,
        {
          backgroundColor: transparentNav ? 'transparent' : colors.bg,
          borderTopColor: transparentNav ? 'transparent' : colors.line,
          height: layout.bottomNavHeight,
          transform: [{ translateY: -layout.bottomNavLift }],
        },
        attached && s.navAttached,
        transparentNav && s.navTransparent,
      ]}
    >
      {showPlayerHint && playerCollapsed && miniPlayerSurface && onShowPlayer ? (
        <View
          testID="bottom-player-show"
          pointerEvents="none"
          accessible={false}
          style={[s.bottomPlayerShow, { height: layout.bottomNavHeight }]}
        >
          <PlayerGestureArrow
            testID="bottom-player-show-arrow"
            direction="up"
            color={colors.accent}
            size={18}
            travel={Math.max(0, layout.bottomNavHeight / 2 - 20)}
          />
        </View>
      ) : null}
      {tabs.slice(0, 2).map(item => (
        <Pressable
          key={item.id}
          testID={`nav-${item.id}`}
          accessibilityRole="tab"
          accessibilityState={{ selected: app.tab === item.id }}
          onPress={() => {
            if (drawerSwipe.swipeActive.current) return;
            return item.id === 'discovery' &&
              app.tab === 'discovery' &&
              app.page === 'root'
              ? app.refreshHome()
              : app.setTab(item.id);
          }}
          style={[s.navItem, { minHeight: layout.bottomNavHeight }]}
          hitSlop={8}
        >
          <Text
            style={[
              s.navLabel,
              {
                color: app.tab === item.id ? colors.accent : colors.muted,
                fontSize: layout.bottomNavLabelFontSize,
              },
            ]}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
      <Pressable
        testID="nav-player"
        accessibilityRole="button"
        accessibilityLabel={playerPage ? playerLabel : '打开播放页'}
        accessibilityState={{ selected: playerPage, busy: app.player.playing }}
        onPress={openOrTogglePlayer}
        style={[s.navPlayerItem, { minHeight: layout.bottomNavHeight }]}
        hitSlop={8}
      >
        <View
          testID="nav-player-button"
          style={[
            s.navPlayerButton,
            {
              width: layout.bottomNavPlayerSize,
              height: layout.bottomNavPlayerSize,
              borderRadius: layout.bottomNavPlayerSize / 2,
            },
            {
              backgroundColor: playerNavAppearance ? 'transparent' : '#B17CFA',
              borderColor: playerNavAppearance ? colors.playerBorder : 'transparent',
            },
            ['player', 'lyrics'].includes(app.page) &&
              s.navPlayerRing,
          ]}
        >
          {playerNavAppearance ? (
            <PlayPauseIcon
              playing={app.player.playing}
              color={app.player.playing ? '#fff' : colors.text}
              size={Math.round(layout.bottomNavPlayerSize * 0.52)}
            />
          ) : app.player.playing ? (
            <View testID="nav-player-playing" style={s.navPlayerBars}>
              {[0.55, 1, 0.7].map((scale, index) => (
                <Animated.View
                  key={index}
                  style={[
                    s.navPlayerBar,
                    {
                      backgroundColor: playerPage ? colors.text : '#FFFFFF',
                      transform: [
                        {
                          scaleY: pulse.interpolate({
                            inputRange: [0.35, 1],
                            outputRange: [scale, 1],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              ))}
            </View>
          ) : (
            <PlayPauseIcon
              playing={false}
              color={playerPage ? colors.text : '#FFFFFF'}
              size={Math.round(layout.bottomNavPlayerSize * 0.52)}
            />
          )}
        </View>
      </Pressable>
      {tabs.slice(2).map(item => (
        <Pressable
          key={item.id}
          testID={`nav-${item.id}`}
          accessibilityRole="tab"
          accessibilityState={{ selected: app.tab === item.id }}
          onPress={() => {
            if (!drawerSwipe.swipeActive.current) app.setTab(item.id);
          }}
          style={[s.navItem, { minHeight: layout.bottomNavHeight }]}
          hitSlop={8}
        >
          <Text
            style={[
              s.navLabel,
              {
                color: app.tab === item.id ? colors.accent : colors.muted,
                fontSize: layout.bottomNavLabelFontSize,
              },
            ]}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function EditorialCard({
  coverKey,
  title,
  copy,
  onPress,
}: {
  coverKey: CoverKey;
  title: string;
  copy: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={s.editorial}>
      <ImageBackground
        source={covers[coverKey]}
        style={s.editorialImage}
        imageStyle={s.editorialRadius}
      >
        <View style={s.editorialShade} />
        <View style={s.editorialCopy}>
          <Text numberOfLines={1} style={s.editorialTitle}>
            {title}
          </Text>
          <Text numberOfLines={1} style={s.editorialSub}>
            {copy}
          </Text>
        </View>
        <View style={s.editorialPlay}>
          <Glyph color="#fff" size={13}>
            ▶
          </Glyph>
        </View>
      </ImageBackground>
    </Pressable>
  );
}
export function Toast() {
  const app = useApp();
  const message = app.stateStorageError || app.message;
  if (!message || (!app.stateStorageError && message.startsWith('正在'))) return null;
  return (
    <Pressable
      accessibilityRole="alert"
      onPress={app.stateStorageError ? app.clearStateStorageError : app.clearMessage}
      style={[
        s.toast,
        message === EXIT_HINT_MESSAGE ? s.toastCenter : s.toastBottom,
      ]}
    >
      <Text style={s.toastText}>
        {!app.stateStorageError && app.tab === 'settings' && /音(?:乐)?源/.test(message)
          ? sourceSettingsText(message)
          : platformDisplayText(message)}
      </Text>
    </Pressable>
  );
}
export const formatTime = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
};

const s = createThemedStyles(
  StyleSheet.create({
    referenceCrop: { overflow: 'hidden' },
    referenceImage: { position: 'absolute', width: 420, height: 932.5 },
    brandBar: {
      height: 41,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    brandLockup: { flexDirection: 'row', alignItems: 'center' },
    brandMark: {
      width: 21,
      height: 21,
      borderRadius: 6,
      marginRight: 6,
      backgroundColor: light.blue,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandNote: { color: '#fff', fontSize: 14, fontWeight: '400' },
    brandName: {
      color: light.blue,
      fontFamily: serif,
      fontSize: 14,
      fontWeight: '400',
    },
    brandActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    roundAction: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: light.panelSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    header: {
      minHeight: 82,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 18,
    },
    headerButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerCopy: { flex: 1 },
    headerTitle: { fontSize: 30, fontWeight: '400', letterSpacing: 0.1 },
    headerSub: { marginTop: 5, fontSize: 14, lineHeight: 20 },
    section: {
      height: 27,
      marginTop: 0,
      marginBottom: 0,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
    },
    sectionText: { flex: 1, fontSize: 18, fontWeight: '400' },
    sectionActionButton: {
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 8,
    },
    sectionAction: { fontSize: 14, fontWeight: '400' },
    sectionActionArrowOnly: { fontSize: 30, lineHeight: 34, fontWeight: '500' },
    track: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    trackWithoutDivider: { borderBottomWidth: 0 },
    trackBody: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
    },
    trackIndex: { width: 24, fontSize: 13 },
    trackCopy: { flex: 1, minWidth: 0, marginLeft: 11 },
    trackTitle: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
    trackMetaLine: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
    trackMeta: { flex: 1, minWidth: 0, fontSize: 12 },
    duration: { marginLeft: 7, fontSize: 11 },
    trackDurationColumn: {
      marginLeft: 7,
      alignSelf: 'center',
      flexShrink: 0,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    trackProvider: { fontSize: 11, lineHeight: 15, fontWeight: '400' },
    trackProviderDuration: { fontSize: 11, lineHeight: 15 },
    quality: {
      marginLeft: 7,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderWidth: 1,
      borderRadius: 3,
    },
    qualityText: { fontSize: 9, fontWeight: '400' },
    smallAction: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    playSmall: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 1,
    },
    nav: {
      height: BOTTOM_NAV_HEIGHT,
      flexDirection: 'row',
      marginHorizontal: 0,
      borderRadius: 0,
      transform: [{ translateY: -BOTTOM_NAV_LIFT }],
      borderTopWidth: 0,
      paddingBottom: 3,
      shadowColor: '#14284A',
      shadowOpacity: 0.09,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 5 },
      elevation: 8,
    },
    navAttached: { borderTopWidth: 0 },
    navTransparent: {
      backgroundColor: 'transparent',
      shadowOpacity: 0,
      elevation: 0,
    },
    bottomPlayerShow: {
      position: 'absolute',
      top: 0,
      left: '50%',
      width: 44,
      marginLeft: -22,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 30,
    },
    navItem: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navPlayerItem: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navPlayerButton: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 0,
      shadowColor: '#9D6CF4',
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: 5,
    },
    navPlayerRing: {
      borderWidth: 1,
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    navPlayerBars: {
      height: 24,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    navPlayerBar: {
      width: 3,
      height: 18,
      borderRadius: 2,
      backgroundColor: light.text,
    },
    navLabel: { fontSize: 18, marginTop: 1, fontWeight: '400' },
    editorial: {
      width: 190,
      height: 178,
      marginLeft: 18,
      borderRadius: 12,
      overflow: 'hidden',
    },
    editorialImage: { flex: 1, justifyContent: 'flex-end' },
    editorialRadius: { borderRadius: 12 },
    editorialShade: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: 'rgba(0,0,0,.18)',
    },
    editorialCopy: { padding: 12, backgroundColor: 'rgba(7,12,14,.72)' },
    editorialTitle: { color: '#fff', fontSize: 15, fontWeight: '400' },
    editorialSub: { color: '#C3CFD7', fontSize: 12, marginTop: 4 },
    editorialPlay: {
      position: 'absolute',
      right: 10,
      bottom: 14,
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: 'rgba(255,255,255,.28)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    toast: {
      position: 'absolute',
      alignSelf: 'center',
      maxWidth: 280,
      minWidth: 132,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,.14)',
      borderRadius: 12,
      backgroundColor: 'rgba(17,25,29,.72)',
      zIndex: 30,
    },
    toastBottom: { bottom: 136 },
    toastCenter: {
      top: '50%',
      transform: [{ translateY: -24 }],
    },
    toastText: {
      color: '#fff',
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
    },
  }),
);
