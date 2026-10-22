import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { useApp } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { useTheme } from '../theme';
import { Cover, Glyph } from './UI';
import { PlayerGestureArrow } from './PlayerGestureArrow';
import { useDrawerSwipe } from './useDrawerSwipe';
import { useLibraryTrackArtwork } from './useLibraryTrackArtwork';
import { enrichTrackPresentation } from '../services/onlineCatalog';
import { TrackActionIcon } from './TrackActionIcon';

export function HomePlayerBar({
  onHide,
  showHideHint = false,
  showPreviousHint = false,
  showNextHint = false,
  onNavigate,
}: {
  onHide?: () => void;
  showHideHint?: boolean;
  showPreviousHint?: boolean;
  showNextHint?: boolean;
  onNavigate?: (
    direction: 'previous' | 'next',
    action: () => Promise<void>,
  ) => void;
} = {}) {
  const app = useApp();
  const layout = useLayout();
  const c = useTheme();
  const titleSwipeStart = useRef({ x: 0, y: 0 });
  const titleSwipeAt = useRef(0);
  const swipeGestureActive = useRef(false);
  const [informationWidth, setInformationWidth] = useState(0);
  const track = app.current;
  const localArtwork = useLibraryTrackArtwork(
    track,
    app.recommendationPlatforms,
  );
  const drawerSwipe = useDrawerSwipe('down', onHide);
  if (!track) return null;
  const presentation = enrichTrackPresentation(track);
  const miniIconSize = Math.round(layout.miniPlayerActionWidth * 0.6);
  // Keep the raised cover inside every native hit rectangle, while painting
  // the original bar height at its original bottom position.
  const coverOverflow = Math.ceil(
    Math.max(
      0,
      (layout.miniPlayerCoverSize - layout.miniPlayerHeight) / 2 +
        Math.round(layout.miniPlayerCoverSize * 0.05),
    ),
  );
  const coverBottomOverflow = Math.ceil(
    Math.max(
      0,
      (layout.miniPlayerCoverSize - layout.miniPlayerHeight) / 2 -
        Math.round(layout.miniPlayerCoverSize * 0.05),
    ),
  );
  const hitHeight =
    layout.miniPlayerHeight + coverOverflow + coverBottomOverflow;
  const guideLeft = layout.miniPlayerCoverSize + 12;
  const horizontalTravel = Math.max(0, informationWidth - guideLeft - 24);
  const favorite = app.isFavorite(track);
  const progress = Math.min(
    100,
    (app.player.position / Math.max(1, app.player.duration)) * 100,
  );
  const openPlayer = () => {
    if (
      swipeGestureActive.current ||
      drawerSwipe.swipeActive.current ||
      Date.now() - titleSwipeAt.current < 500
    )
      return;
    app.open('player');
  };
  const handleTitleTouchStart = (event: any) => {
    swipeGestureActive.current = false;
    titleSwipeStart.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
    };
  };
  const handleTitleTouchMove = (event: any) => {
    const dx = event.nativeEvent.pageX - titleSwipeStart.current.x;
    const dy = event.nativeEvent.pageY - titleSwipeStart.current.y;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy))
      swipeGestureActive.current = true;
  };
  const handleTitleTouchEnd = (event: any) => {
    const dx = event.nativeEvent.pageX - titleSwipeStart.current.x;
    const dy = event.nativeEvent.pageY - titleSwipeStart.current.y;
    if (Math.abs(dx) < 32 || Math.abs(dx) <= Math.abs(dy)) return;
    titleSwipeAt.current = Date.now();
    const direction = dx < 0 ? 'next' : 'previous';
    const action = direction === 'next' ? app.next : app.previous;
    if (onNavigate) onNavigate(direction, action);
    else void action().catch(() => undefined);
  };

  return (
    <>
      <View testID="mini-player-drawer" {...drawerSwipe.touchHandlers}>
        <View
          testID="mini-player"
          style={[
            s.hitRow,
            {
              height: hitHeight,
              paddingHorizontal: layout.pageHorizontalPadding,
            },
          ]}
        >
          <View
            testID="mini-player-background"
            pointerEvents="none"
            style={[
              s.bar,
              s.barBackground,
              {
                backgroundColor: c.bg,
                height: layout.miniPlayerHeight,
                bottom: coverBottomOverflow,
              },
            ]}
          />
          <Pressable
            testID="home-player-open"
            accessibilityRole="button"
            accessibilityLabel="歌曲信息，可左右滑动切换上一曲或下一曲，点击打开播放页"
            accessibilityHint="在封面、标题、歌手或进度条区域左右滑动切换歌曲"
            onPress={openPlayer}
            onTouchStart={handleTitleTouchStart}
            onTouchMove={handleTitleTouchMove}
            onTouchEnd={handleTitleTouchEnd}
            onTouchCancel={() => {
              swipeGestureActive.current = true;
            }}
            onLayout={event =>
              setInformationWidth(event.nativeEvent.layout.width)
            }
            style={[
              s.openPlayer,
              {
                height: hitHeight,
                paddingTop: coverOverflow,
                paddingBottom: coverBottomOverflow,
              },
            ]}
          >
            <View
              testID="home-player-cover"
              style={[
                s.cover,
                {
                  width: layout.miniPlayerCoverSize,
                  height: layout.miniPlayerCoverSize,
                  transform: [
                    {
                      translateY: -Math.round(
                        layout.miniPlayerCoverSize * 0.05,
                      ),
                    },
                  ],
                },
              ]}
            >
              <Cover
                coverKey={track.coverKey}
                uri={localArtwork.uri ?? track.cover}
                fallbackUris={localArtwork.fallbackUris}
                onExhausted={localArtwork.onExhausted}
                moduleKey="mini-player-current"
                priority="player"
                testID="mini-player-current-cover"
                size={layout.miniPlayerCoverSize}
                radius={10}
              />
            </View>
            <View style={s.copy}>
              <Text
                numberOfLines={1}
                style={[
                  s.title,
                  {
                    color: c.text,
                    fontSize: layout.miniPlayerTitleFontSize,
                    lineHeight: layout.miniPlayerTitleLineHeight,
                  },
                ]}
              >
                {presentation.title}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  s.artist,
                  {
                    color: c.muted,
                    fontSize: layout.miniPlayerArtistFontSize,
                    lineHeight: layout.miniPlayerArtistLineHeight,
                  },
                ]}
              >
                {presentation.artist}
              </Text>
              <View
                style={[
                  s.progressTrack,
                  {
                    backgroundColor: c.line,
                    height: layout.miniPlayerProgressHeight,
                    marginTop: Math.max(
                      1,
                      Math.round(layout.miniPlayerProgressHeight * 2),
                    ),
                  },
                ]}
              >
                <View
                  testID="home-player-progress"
                  style={[
                    s.progress,
                    {
                      backgroundColor: c.blue,
                      width: `${progress}%`,
                      height: layout.miniPlayerProgressHeight,
                    },
                  ]}
                />
              </View>
            </View>
            {showPreviousHint || showNextHint ? (
              <View
                testID="mini-player-swipe-hints"
                pointerEvents="none"
                style={[
                  s.swipeHints,
                  {
                    left: guideLeft,
                    top: coverOverflow,
                    bottom: coverBottomOverflow,
                  },
                ]}
              >
                {showNextHint ? (
                  <View
                    style={[
                      s.horizontalGuideOrigin,
                      { left: horizontalTravel },
                    ]}
                  >
                    <PlayerGestureArrow
                      testID="mini-player-swipe-left"
                      direction="left"
                      color={c.accent}
                      size={20}
                      travel={horizontalTravel}
                    />
                  </View>
                ) : null}
                {showPreviousHint ? (
                  <View style={s.horizontalGuideOrigin}>
                    <PlayerGestureArrow
                      testID="mini-player-swipe-right"
                      direction="right"
                      color={c.accent}
                      size={20}
                      travel={horizontalTravel}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
            {showHideHint && onHide ? (
              <View
                testID="bottom-player-hide"
                pointerEvents="none"
                style={[
                  s.hideGuide,
                  {
                    top: coverOverflow + 2,
                    left: guideLeft,
                    height: layout.miniPlayerHeight - 4,
                  },
                ]}
              >
                <PlayerGestureArrow
                  testID="bottom-player-hide-arrow"
                  direction="down"
                  color={c.accent}
                  size={20}
                  travel={Math.max(0, layout.miniPlayerHeight - 24)}
                />
              </View>
            ) : null}
          </Pressable>
          <View
            testID="home-player-actions"
            style={[
              s.actions,
              {
                height: layout.miniPlayerHeight,
                marginBottom: coverBottomOverflow,
              },
            ]}
          >
            <Pressable
              testID="home-player-favorite"
              accessibilityRole="button"
              accessibilityLabel={favorite ? '取消收藏' : '收藏'}
              accessibilityState={{ selected: favorite }}
              onPress={() => {
                if (!drawerSwipe.swipeActive.current) app.toggleFavorite(track);
              }}
              style={[
                s.action,
                {
                  width: layout.miniPlayerActionWidth,
                  height: layout.miniPlayerActionHeight,
                },
              ]}
            >
              <TrackActionIcon kind="favorite" active={favorite} size={miniIconSize}
                color={favorite ? c.accent : c.text} />
            </Pressable>
            <Pressable
              testID="mini-toggle"
              accessibilityRole="button"
              accessibilityLabel={app.player.playing ? '暂停' : '播放'}
              onPress={() => {
                if (!drawerSwipe.swipeActive.current) app.togglePlay();
              }}
              style={[
                s.action,
                {
                  width: layout.miniPlayerActionWidth,
                  height: layout.miniPlayerActionHeight,
                },
              ]}
            >
              <Svg
                width={miniIconSize}
                height={miniIconSize}
                viewBox="0 0 24 24"
              >
                {app.player.playing ? (
                  <Path
                    d="M8 5v14M16 5v14"
                    stroke={c.text}
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                ) : (
                  <Path
                    d="m8 4 12 8-12 8Z"
                    fill={c.text}
                    strokeLinejoin="round"
                  />
                )}
              </Svg>
            </Pressable>
            <Pressable
              testID="home-player-queue"
              accessibilityRole="button"
              accessibilityLabel="播放列表"
              accessibilityState={{ expanded: app.queueListOpen }}
              onPress={() => {
                if (!drawerSwipe.swipeActive.current)
                  app.setQueueListOpen(true);
              }}
              style={[
                s.action,
                {
                  width: layout.miniPlayerActionWidth,
                  height: layout.miniPlayerActionHeight,
                },
              ]}
            >
              <Svg
                width={miniIconSize}
                height={miniIconSize}
                viewBox="0 0 24 24"
              >
                {[6, 12, 18].map(y => (
                  <Line
                    key={y}
                    x1={4}
                    x2={20}
                    y1={y}
                    y2={y}
                    stroke={c.text}
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                ))}
              </Svg>
            </Pressable>
          </View>
        </View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  hitRow: { flexDirection: 'row', alignItems: 'flex-end' },
  barBackground: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  hideGuide: { position: 'absolute', right: 4, alignItems: 'center' },
  bar: {
    height: 52,
    marginHorizontal: 0,
    borderRadius: 0,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(111, 126, 164, 0.16)',
    shadowColor: '#24355D',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  openPlayer: {
    flex: 1,
    minWidth: 0,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    zIndex: 1,
    elevation: 3,
  },
  cover: { width: 58, height: 58, transform: [{ translateY: -3 }] },
  copy: { flex: 1, minWidth: 0, marginLeft: 9, marginRight: 5 },
  title: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  artist: { fontSize: 11, lineHeight: 15, marginTop: 1 },
  progressTrack: { height: 1.5, marginTop: 3 },
  progress: { height: 1.5 },
  swipeHints: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 4,
    justifyContent: 'center',
  },
  horizontalGuideOrigin: { position: 'absolute', left: 0 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
    elevation: 3,
  },
  action: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
