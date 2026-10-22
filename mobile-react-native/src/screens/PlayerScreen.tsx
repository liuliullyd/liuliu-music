import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { covers } from '../assets/covers';
import { getSelectedHomeMenuChoice } from '../components/HomeMenuDrawer';
import { ListPagingFooter } from '../components/ListPaging';
import {
  OrderedCoverBatch,
  OrderedCoverScope,
  OrderedRemoteCover,
} from '../components/OrderedRemoteCover';
import { PlaybackModePicker } from '../components/PlaybackModePicker';
import { PlayerQueueButton } from '../components/PlayerQueueButton';
import { QueueOrderButton } from '../components/QueueOrderButton';
import { QueueTrackActions } from '../components/QueueTrackActions';
import { AppHeader, Cover, Glyph, TrackRow } from '../components/UI';
import { useLibraryTrackArtwork } from '../components/useLibraryTrackArtwork';
import { usePlaybackListFollow } from '../components/usePlaybackListFollow';
import { useQueueListPrefetch } from '../components/useQueueListPrefetch';
import {
  playbackQualityOptions,
  trackQueueKey,
  type PlaybackQuality,
} from '../domain/types';
import { localPlaybackReference } from '../services/libraryPlayback';
import { mediaPlaybackKey } from '../services/mediaPlaybackProgress';
import { playbackNetworkQuality } from '../services/networkQuality';
import {
  enrichTrackPresentation,
  playerCoverCandidates,
  trackCoverCandidates,
} from '../services/onlineCatalog';
import {
  getCachedTrackLyrics,
  getTrackLyrics,
  searchOnline,
  trackLyricsKey,
  type LyricLine,
} from '../services/onlineMusic';
import {
  playerForegroundForTone,
  preloadPlayerArtworkTone,
  usePlayerBackdropSurfaceTone,
} from '../services/playerAppearance';
import { subscribePlayerLyrics } from '../services/playerLyrics';
import { playerQuality } from '../services/playerQuality';
import { useApp } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { createThemedStyles, serif } from '../theme';
import { EffectsScreen } from './EffectsScreen';
type PlayerTrack = NonNullable<ReturnType<typeof useApp>['current']>;
const supplementalPlayerCovers = new Map<string, string[]>();
const pendingPlayerCovers = new Map<string, Promise<string[]>>();
const isSpokenMediaPresentation = (track: Pick<PlayerTrack, 'metadata'>) => {
  const mediaType = String(track.metadata?.mediaType ?? '').toLowerCase();
  return mediaType === 'long-audio';
};
function withAlpha(hex: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return `rgba(78,59,54,${alpha})`;
  const value = parseInt(match[1]!, 16);
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${alpha})`;
}
function formatTime(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(
    2,
    '0',
  )}`;
}
const PROGRESS_WAVE_HEIGHT = 8;
const PROGRESS_WAVE_CYCLE = 36;
// The motion viewport is twice this width. Keep two complete path bands so
// translating the wave never exposes an empty right half after 50% progress.
const PROGRESS_WAVE_WIDTH = PROGRESS_WAVE_CYCLE * 12;
const PROGRESS_WAVE_PATH = `M 0 4 ${Array.from(
  { length: (PROGRESS_WAVE_WIDTH * 2) / PROGRESS_WAVE_CYCLE },
  (_, index) => {
    const start = index * PROGRESS_WAVE_CYCLE;
    const middle = start + PROGRESS_WAVE_CYCLE / 2;
    const end = start + PROGRESS_WAVE_CYCLE;
    return `Q ${start + PROGRESS_WAVE_CYCLE / 4} 0 ${middle} 4 Q ${
      middle + PROGRESS_WAVE_CYCLE / 4
    } 8 ${end} 4`;
  },
).join(' ')}`;
const playerCoverFallbacks = (track: PlayerTrack) =>
  playerCoverCandidates(track);
const normalizedMatchText = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[\s\u3000'"“”‘’·•,，.。!！?？:：/\\|、()[\]{}<>《》]/g, '');
/** Search results are presentation metadata only; accept a cover only when the
 * provider and the song identity still match the playing track. */
export const isMatchingCoverTrack = (
  source: PlayerTrack,
  candidate: PlayerTrack,
) => {
  if (source.provider !== candidate.provider) return false;
  const sourceTitle = normalizedMatchText(source.title);
  const candidateTitle = normalizedMatchText(candidate.title);
  const sourceArtist = normalizedMatchText(source.artist);
  const candidateArtist = normalizedMatchText(candidate.artist);
  if (!sourceTitle || !candidateTitle || sourceTitle !== candidateTitle) {
    return false;
  }
  if (sourceArtist && candidateArtist && sourceArtist !== candidateArtist) {
    return false;
  }
  const sourceDuration = Number(source.duration);
  const candidateDuration = Number(candidate.duration);
  return (
    !sourceDuration ||
    !candidateDuration ||
    Math.abs(sourceDuration - candidateDuration) <= 12
  );
};
function usePlayerCover(track: PlayerTrack | null, enabled = true) {
  const requestKey = useRef('');
  const requestGeneration = useRef(0);
  const presentation = useMemo(
    () => (track ? enrichTrackPresentation(track) : null),
    [track],
  );
  const metadataCandidates = useMemo(
    () => (track ? playerCoverFallbacks(track) : []),
    [track],
  );
  const metadataKey = metadataCandidates.join('|');
  const trackKey = track
    ? `${track.provider}:${track.providerId ?? track.id}`
    : '';
  const [supplemental, setSupplemental] = useState(() => ({
    key: trackKey,
    uris: supplementalPlayerCovers.get(trackKey) ?? [],
  }));
  const requestSupplement = useCallback(() => {
    if (!enabled || !track || !presentation || requestKey.current === trackKey)
      return;
    const generation = requestGeneration.current;
    requestKey.current = trackKey;
    let pending = pendingPlayerCovers.get(trackKey);
    if (!pending) {
      pending = searchOnline(
        `${presentation.title} ${presentation.artist}`.trim(),
        1,
        8,
        track.provider,
      )
        .then(result => {
          const match = result.tracks.find(candidate =>
            isMatchingCoverTrack(track, candidate as PlayerTrack),
          );
          if (!match) return [];
          const candidates = playerCoverFallbacks(match as PlayerTrack);
          if (candidates.length) {
            supplementalPlayerCovers.set(trackKey, candidates);
            if (supplementalPlayerCovers.size > 64)
              supplementalPlayerCovers.delete(
                supplementalPlayerCovers.keys().next().value!,
              );
          }
          return candidates;
        })
        .catch(() => [] as string[])
        .finally(() => pendingPlayerCovers.delete(trackKey));
      pendingPlayerCovers.set(trackKey, pending);
    }
    void pending.then(uris => {
      if (requestGeneration.current === generation)
        setSupplemental({ key: trackKey, uris });
    });
  }, [enabled, presentation, track, trackKey]);
  useEffect(() => {
    requestGeneration.current += 1;
    setSupplemental({
      key: trackKey,
      uris: supplementalPlayerCovers.get(trackKey) ?? [],
    });
    requestKey.current = '';
    if (
      !track ||
      metadataCandidates.length ||
      supplementalPlayerCovers.has(trackKey)
    )
      return;
    requestSupplement();
  }, [
    metadataCandidates.length,
    metadataKey,
    requestSupplement,
    track,
    trackKey,
  ]);
  const candidates = Array.from(
    new Set([
      ...metadataCandidates,
      ...(supplemental.key === trackKey
        ? supplemental.uris
        : supplementalPlayerCovers.get(trackKey) ?? []),
    ]),
  );
  return {
    uri: candidates[0],
    fallbackUris: candidates.slice(1),
    onExhausted: requestSupplement,
  };
}
export function PlayerScreen() {
  const app = useApp();
  if (app.page === 'lyrics') return <Lyrics />;
  if (app.page === 'effects') return <Effects />;
  if (app.page === 'queue') return <Queue />;
  return <NowPlaying />;
}
function NowPlaying() {
  const app = useApp(),
    layout = useLayout(),
    appTrack = app.current;
  const insets = useSafeAreaInsets();
  const progressTouchActive = useRef(false);
  const swipeY = useRef(new Animated.Value(0)).current;
  const pageSlotsRef = useRef(new Map<string, number>());
  const visualSlotRef = useRef(0);
  const restingYRef = useRef(0);
  const gestureBaseYRef = useRef(0);
  const appRef = useRef(app);
  appRef.current = app;
  const [stageHeight, setStageHeight] = useState(0);
  const [previewTrack, setPreviewTrack] = useState<PlayerTrack | null>(null);
  const [fallbackPage, setFallbackPage] = useState<{
    track: PlayerTrack;
    index: number;
    slot: number;
    token: number;
  } | null>(null);
  const committedFallback = useRef<{
    key: string;
    token: number;
  } | null>(null);
  const resetFallbackPage = useCallback(() => {
    committedFallback.current = null;
    setFallbackPage(null);
  }, []);
  const pageTopInset = insets.top / layout.scale;
  const pageBottomInset = layout.bottomNavHeight + insets.bottom / layout.scale;
  const previewTrackRef = useRef<PlayerTrack | null>(null);
  const previewDirectionRef = useRef<-1 | 1>(-1);
  const visualTrackRef = useRef<PlayerTrack | null>(appTrack);
  const visualIndexRef = useRef(app.player.index);
  const outgoingTrackKeys = useRef(new Set<string>());
  const pagerToken = useRef(0);
  const transitionActive = useRef(false);
  const transitionTargetRef = useRef<{
    track: PlayerTrack;
    index: number;
    slot: number;
    token: number;
  } | null>(null);
  const transitionAnimationDone = useRef(false);
  const transitionNavigationDone = useRef(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  // Keep the outgoing page mounted while the native target is resolving and
  // the swipe animation is running. The target preview is promoted only when
  // settleTransition has both the accepted target and the finished animation.
  const track =
    transitionActive.current ||
    Boolean(appTrack && outgoingTrackKeys.current.has(trackQueueKey(appTrack)))
      ? visualTrackRef.current ?? appTrack
      : appTrack;
  const appPage = app.page;
  const queueListOpen = app.queueListOpen;
  const setPlayerOverlayOpen = app.setPlayerOverlayOpen;
  useEffect(() => {
    setPlayerOverlayOpen(timerOpen || qualityOpen);
    return () => setPlayerOverlayOpen(false);
  }, [qualityOpen, setPlayerOverlayOpen, timerOpen]);
  const duration = app.player.duration || track?.duration || 0,
    coverSize = layout.playerCoverSize;
  const backdropTone = usePlayerBackdropSurfaceTone(track, true);
  const foreground = playerForegroundForTone(backdropTone);
  const actualQuality = playerQuality(track);
  const visualKey = track ? trackQueueKey(track) : '';
  const queueIndex = app.queue.findIndex(
    item => trackQueueKey(item) === visualKey,
  );
  const centerIndex = queueIndex >= 0 ? queueIndex : visualIndexRef.current;
  const qualitySwitching = app.busy && app.message.startsWith('正在切换音质');
  // A page includes the transparent bars. Giving every page this same pitch
  // avoids overlapping sampled-colour extensions at the top and bottom.
  const stageExtent = Math.max(1, stageHeight + pageTopInset + pageBottomInset);
  const stageExtentRef = useRef(stageExtent);
  stageExtentRef.current = stageExtent;
  // Retained pages keep their coordinates when the current role changes.
  // Native animation commands and React layout commits are not atomic, so
  // rebasing all pages while resetting the transform can reveal next-next.
  const centerSlot =
    pageSlotsRef.current.get(visualKey) ?? visualSlotRef.current;
  const pages = new Map<
    string,
    {
      track: PlayerTrack;
      offset: number;
      slot: number;
    }
  >();
  for (const offset of [0, 1, 2, -1]) {
    const item = offset === 0 ? track : app.queue[centerIndex + offset];
    if (item && !pages.has(trackQueueKey(item)))
      pages.set(trackQueueKey(item), {
        track: item,
        offset,
        slot: centerSlot + offset,
      });
  }
  if (
    fallbackPage &&
    transitionActive.current &&
    fallbackPage.token === pagerToken.current
  ) {
    const fallbackKey = trackQueueKey(fallbackPage.track);
    pages.set(fallbackKey, {
      track: fallbackPage.track,
      offset:
        pages.get(fallbackKey)?.offset ?? fallbackPage.index - centerIndex,
      slot: fallbackPage.slot,
    });
  }
  pageSlotsRef.current = new Map(
    [...pages].map(([key, page]) => [key, page.slot]),
  );
  const orderedPages = [...pages].sort((a, b) => a[1].slot - b[1].slot);
  const swipeTransform = swipeY;
  const settleTransition = useCallback(() => {
    const pending = transitionTargetRef.current;
    if (
      !pending ||
      !transitionAnimationDone.current ||
      !transitionNavigationDone.current ||
      pending.token !== pagerToken.current
    )
      return;
    const live = appRef.current.current;
    if (
      !live ||
      // A native index may arrive before the matching display metadata.
      // Keep the already warmed preview instead of revealing the old song.
      outgoingTrackKeys.current.has(trackQueueKey(live))
    )
      return;
    const slot = pageSlotsRef.current.get(trackQueueKey(live)) ?? pending.slot;
    if (
      trackQueueKey(live) !== trackQueueKey(pending.track) &&
      (committedFallback.current?.key !== trackQueueKey(live) ||
        committedFallback.current.token !== pending.token)
    ) {
      setFallbackPage({
        track: live,
        index: appRef.current.player.index,
        slot,
        token: pending.token,
      });
      return;
    }
    visualTrackRef.current = live;
    visualIndexRef.current = appRef.current.player.index;
    visualSlotRef.current = slot;
    restingYRef.current = -slot * stageExtentRef.current;
    // A bounded playback fallback may accept a different page. Ordinary
    // promotion leaves the finished native offset and page positions intact.
    if (trackQueueKey(live) !== trackQueueKey(pending.track))
      swipeY.setValue(restingYRef.current);
    outgoingTrackKeys.current.clear();
    transitionTargetRef.current = null;
    transitionAnimationDone.current = false;
    transitionNavigationDone.current = false;
    previewTrackRef.current = null;
    setPreviewTrack(null);
    transitionActive.current = false;
    resetFallbackPage();
  }, [resetFallbackPage, swipeY]);
  useLayoutEffect(() => {
    if (
      !fallbackPage ||
      fallbackPage.token !== pagerToken.current ||
      !transitionActive.current
    )
      return;
    committedFallback.current = {
      key: trackQueueKey(fallbackPage.track),
      token: fallbackPage.token,
    };
    settleTransition();
  }, [fallbackPage, settleTransition]);
  useEffect(() => {
    // A selection made from the shared queue can supersede an unfinished
    // player swipe while the logical current item is still the outgoing one.
    // The queue surface is the explicit owner of that selection; release the
    // old animation immediately instead of waiting for its stale navigation.
    const pending = transitionTargetRef.current;
    const live = appRef.current.current;
    if (
      transitionActive.current &&
      pending &&
      live &&
      (queueListOpen || appPage === 'queue') &&
      outgoingTrackKeys.current.has(trackQueueKey(live)) &&
      trackQueueKey(live) !== trackQueueKey(pending.track)
    ) {
      visualTrackRef.current = live;
      visualIndexRef.current = appRef.current.player.index;
      visualSlotRef.current =
        pageSlotsRef.current.get(trackQueueKey(live)) ?? visualSlotRef.current;
      restingYRef.current = -visualSlotRef.current * stageExtent;
      swipeY.stopAnimation();
      swipeY.setValue(restingYRef.current);
      outgoingTrackKeys.current.clear();
      transitionTargetRef.current = null;
      transitionAnimationDone.current = false;
      transitionNavigationDone.current = false;
      previewTrackRef.current = null;
      setPreviewTrack(null);
      transitionActive.current = false;
      resetFallbackPage();
    }
    if (transitionActive.current) {
      settleTransition();
    } else if (
      !appTrack ||
      !outgoingTrackKeys.current.has(trackQueueKey(appTrack))
    ) {
      visualTrackRef.current = track;
      visualIndexRef.current = appRef.current.player.index;
      visualSlotRef.current = centerSlot;
      const restingY = -centerSlot * stageExtent;
      if (restingY !== restingYRef.current) {
        restingYRef.current = restingY;
        swipeY.setValue(restingY);
      }
      outgoingTrackKeys.current.clear();
    }
  }, [
    app.player.index,
    appTrack,
    appPage,
    centerSlot,
    settleTransition,
    stageExtent,
    swipeY,
    track,
    queueListOpen,
    resetFallbackPage,
  ]);
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        !progressTouchActive.current &&
        Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) > 12,
      onPanResponderGrant: () => {
        const pending = transitionTargetRef.current;
        if (pending) {
          visualTrackRef.current = pending.track;
          visualIndexRef.current = pending.index;
          visualSlotRef.current = pending.slot;
        }
        pagerToken.current += 1;
        transitionActive.current = false;
        resetFallbackPage();
        swipeY.stopAnimation();
        gestureBaseYRef.current =
          -visualSlotRef.current * stageExtentRef.current;
        restingYRef.current = gestureBaseYRef.current;
        swipeY.setValue(gestureBaseYRef.current);
        transitionTargetRef.current = null;
        transitionAnimationDone.current = false;
        transitionNavigationDone.current = false;
        previewTrackRef.current = null;
        setPreviewTrack(null);
      },
      onPanResponderMove: (_, gesture) => {
        const { dx, dy } = gesture;
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
          const direction = dy < 0 ? -1 : 1;
          const targetIndex = visualIndexRef.current + (direction < 0 ? 1 : -1);
          const target = appRef.current.queue[targetIndex] ?? null;
          if (
            direction !== previewDirectionRef.current ||
            target?.id !== previewTrackRef.current?.id
          ) {
            previewDirectionRef.current = direction;
            previewTrackRef.current = target;
            setPreviewTrack(target);
          }
          swipeY.setValue(
            gestureBaseYRef.current +
              Math.max(
                -stageExtentRef.current,
                Math.min(stageExtentRef.current, dy),
              ),
          );
        }
      },
      onPanResponderRelease: (_, gesture) => {
        const dx = gesture.dx;
        const dy = gesture.dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 64) {
          previewTrackRef.current = null;
          setPreviewTrack(null);
          Animated.spring(swipeY, {
            toValue: restingYRef.current,
            useNativeDriver: true,
            tension: 80,
            friction: 9,
          }).start();
          return;
        }
        if (Math.abs(dx) > Math.abs(dy)) {
          swipeY.setValue(restingYRef.current);
          previewTrackRef.current = null;
          setPreviewTrack(null);
          if (dx < 0) appRef.current.open('lyrics');
          else appRef.current.open('effects');
          return;
        }
        const direction = dy < 0 ? -1 : 1;
        const currentIndex = visualIndexRef.current;
        const targetIndex = currentIndex + (direction < 0 ? 1 : -1);
        const target = appRef.current.queue[targetIndex] ?? null;
        if (!target) {
          swipeY.setValue(restingYRef.current);
          previewTrackRef.current = null;
          setPreviewTrack(null);
          // The first queue entry has no previous target.  Treat this as a
          // synchronous edge bounce instead of entering the shared async
          // navigation path (which stops the provider even though there is no
          // song to load and can leave the gesture locked on a slow native
          // stop).  The queue-bottom `next()` path remains asynchronous so it
          // can request the next page as before.
          if (direction > 0) {
            transitionActive.current = false;
            Animated.spring(swipeY, {
              toValue: restingYRef.current,
              useNativeDriver: true,
              tension: 80,
              friction: 9,
            }).start();
            return;
          }
          const change =
            direction < 0 ? appRef.current.next : appRef.current.previous;
          const token = ++pagerToken.current;
          void change()
            .catch(() => undefined)
            .finally(() => {
              if (token !== pagerToken.current) return;
              transitionActive.current = false;
            });
          return;
        }
        const token = ++pagerToken.current;
        const targetSlot =
          pageSlotsRef.current.get(trackQueueKey(target)) ??
          visualSlotRef.current + (direction < 0 ? 1 : -1);
        const exitY = -targetSlot * stageExtentRef.current;
        for (const outgoing of [visualTrackRef.current, appRef.current.current])
          if (outgoing) outgoingTrackKeys.current.add(trackQueueKey(outgoing));
        // Reversing a pending swipe intentionally targets an earlier page.
        outgoingTrackKeys.current.delete(trackQueueKey(target));
        transitionActive.current = true;
        transitionTargetRef.current = {
          track: target,
          index: targetIndex,
          slot: targetSlot,
          token,
        };
        transitionAnimationDone.current = false;
        transitionNavigationDone.current = false;
        previewDirectionRef.current = direction;
        previewTrackRef.current = target;
        setPreviewTrack(target);
        const change =
          direction < 0 ? appRef.current.next : appRef.current.previous;
        const navigation = change();
        Animated.timing(swipeY, {
          toValue: exitY,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished || token !== pagerToken.current) return;
          transitionAnimationDone.current = true;
          settleTransition();
        });
        navigation.then(
          () => {
            if (token !== pagerToken.current) return;
            // Publication of the accepted native target and animation
            // completion release the preview.  The navigation promise is the
            // accepted target gate; the earlier metadata publication only
            // changes the logical index and may still be followed by a
            // failed-target fallback.
            transitionNavigationDone.current = true;
            settleTransition();
          },
          () => {
            if (token !== pagerToken.current || !transitionActive.current)
              return;
            const live = appRef.current.current;
            outgoingTrackKeys.current.clear();
            visualTrackRef.current = live;
            visualIndexRef.current = appRef.current.player.index;
            visualSlotRef.current = live
              ? pageSlotsRef.current.get(trackQueueKey(live)) ??
                visualSlotRef.current
              : visualSlotRef.current;
            restingYRef.current =
              -visualSlotRef.current * stageExtentRef.current;
            transitionTargetRef.current = null;
            transitionAnimationDone.current = false;
            transitionNavigationDone.current = false;
            previewTrackRef.current = null;
            setPreviewTrack(null);
            transitionActive.current = false;
            resetFallbackPage();
            Animated.spring(swipeY, {
              toValue: restingYRef.current,
              useNativeDriver: true,
              tension: 80,
              friction: 9,
            }).start();
          },
        );
      },
      onPanResponderTerminate: () => {
        pagerToken.current += 1;
        transitionActive.current = false;
        resetFallbackPage();
        const live = appRef.current.current;
        if (live) {
          visualTrackRef.current = live;
          visualIndexRef.current = appRef.current.player.index;
          visualSlotRef.current =
            pageSlotsRef.current.get(trackQueueKey(live)) ??
            visualSlotRef.current;
          restingYRef.current = -visualSlotRef.current * stageExtentRef.current;
        }
        outgoingTrackKeys.current.clear();
        transitionTargetRef.current = null;
        transitionAnimationDone.current = false;
        transitionNavigationDone.current = false;
        previewTrackRef.current = null;
        setPreviewTrack(null);
        Animated.spring(swipeY, {
          toValue: restingYRef.current,
          useNativeDriver: true,
          tension: 80,
          friction: 9,
        }).start();
      },
    }),
  ).current;
  if (!track)
    return (
      <View testID="now-playing" style={s.root}>
        <AppHeader title="正在播放" back />
        <Text style={s.empty}>还没有选择歌曲</Text>
        <PlayerActionRow track={null} color={foreground.icon} />
      </View>
    );
  return (
    <View testID="now-playing" style={s.root}>
      {qualitySwitching ? (
        <View testID="player-quality-switching" style={s.qualitySwitching}>
          <Text style={[s.qualitySwitchingText, { color: foreground.primary }]}>
            {app.message}
          </Text>
        </View>
      ) : null}
      <View
        testID="player-swipe-stage"
        {...panResponder.panHandlers}
        onLayout={event => setStageHeight(event.nativeEvent.layout.height)}
        style={s.playerSwipeViewport}
      >
        <View
          testID="player-swipe-content-viewport"
          style={[
            s.playerContentViewport,
            {
              top: -pageTopInset,
              bottom: -pageBottomInset,
              // At a queue edge the current page can spring back over its
              // own background; neither system bar owns a separate colour.
              backgroundColor: previewTrack ? 'transparent' : backdropTone,
            },
          ]}
        >
          <Animated.View
            testID="player-swipe-track"
            style={[
              s.playerSwipeTrack,
              { height: stageExtent },
              { transform: [{ translateY: swipeTransform }] },
            ]}
          >
            {orderedPages.map(([key, page]) => {
              const active = page.offset === 0;
              const isPreview =
                !active &&
                Boolean(previewTrack && trackQueueKey(previewTrack) === key);
              const isFallback =
                fallbackPage?.token === pagerToken.current &&
                trackQueueKey(fallbackPage.track) === key;
              return (
                <View
                  key={key}
                  testID={`player-song-page-${key}`}
                  pointerEvents={active ? 'auto' : 'none'}
                  accessibilityElementsHidden={!active}
                  importantForAccessibility={
                    active ? 'auto' : 'no-hide-descendants'
                  }
                  style={[
                    s.playerPreviewFrame,
                    { top: page.slot * stageExtent },
                    { opacity: active || isPreview || isFallback ? 1 : 0 },
                    { height: stageExtent },
                  ]}
                >
                  <PlayerPageBackdrop
                    track={page.track}
                    viewTestID={
                      active
                        ? 'player-page-backdrop'
                        : isPreview
                        ? 'player-swipe-preview-backdrop'
                        : `player-preloaded-backdrop:${key}`
                    }
                  />
                  <View
                    testID={
                      isPreview ? 'player-swipe-preview-frame' : undefined
                    }
                    style={[
                      s.playerPageContent,
                      { top: pageTopInset, bottom: pageBottomInset },
                    ]}
                  >
                    <View style={s.playerPageFrame}>
                      <PlayerSongPage
                        track={page.track}
                        active={active}
                        isPreview={isPreview}
                        coverSize={coverSize}
                        onTimer={() => setTimerOpen(true)}
                        onQuality={() => setQualityOpen(true)}
                      />
                    </View>
                  </View>
                </View>
              );
            })}
          </Animated.View>
        </View>
      </View>
      <ProgressScrubber
        id="player-progress-touch"
        duration={duration}
        position={app.player.position}
        trackKey={appTrack ? trackQueueKey(appTrack) : undefined}
        horizontalPadding={layout.playerHeaderHorizontalPadding}
        bottom={layout.playerProgressBottom}
        smoothDrag
        wave
        wavePlaying={app.player.playing}
        foreground={foreground}
        onTouchActiveChange={active => {
          progressTouchActive.current = active;
        }}
        onSeek={app.seek}
      />
      {timerOpen ? <TimerSheet onClose={() => setTimerOpen(false)} /> : null}
      {qualityOpen ? (
        <QualitySheet
          selected={playbackNetworkQuality(app.state.settings)}
          actualDescription={actualQuality.description}
          switching={qualitySwitching}
          onClose={() => setQualityOpen(false)}
          onSelect={quality => {
            setQualityOpen(false);
            app.changeQuality(quality).catch(() => undefined);
          }}
        />
      ) : null}
    </View>
  );
}
function PlayerSongPage({
  track,
  active,
  isPreview,
  coverSize,
  onTimer,
  onQuality,
}: {
  track: PlayerTrack;
  active: boolean;
  isPreview: boolean;
  coverSize: number;
  onTimer: () => void;
  onQuality: () => void;
}) {
  const app = useApp();
  const layout = useLayout();
  const presentation = enrichTrackPresentation(track);
  const diskFile = Boolean(localPlaybackReference(track));
  const originalCover = usePlayerCover(track, !diskFile);
  const localCover = useLibraryTrackArtwork(
    active && diskFile ? track : null,
    app.recommendationPlatforms,
  );
  const cover = diskFile && active ? localCover : originalCover;
  const actualQuality = playerQuality(track);
  const qualityLabel = actualQuality.label;
  const foreground = playerForegroundForTone(
    usePlayerBackdropSurfaceTone(track, true),
  );
  const key = trackQueueKey(track);
  const id = (name: string) =>
    active
      ? name
      : isPreview
      ? name.replace('player-', 'player-preview-')
      : `${name}:${key}`;
  const contentTestID = active
    ? 'player-static-content'
    : isPreview
    ? 'player-swipe-preview'
    : `player-preloaded-content:${key}`;
  const onDecodedUri = useCallback(
    (uri: string) => {
      void preloadPlayerArtworkTone(track, uri);
    },
    [track],
  );
  return (
    <View testID={contentTestID} style={s.playerContent}>
      <View
        style={[
          s.playerHeader,
          {
            height: layout.playerHeaderHeight,
            paddingHorizontal: layout.playerHeaderHorizontalPadding,
          },
        ]}
      >
        <Pressable
          accessibilityLabel="返回"
          accessibilityElementsHidden
          onPress={app.back}
          style={s.hiddenBackAction}
        />
        <View style={s.menuGroup}>
          <Pressable
            testID={id('player-menu-button')}
            accessibilityRole="button"
            accessibilityLabel="打开主菜单"
            onPress={() => app.open('home-menu')}
            style={[
              s.headerAction,
              {
                width: layout.playerHeaderButtonSize,
                height: layout.playerHeaderButtonSize,
                borderRadius: layout.playerHeaderButtonSize / 2,
              },
            ]}
          >
            <Glyph
              color={foreground.icon}
              size={Math.round(layout.playerHeaderButtonSize * 0.6)}
            >
              ☰
            </Glyph>
          </Pressable>
          <Text
            testID={id('player-menu-choice')}
            numberOfLines={1}
            style={[s.menuChoice, { color: foreground.primary }]}
          >
            {getSelectedHomeMenuChoice()?.label ?? '默认模式'}
          </Text>
        </View>
      </View>
      <View
        testID={id('player-cover-hero')}
        style={[
          s.coverHero,
          s.playerCoverHero,
          {
            width: coverSize,
            height: coverSize,
            marginTop: layout.playerCoverTopGap,
          },
        ]}
      >
        <OrderedRemoteCover
          uris={[cover.uri, ...cover.fallbackUris]}
          fallback={covers[presentation.coverKey]}
          moduleKey={`player-artwork:${trackQueueKey(track)}`}
          testID={
            active
              ? 'player-related-cover'
              : isPreview
              ? 'player-hero-cover'
              : id('player-cover')
          }
          onExhausted={cover.onExhausted}
          onDecodedUri={onDecodedUri}
          resolution="player"
          priority={active ? 'player' : 'preload'}
          fallbackWhileLoading
          style={{ width: coverSize, height: coverSize, borderRadius: 26 }}
          imageStyle={{ width: coverSize, height: coverSize, borderRadius: 26 }}
        />
      </View>
      <LyricPreview
        track={track}
        position={active ? app.player.position : 0}
        active={active}
        viewTestID={id('player-lyric-preview')}
      />
      <View
        style={[
          s.songRow,
          s.playerSongRow,
          {
            marginHorizontal: layout.playerHeaderHorizontalPadding,
            marginTop: layout.playerSongMarginTop,
          },
        ]}
      >
        <View style={s.songCopy}>
          <View style={s.songTitleLine}>
            <ScrollingTitle
              key={`${track.provider}:${track.id}:${presentation.title}`}
              title={presentation.title}
              viewTestID={
                active
                  ? 'player-song-title'
                  : isPreview
                  ? 'player-preview-title'
                  : id('player-song-title')
              }
              color={foreground.primary}
            />
            <View style={s.titleTools}>
              <Pressable
                testID={id('player-timer-button')}
                onPress={() => onTimer()}
                style={[
                  s.qualityChip,
                  s.timerChip,
                  { backgroundColor: foreground.chip },
                ]}
              >
                <Text
                  style={[s.qualityChipText, { color: foreground.primary }]}
                >
                  定时
                </Text>
              </Pressable>
              <Pressable
                testID={id('player-quality-button')}
                accessibilityLabel={actualQuality.description}
                onPress={() => onQuality()}
                style={[
                  s.qualityChip,
                  s.qualityChipWide,
                  { backgroundColor: foreground.chip },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[s.qualityChipText, { color: foreground.primary }]}
                >
                  {qualityLabel}
                </Text>
              </Pressable>
              <Pressable
                testID={id('player-effects-button')}
                onPress={() => app.open('effects')}
                style={[
                  s.qualityChip,
                  s.effectsChip,
                  { backgroundColor: foreground.chip },
                ]}
              >
                <Text
                  style={[s.qualityChipText, { color: foreground.primary }]}
                >
                  音效
                </Text>
              </Pressable>
            </View>
          </View>
          <Text
            numberOfLines={1}
            style={[
              s.artist,
              {
                color: foreground.secondary,
                fontSize: layout.playerArtistFontSize,
                lineHeight: layout.playerArtistLineHeight,
                marginTop: layout.playerArtistMarginTop,
              },
            ]}
          >
            {presentation.artist}
          </Text>
        </View>
      </View>
      <PlayerActionRow
        track={track}
        color={foreground.icon}
        id={id}
        scope={active ? 'player' : id('player-actions')}
      />
    </View>
  );
}
function PlayerActionRow({
  track,
  color,
  id = name => name,
  scope = 'player',
}: {
  track: PlayerTrack | null;
  color: string;
  id?: (name: string) => string;
  scope?: string;
}) {
  const layout = useLayout();
  return (
    <View
      testID={id('player-action-row')}
      style={[
        s.playerActionRow,
        {
          bottom: layout.playerActionBottom,
          right: layout.playerHeaderHorizontalPadding,
          left: layout.playerHeaderHorizontalPadding,
        },
      ]}
    >
      <QueueTrackActions
        track={track}
        showRemove={false}
        scope={scope}
        player
        scale={layout.playerActionScale}
        playerColor={color}
      />
      <View
        testID={id('player-navigation-actions')}
        style={s.playerNavigationActions}
      >
        <PlaybackModePicker
          testID={id('player-mode-button')}
          player
          scale={layout.playerActionScale}
          playerColor={color}
        />
        <PlayerQueueButton
          testID={id('player-queue-button')}
          scale={layout.playerActionScale}
          color={color}
        />
      </View>
    </View>
  );
}
export function ProgressScrubber({
  id,
  duration,
  position,
  horizontalPadding = 26,
  bottom = 12,
  smoothDrag = false,
  trackKey,
  wave = false,
  wavePlaying = false,
  foreground,
  onSeek,
  onTouchActiveChange,
}: {
  id: string;
  duration: number;
  position: number;
  horizontalPadding?: number;
  bottom?: number;
  smoothDrag?: boolean;
  trackKey?: string;
  wave?: boolean;
  wavePlaying?: boolean;
  foreground?: ReturnType<typeof playerForegroundForTone>;
  onSeek: (value: number) => void | Promise<void>;
  onTouchActiveChange?: (active: boolean) => void;
}) {
  const { scale } = useLayout();
  const [width, setWidth] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const state = useRef({
    dragging: false,
    moved: false,
    startX: null as number | null,
    startPageX: null as number | null,
  });
  const pendingSeek = useRef(false);
  const dragPositionRef = useRef<number | null>(null);
  const previousTrackKey = useRef(trackKey);
  const waveOffset = useRef(new Animated.Value(0)).current;
  const valueAt = (locationX: number) => {
    const ratio = Math.max(0, Math.min(1, locationX / Math.max(1, width)));
    return Math.max(0, duration) * ratio;
  };
  const previewAt = (locationX: number) => {
    const value = valueAt(locationX);
    dragPositionRef.current = value;
    setDragPosition(value);
    return value;
  };
  const commitValue = (value: number) => {
    dragPositionRef.current = value;
    setDragPosition(value);
    pendingSeek.current = true;
    Promise.resolve(onSeek(value)).catch(() => {
      pendingSeek.current = false;
      dragPositionRef.current = null;
      setDragPosition(null);
    });
    return value;
  };
  const commitAt = (locationX: number) => {
    return commitValue(previewAt(locationX));
  };
  useEffect(() => {
    if (previousTrackKey.current === trackKey) return;
    previousTrackKey.current = trackKey;
    const wasDragging = state.current.dragging;
    state.current.dragging = false;
    state.current.moved = false;
    state.current.startX = null;
    state.current.startPageX = null;
    pendingSeek.current = false;
    dragPositionRef.current = null;
    setDragPosition(null);
    setDragging(false);
    if (wasDragging) onTouchActiveChange?.(false);
  }, [onTouchActiveChange, trackKey]);
  useEffect(() => {
    if (!wave || !wavePlaying) {
      waveOffset.stopAnimation();
      waveOffset.setValue(0);
      return undefined;
    }
    const animation = Animated.loop(
      Animated.timing(waveOffset, {
        toValue: -PROGRESS_WAVE_CYCLE,
        duration: 1800,
        easing: Easing.linear,
        isInteraction: false,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [wave, wavePlaying, waveOffset]);
  const touchX = (event: any): number | null => {
    const pageX = event?.nativeEvent?.pageX;
    // Android can report move locationX relative to a different hit child.
    // Anchor the gesture to the container at touch-down and undo canvas scale.
    if (
      smoothDrag &&
      typeof pageX === 'number' &&
      Number.isFinite(pageX) &&
      state.current.startPageX !== null &&
      state.current.startX !== null
    ) {
      return (
        state.current.startX +
        (pageX - state.current.startPageX) / (scale > 0 ? scale : 1)
      );
    }
    const value = event?.nativeEvent?.locationX;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const begin = (event: any) => {
    onTouchActiveChange?.(true);
    state.current.moved = false;
    state.current.startX = null;
    state.current.startPageX = null;
    const initialX = touchX(event);
    const pageX = event?.nativeEvent?.pageX;
    state.current.startPageX =
      typeof pageX === 'number' && Number.isFinite(pageX) ? pageX : null;
    if (smoothDrag) {
      pendingSeek.current = false;
      dragPositionRef.current = null;
      setDragPosition(null);
      state.current.startX = initialX;
      state.current.dragging = false;
      return;
    }
    state.current.startX = initialX;
    state.current.dragging = false;
  };
  const move = (event: any) => {
    const locationX = touchX(event);
    if (locationX === null) return;
    if (smoothDrag) {
      if (state.current.startX === null) state.current.startX = locationX;
      if (
        !state.current.dragging &&
        Math.abs(locationX - state.current.startX) < 2
      )
        return;
      state.current.dragging = true;
      state.current.moved = true;
      setDragging(true);
      previewAt(locationX);
      return;
    }
    if (!state.current.dragging) return;
    state.current.moved = true;
    previewAt(locationX);
  };
  const end = (event: any) => {
    if (smoothDrag) {
      const locationX = touchX(event);
      if (state.current.dragging && dragPositionRef.current !== null) {
        commitValue(dragPositionRef.current);
      } else if (state.current.dragging && locationX !== null) {
        commitAt(locationX);
      }
      if (state.current.dragging) {
        state.current.dragging = false;
        setDragging(false);
      }
      state.current.startX = null;
      onTouchActiveChange?.(false);
      return;
    }
    if (state.current.dragging) {
      const locationX = touchX(event);
      if (locationX !== null) commitAt(locationX);
      state.current.dragging = false;
      setDragging(false);
    }
    onTouchActiveChange?.(false);
  };
  const press = (event: any) => {
    const locationX = touchX(event);
    if (smoothDrag) {
      if (locationX !== null && !state.current.moved) {
        commitAt(locationX);
      }
      state.current.moved = false;
      return;
    }
    if (locationX !== null && !state.current.moved) commitAt(locationX);
    state.current.moved = false;
  };
  useEffect(() => {
    if (!smoothDrag || dragging || dragPosition === null) return;
    if (pendingSeek.current && Math.abs(position - dragPosition) < 0.75) {
      pendingSeek.current = false;
      dragPositionRef.current = null;
      setDragPosition(null);
    }
  }, [dragPosition, dragging, position, smoothDrag]);
  const displayPosition =
    smoothDrag && dragPosition !== null ? dragPosition : position;
  const progress = Math.min(
    100,
    (displayPosition / Math.max(1, duration)) * 100,
  );
  return (
    <Pressable
      testID={id}
      pointerEvents={smoothDrag ? 'box-only' : undefined}
      accessibilityRole="adjustable"
      accessibilityValue={{
        min: 0,
        max: Math.max(0, duration),
        now: displayPosition,
      }}
      delayLongPress={smoothDrag ? 0 : 220}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onMoveShouldSetResponderCapture={() => true}
      onTouchStart={begin}
      onTouchMove={move}
      onTouchEnd={end}
      onTouchCancel={end}
      onPress={press}
      style={[
        {
          height: 17,
          marginHorizontal: horizontalPadding,
          marginTop: 8,
          justifyContent: 'center',
        },
        {
          position: 'absolute',
          right: 0,
          zIndex: 20,
          elevation: 20,
          // The player screen is laid out above the sibling bottom frame, so
          // 12dp here is the stable gap immediately above the nav bar.
          bottom,
          left: 0,
        },
      ]}
    >
      {dragging ? (
        <Text
          testID={`${id}-time`}
          style={[s.progressTime, foreground && { color: foreground.primary }]}
        >
          {formatTime(displayPosition)} / {formatTime(duration)}
        </Text>
      ) : null}
      <View
        testID={`${id}-track`}
        style={[
          s.progress,
          {
            backgroundColor: foreground?.track ?? 'rgba(255,248,245,0.34)',
          },
        ]}
      >
        <View
          testID={wave ? `${id}-wave` : undefined}
          style={[
            s.progressFill,
            {
              backgroundColor: wave
                ? 'transparent'
                : foreground?.primary ?? '#fff8f5',
              width: `${progress}%`,
            },
          ]}
        >
          {wave ? (
            <View style={s.progressWaveClip} pointerEvents="none">
              <Animated.View
                style={[
                  s.progressWaveMotion,
                  { transform: [{ translateX: waveOffset }] },
                ]}
              >
                <Svg
                  width={PROGRESS_WAVE_WIDTH * 2}
                  height={PROGRESS_WAVE_HEIGHT}
                  viewBox={`0 0 ${
                    PROGRESS_WAVE_WIDTH * 2
                  } ${PROGRESS_WAVE_HEIGHT}`}
                >
                  <Path
                    d={PROGRESS_WAVE_PATH}
                    fill="none"
                    stroke={foreground?.primary ?? '#fff8f5'}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                </Svg>
              </Animated.View>
            </View>
          ) : null}
        </View>
        <View
          style={[
            s.progressDot,
            {
              backgroundColor: foreground?.primary ?? '#fff8f5',
              left: `${Math.max(0, Math.min(98, progress))}%`,
            },
          ]}
        />
      </View>
    </Pressable>
  );
}
function ScrollingTitle({
  title,
  color,
  viewTestID: testID = 'player-song-title',
}: {
  title: string;
  color?: string;
  viewTestID?: string;
}) {
  const layout = useLayout();
  const displayTitle = title.trim() || '未知歌曲';
  const viewportWidth = useRef(0);
  const textWidth = useRef(0);
  const offset = useRef(new Animated.Value(0)).current;
  const [distance, setDistance] = useState(0);
  useLayoutEffect(() => {
    textWidth.current = 0;
    setDistance(0);
    offset.stopAnimation();
    offset.setValue(0);
  }, [displayTitle, offset]);
  useEffect(() => {
    if (distance <= 0) return undefined;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(900),
        Animated.timing(offset, {
          toValue: -distance,
          duration: Math.max(1800, distance * 18),
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(700),
        Animated.timing(offset, {
          toValue: 0,
          duration: Math.max(1800, distance * 18),
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [distance, offset]);
  return (
    <View
      testID={`${testID}-scroll`}
      style={s.songTitleScroll}
      onLayout={event => {
        viewportWidth.current = event.nativeEvent.layout.width;
        setDistance(Math.max(0, textWidth.current - viewportWidth.current));
      }}
    >
      <ScrollView
        testID={`${testID}-content`}
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={width => {
          textWidth.current = Math.ceil(width);
          setDistance(Math.max(0, textWidth.current - viewportWidth.current));
        }}
      >
        <Animated.Text
          key={displayTitle}
          testID={testID}
          accessibilityLabel={displayTitle}
          numberOfLines={1}
          ellipsizeMode="clip"
          style={[
            s.title,
            s.scrollingTitleText,
            {
              color,
              fontSize: layout.playerTitleFontSize,
              lineHeight: layout.playerTitleLineHeight,
            },
            { transform: [{ translateX: offset }] },
          ]}
        >
          {displayTitle}
        </Animated.Text>
      </ScrollView>
    </View>
  );
}
export function PlayerBackdrop() {
  const app = useApp();
  const tone = usePlayerBackdropSurfaceTone(app.current);
  if (!app.current) return null;
  return (
    <View
      testID="player-backdrop"
      style={[s.backdrop, { backgroundColor: tone }]}
    />
  );
}
function PlayerPageBackdrop({
  track,
  viewTestID,
}: {
  track: PlayerTrack;
  viewTestID: string;
}) {
  const tone = usePlayerBackdropSurfaceTone(track, true);
  return (
    <View
      testID={viewTestID}
      pointerEvents="none"
      style={[s.pageBackdrop, { backgroundColor: tone }]}
    />
  );
}
function TimerSheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const layout = useLayout();
  const tone = usePlayerBackdropSurfaceTone(app.current);
  const foreground = playerForegroundForTone(tone);
  const options: Array<[string, () => Promise<void>]> = [
    ['15 分钟', () => app.setSleepTimer('minutes', 15)],
    ['30 分钟', () => app.setSleepTimer('minutes', 30)],
    ['45 分钟', () => app.setSleepTimer('minutes', 45)],
    ['60 分钟', () => app.setSleepTimer('minutes', 60)],
    ['本曲结束', () => app.setSleepTimer('track')],
  ];
  return (
    <View
      testID="player-timer-overlay"
      style={[s.timerOverlay, { bottom: -layout.bottomNavHeight }]}
    >
      <Pressable style={s.timerBackdrop} onPress={onClose} />
      <View
        testID="player-timer-sheet"
        style={[s.timerSheet, { backgroundColor: tone }]}
      >
        <View style={s.grabber} />
        <View style={s.timerTitleRow}>
          <View>
            <Text style={[s.timerTitle, { color: foreground.primary }]}>
              定时播放
            </Text>
            <Text style={[s.timerSub, { color: foreground.secondary }]}>
              {app.player.sleepMode === 'off' ? '未设置' : '已设置'}
            </Text>
          </View>
          <Pressable
            testID="player-timer-close"
            accessibilityLabel="关闭"
            hitSlop={8}
            onPress={onClose}
            style={s.timerClose}
          >
            <Glyph color={foreground.icon}>×</Glyph>
          </Pressable>
        </View>
        <View style={s.timerGrid}>
          {options.map(([label, action]) => (
            <Pressable
              key={label}
              style={s.timerOption}
              onPress={() => action().then(onClose).catch(onClose)}
            >
              <Text style={[s.timerTrack, { color: foreground.primary }]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        {app.player.sleepMode !== 'off' ? (
          <Pressable
            style={s.cancelTimer}
            onPress={() => app.cancelSleepTimer().then(onClose).catch(onClose)}
          >
            <Text style={[s.cancelTimerText, { color: foreground.primary }]}>
              取消定时
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
function QualitySheet({
  selected,
  actualDescription,
  switching,
  onClose,
  onSelect,
}: {
  selected: PlaybackQuality;
  actualDescription: string;
  switching: boolean;
  onClose: () => void;
  onSelect: (quality: PlaybackQuality) => void;
}) {
  const app = useApp();
  const layout = useLayout();
  const tone = usePlayerBackdropSurfaceTone(app.current);
  const foreground = playerForegroundForTone(tone);
  const options = playbackQualityOptions.map(
    item => [item.value, item.playerLabel] as const,
  );
  return (
    <View
      testID="player-quality-overlay"
      style={[s.timerOverlay, { bottom: -layout.bottomNavHeight }]}
    >
      <Pressable style={s.timerBackdrop} onPress={onClose} />
      <View
        testID="player-quality-sheet"
        style={[s.timerSheet, { backgroundColor: tone }]}
      >
        <View style={s.grabber} />
        <View style={s.timerTitleRow}>
          <View>
            <Text style={[s.timerTitle, { color: foreground.primary }]}>
              播放音质
            </Text>
            <Text style={[s.timerSub, { color: foreground.secondary }]}>
              {switching ? app.message : '全局音质设置，会应用于后续播放'}
            </Text>
            {actualDescription ? (
              <Text
                testID="player-quality-actual"
                style={[s.timerSub, { color: foreground.secondary }]}
              >
                {actualDescription}
              </Text>
            ) : null}
          </View>
          <Pressable
            testID="player-quality-close"
            accessibilityLabel="关闭"
            hitSlop={8}
            onPress={onClose}
            style={s.timerClose}
          >
            <Glyph color={foreground.icon}>×</Glyph>
          </Pressable>
        </View>
        <View style={s.timerGrid}>
          {options.map(([value, label]) => (
            <Pressable
              key={value}
              testID={`player-quality-${value}`}
              disabled={switching}
              style={[
                s.timerOption,
                selected === value && s.qualityOptionActive,
                switching && s.qualityOptionDisabled,
              ]}
              onPress={() => onSelect(value)}
            >
              <Text style={[s.timerTrack, { color: foreground.primary }]}>
                {label}
              </Text>
              {selected === value ? (
                <Text style={[s.timerUnit, { color: foreground.secondary }]}>
                  已选择
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}
function Effects() {
  return <EffectsScreen />;
}
function LyricPreview({
  track,
  position,
  active = true,
  viewTestID = 'player-lyric-preview',
}: {
  track: NonNullable<ReturnType<typeof useApp>['current']>;
  position: number;
  active?: boolean;
  viewTestID?: string;
}) {
  const app = useApp();
  const layout = useLayout();
  const foreground = playerForegroundForTone(
    usePlayerBackdropSurfaceTone(track, true),
  );
  const presentation = useMemo(() => enrichTrackPresentation(track), [track]);
  const key = trackLyricsKey(presentation);
  const [lyricState, setLyricState] = useState(() => {
    const cached = getCachedTrackLyrics(presentation);
    return {
      key,
      lines: cached ?? ([] as LyricLine[]),
      loaded: Boolean(cached),
      error: '',
    };
  });
  const lines =
    lyricState.key === key
      ? lyricState.lines
      : getCachedTrackLyrics(presentation) ?? [];
  const spokenMedia = isSpokenMediaPresentation(presentation);
  const emptyLabel = spokenMedia
    ? lyricState.key === key && lyricState.error
      ? lyricState.error
      : lyricState.key !== key || !lyricState.loaded
      ? '正在读取平台字幕…'
      : '该章节暂无平台字幕'
    : '暂无歌词';
  useEffect(() => {
    const cached = getCachedTrackLyrics(presentation);
    setLyricState(previous =>
      previous.key === key
        ? previous
        : { key, lines: cached ?? [], loaded: Boolean(cached), error: '' },
    );
    return subscribePlayerLyrics(presentation, value =>
      setLyricState({ key, lines: value, loaded: true, error: '' }),
    );
  }, [key, presentation]);
  useEffect(() => {
    if (!active || (lyricState.key === key && lyricState.loaded)) return;
    let listening = true;
    getTrackLyrics(presentation)
      .then(
        value =>
          listening &&
          setLyricState({ key, lines: value, loaded: true, error: '' }),
      )
      .catch(
        () =>
          listening &&
          setLyricState({
            key,
            lines: [],
            loaded: true,
            error: spokenMedia ? '平台字幕读取失败，请稍后重试' : '',
          }),
      );
    return () => {
      listening = false;
    };
  }, [
    active,
    key,
    lyricState.key,
    lyricState.loaded,
    presentation,
    spokenMedia,
  ]);
  const index = lines.reduce(
    (result, line, itemIndex) => (line.time <= position ? itemIndex : result),
    -1,
  );
  // The lyric area is a fixed part of the player composition.  Keeping the
  // same number of slots whether a provider returns lyrics or not prevents
  // the song and action blocks from jumping between tracks.
  const visibleLineCount = layout.playerLyricLines;
  return (
    <Pressable
      testID={viewTestID}
      accessibilityRole="button"
      accessibilityLabel="打开歌词页"
      onPress={() => app.open('lyrics')}
      style={[
        s.lyricPreview,
        {
          paddingHorizontal: layout.playerHeaderHorizontalPadding,
          marginTop: layout.playerLyricMarginTop,
          minHeight: layout.playerLyricHeight,
        },
      ]}
    >
      {Array.from({ length: visibleLineCount }, (_, offset) => {
        const lineIndex = index + offset;
        const text =
          lines[lineIndex]?.text ??
          (!lines.length && offset === 0 ? emptyLabel : '');
        return (
          <Text
            key={`${lineIndex}-${offset}`}
            numberOfLines={1}
            style={[
              s.lyricLine,
              lineIndex === index ? s.lyricCurrent : s.lyricMuted,
              {
                color:
                  lineIndex === index
                    ? foreground.primary
                    : foreground.secondary,
                fontSize: layout.playerLyricFontSize,
                lineHeight: layout.playerLyricLineHeight,
                height: layout.playerLyricLineHeight,
                marginTop: offset === 0 ? 0 : layout.playerLyricLineGap,
              },
            ]}
          >
            {text}
          </Text>
        );
      })}
    </Pressable>
  );
}
function LyricEdgeFade({
  tone,
  bottom = false,
}: {
  tone: string;
  bottom?: boolean;
}) {
  const id = bottom ? 'lyricsBottomFade' : 'lyricsTopFade';
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={tone} stopOpacity={bottom ? 0 : 1} />
          <Stop offset="1" stopColor={tone} stopOpacity={bottom ? 1 : 0} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
function Lyrics() {
  const app = useApp(),
    layout = useLayout(),
    track = app.current;
  const presentation = useMemo(
    () => (track ? enrichTrackPresentation(track) : null),
    [track],
  );
  const backdropTone = usePlayerBackdropSurfaceTone(track);
  const foreground = playerForegroundForTone(backdropTone);
  const lyricsRef = useRef<ScrollView | null>(null);
  const [pageHeight, setPageHeight] = useState(0);
  const [viewport, setViewport] = useState({ y: 0, height: 0 });
  const [lineLayouts, setLineLayouts] = useState<
    Record<
      number,
      {
        y: number;
        height: number;
      }
    >
  >({});
  const [lines, setLines] = useState<LyricLine[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLines([]);
    setLoaded(false);
    setLineLayouts({});
    setError('');
    if (presentation)
      getTrackLyrics(presentation)
        .then((value: LyricLine[]) => {
          if (!active) return;
          setLines(value);
          setLoaded(true);
        })
        .catch((reason: unknown) => {
          if (!active) return;
          setError(reason instanceof Error ? reason.message : '歌词加载失败');
          setLoaded(true);
        });
    return () => {
      active = false;
    };
  }, [presentation]);
  const activeIndex = lines.reduce(
    (result, line, index) =>
      line.time <= app.player.position ? index : result,
    -1,
  );
  const spokenMedia = Boolean(
    presentation && isSpokenMediaPresentation(presentation),
  );
  const spokenEmptyLabel = '该章节暂无平台字幕';
  const centerY = pageHeight / 2 - viewport.y;
  const activeLayout = lineLayouts[activeIndex];
  const topPadding = Math.max(0, centerY - (lineLayouts[0]?.height ?? 0) / 2);
  const bottomPadding = Math.max(
    0,
    viewport.height -
      centerY -
      (lineLayouts[lines.length - 1]?.height ?? 0) / 2,
  );
  useEffect(() => {
    if (!activeLayout || !pageHeight || !viewport.height) return;
    lyricsRef.current?.scrollTo({
      y: Math.max(0, activeLayout.y + activeLayout.height / 2 - centerY),
      animated: true,
    });
  }, [activeLayout, centerY, pageHeight, viewport.height]);
  const duration = app.player.duration || track?.duration || 0;
  return (
    <View
      testID="lyrics-view"
      style={s.root}
      onLayout={event => setPageHeight(event.nativeEvent.layout.height)}
    >
      <View
        style={[
          s.playerPageHeader,
          {
            height: layout.playerHeaderHeight,
            paddingHorizontal: layout.playerHeaderHorizontalPadding,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={12}
          onPress={app.back}
          style={[
            s.playerBackButton,
            {
              width: layout.playerHeaderButtonSize,
              height: layout.playerHeaderButtonSize,
            },
          ]}
        >
          <Glyph color={foreground.icon} size={32}>
            ‹
          </Glyph>
        </Pressable>
      </View>
      <ScrollView
        ref={lyricsRef}
        testID="lyrics-scroll"
        onLayout={event => {
          const { y, height } = event.nativeEvent.layout;
          setViewport(previous =>
            previous.y === y && previous.height === height
              ? previous
              : { y, height },
          );
        }}
        style={[
          s.lyricsViewport,
          {
            top: layout.playerHeaderHeight + 8,
            bottom: layout.trackRowHeight + 34,
          },
        ]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          s.lyrics,
          {
            paddingTop: topPadding,
            paddingBottom: bottomPadding,
          },
        ]}
        showsHorizontalScrollIndicator={false}
      >
        {!lines.length ? (
          <Text style={[s.empty, { color: foreground.secondary }]}>
            {error ||
              (spokenMedia
                ? loaded
                  ? spokenEmptyLabel
                  : '正在读取平台字幕…'
                : '正在读取平台歌词…')}
          </Text>
        ) : null}
        {lines.map((line, index) => (
          <Pressable
            key={`${line.time}-${index}`}
            onLayout={event => {
              const { y, height } = event.nativeEvent.layout;
              setLineLayouts(previous =>
                previous[index]?.y === y && previous[index]?.height === height
                  ? previous
                  : { ...previous, [index]: { y, height } },
              );
            }}
            accessibilityRole="button"
            accessibilityLabel={`跳转到 ${line.text}${
              line.translation ? `，${line.translation}` : ''
            }`}
            onPress={() => app.seek(line.time).catch(() => undefined)}
            style={[s.lyricPress, index === activeIndex && s.lyricActivePress]}
          >
            <Text
              style={[
                s.lyric,
                index === activeIndex && s.lyricActive,
                {
                  color:
                    index === activeIndex
                      ? foreground.primary
                      : foreground.secondary,
                },
              ]}
            >
              {line.translation
                ? `${line.text}\n${line.translation}`
                : line.text}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <PlayerDock track={track} />
      <ProgressScrubber
        id="lyrics-progress-touch"
        duration={duration}
        position={app.player.position}
        horizontalPadding={layout.playerHeaderHorizontalPadding}
        bottom={layout.playerProgressBottom}
        smoothDrag
        foreground={foreground}
        onSeek={value => app.seek(value).catch(() => undefined)}
      />
      <View
        pointerEvents="none"
        testID="lyrics-top-mask"
        style={[
          s.lyricFadeTop,
          {
            top: layout.playerHeaderHeight + layout.trackRowHeight + 16,
            height: layout.playerLyricLineHeight * 3,
          },
        ]}
      >
        <LyricEdgeFade tone={backdropTone} />
      </View>
      <View
        pointerEvents="none"
        testID="lyrics-bottom-mask"
        style={[
          s.lyricFadeBottom,
          {
            bottom: layout.playerProgressBottom + 22,
            height: layout.playerLyricLineHeight * 4,
          },
        ]}
      >
        <LyricEdgeFade tone={backdropTone} bottom />
      </View>
    </View>
  );
}
function Queue() {
  const app = useApp(),
    layout = useLayout();
  const loadMoreQueue = app.loadMoreQueue;
  const queueHasMore = app.queuePage.hasMore;
  const queueError = app.queuePage.error;
  const prefetchQueueAt = app.prefetchQueueAt;
  const playerIndex = app.player.index;
  const queuePrefetch = useQueueListPrefetch(
    prefetchQueueAt,
    app.queuePage,
    app.queueReversed,
    app.queue.length,
    layout.trackRowHeight,
  );
  const queueScrollRef = useRef<ScrollView | null>(null);
  const queueRows = useRef(
    new Map<
      number,
      {
        key: string;
        y: number;
      }
    >(),
  );
  const queueItems = useRef(app.queue);
  queueItems.current = app.queue;
  const locateCurrent = useCallback((index: number) => {
    const row = queueRows.current.get(index);
    const track = queueItems.current[index];
    if (
      !queueScrollRef.current ||
      !row ||
      !track ||
      row.key !== mediaPlaybackKey(track)
    )
      return false;
    queueScrollRef.current.scrollTo({
      y: Math.max(0, row.y - 12),
      animated: false,
    });
    return true;
  }, []);
  const queueFollow = usePlaybackListFollow(
    app.queue,
    app.current,
    true,
    locateCurrent,
    app.queueOrderVersion,
  );
  const orderVersion = useRef(app.queueOrderVersion);
  useEffect(() => {
    if (orderVersion.current === app.queueOrderVersion) return;
    orderVersion.current = app.queueOrderVersion;
    queueScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [app.queueOrderVersion]);
  useEffect(() => {
    if (!queueHasMore || queueError) return;
    void prefetchQueueAt(playerIndex).catch(() => undefined);
  }, [playerIndex, prefetchQueueAt, queueError, queueHasMore]);
  return (
    <OrderedCoverScope generationKey="player-queue" exclusive>
      <OrderedCoverBatch
        candidates={app.queue.map(trackCoverCandidates)}
        moduleKey="player-queue"
      />
      <View testID="queue-view" style={s.root}>
        <AppHeader
          title="播放队列"
          back
          onSearch={() => app.setTab('search')}
          trailing={
            <View style={{ flexDirection: 'row' }}>
              <QueueOrderButton />
              <PlaybackModePicker compact />
            </View>
          }
        />
        <ScrollView
          testID="player-queue-list"
          ref={queueScrollRef}
          onScrollBeginDrag={() => {
            queueFollow.onScrollBeginDrag();
            queuePrefetch.onScrollBeginDrag();
            // A new gesture is an explicit retry opportunity after a
            // transient page error. Keep the retry one-shot for this gesture;
            // the shared request guard handles duplicates.
            if (queueError) void loadMoreQueue().catch(() => undefined);
          }}
          onScroll={({ nativeEvent }) => {
            if (!queueFollow.automaticScroll.current)
              queuePrefetch.onScroll(nativeEvent);
          }}
          onLayout={event => {
            queuePrefetch.onLayout(event);
            queueFollow.onLayout();
          }}
          onContentSizeChange={(width, height) => {
            if (!queueFollow.automaticScroll.current)
              queuePrefetch.onContentSizeChange(width, height);
            queueFollow.onContentSizeChange();
          }}
          scrollEventThrottle={100}
          contentContainerStyle={{
            paddingBottom: layout.scrollBottomPadding,
          }}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          {app.queue.map((track, index) => (
            <View
              key={mediaPlaybackKey(track)}
              testID={`player-queue-row-${index}`}
              onLayout={event => {
                queueRows.current.set(index, {
                  key: mediaPlaybackKey(track),
                  y: event.nativeEvent.layout.y,
                });
                queueFollow.locate();
              }}
            >
              <TrackRow
                track={track}
                active={Boolean(
                  app.current &&
                    mediaPlaybackKey(app.current) === mediaPlaybackKey(track),
                )}
                onPlay={() =>
                  app.playTrack(track, app.queue, index).catch(() => undefined)
                }
                trailing={<QueueTrackActions track={track} scale={1.25} />}
              />
            </View>
          ))}
          <ListPagingFooter {...app.queuePage} onRetry={app.loadMoreQueue} />
        </ScrollView>
      </View>
    </OrderedCoverScope>
  );
}
function PlayerDock({
  track,
}: {
  track: ReturnType<typeof useApp>['current'];
}) {
  const app = useApp();
  const layout = useLayout();
  const backdropTone = usePlayerBackdropSurfaceTone(track);
  const foreground = playerForegroundForTone(backdropTone);
  if (!track) return null;
  const presentation = enrichTrackPresentation(track);
  return (
    <View
      testID="lyrics-player-dock"
      style={[
        s.dock,
        {
          height: layout.trackRowHeight + 16,
          top: layout.playerHeaderHeight,
          backgroundColor: withAlpha(backdropTone, 0.98),
        },
      ]}
    >
      <Cover
        coverKey={presentation.coverKey}
        uri={presentation.cover}
        fallbackUris={playerCoverFallbacks(presentation)}
        moduleKey="player-dock"
        testID="player-dock-cover"
        resolution="player"
        size={layout.trackCoverSize}
      />
      <View style={s.dockCopy}>
        <Text style={[s.dockTitle, { color: foreground.primary }]}>
          {presentation.title}
        </Text>
        <Text style={[s.dockArtist, { color: foreground.secondary }]}>
          {presentation.artist}
        </Text>
      </View>
      <Pressable
        testID="lyrics-dock-toggle"
        accessibilityRole="button"
        accessibilityLabel={app.player.playing ? '暂停' : '播放'}
        onPress={() =>
          (app.current ? app.togglePlay() : app.playDefaultTrack()).catch(
            () => undefined,
          )
        }
        style={s.dockPlay}
      >
        <Glyph color={foreground.icon}>{app.player.playing ? 'Ⅱ' : '▶'}</Glyph>
      </Pressable>
    </View>
  );
}
const s = createThemedStyles(
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    qualitySwitching: {
      position: 'absolute',
      top: 70,
      alignSelf: 'center',
      zIndex: 8,
      elevation: 8,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 16,
      backgroundColor: 'rgba(12,18,22,.56)',
    },
    qualitySwitchingText: { fontSize: 13, lineHeight: 18 },
    backdrop: {
      ...StyleSheet.absoluteFill,
      opacity: 1,
    },
    pageBackdrop: {
      ...StyleSheet.absoluteFill,
    },
    playerContent: { flex: 1 },
    playerSwipeViewport: { flex: 1, overflow: 'visible' },
    playerContentViewport: {
      position: 'absolute',
      left: 0,
      right: 0,
      overflow: 'hidden',
    },
    playerSwipeTrack: { position: 'absolute', top: 0, left: 0, right: 0 },
    playerPageFrame: { flex: 1 },
    playerPageContent: { position: 'absolute', left: 0, right: 0 },
    playerPreviewFrame: {
      position: 'absolute',
      right: 0,
      left: 0,
      overflow: 'hidden',
    },
    empty: { color: '#d7d9dc', textAlign: 'center', marginTop: 80 },
    coverHero: {
      alignSelf: 'center',
      marginTop: 12,
      borderRadius: 26,
      shadowColor: '#2b1b18',
      shadowOpacity: 0.28,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 8,
    },
    playerCoverHero: { marginTop: 0 },
    coverShade: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: 'rgba(2,8,10,.18)',
    },
    playerHeader: {
      height: 66,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    playerPageHeader: {
      height: 62,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
    },
    playerBackButton: {
      width: 52,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
    },
    menuGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      minWidth: 0,
    },
    menuChoice: {
      color: '#fff',
      fontSize: 16,
      lineHeight: 20,
      marginLeft: 8,
      maxWidth: 130,
    },
    headerBackAction: {
      width: 28,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 2,
    },
    hiddenBackAction: {
      position: 'absolute',
      width: 1,
      height: 1,
      opacity: 0,
    },
    headerAction: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerCopy: { alignItems: 'center' },
    headerText: { color: '#fff', fontSize: 16, fontWeight: '400' },
    headerSub: { color: '#d7d9dc', fontSize: 12, marginTop: 4 },
    coverLetter: { padding: 28, alignItems: 'flex-end' },
    coverLetterText: {
      color: '#fff',
      fontFamily: serif,
      fontSize: 29,
      fontStyle: 'italic',
    },
    coverLetterSub: { color: '#D9E5EC', fontSize: 12, marginTop: 8 },
    songRow: {
      marginHorizontal: 26,
      marginTop: 33,
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    playerSongRow: { marginTop: 0 },
    songCopy: { flex: 1, minWidth: 0 },
    songTitleLine: {
      flexDirection: 'row',
      alignItems: 'center',
      minWidth: 0,
    },
    songTitleScroll: { flex: 1, minWidth: 0, overflow: 'hidden' },
    scrollingTitleText: { flexGrow: 0, flexShrink: 0, alignSelf: 'flex-start' },
    titleTools: {
      width: 178,
      marginLeft: 8,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 5,
    },
    title: {
      color: '#fff',
      fontFamily: serif,
      fontSize: 22,
      lineHeight: 28,
      fontWeight: '400',
    },
    artist: {
      color: '#d7d9dc',
      fontSize: 16,
      marginTop: 5,
    },
    qualityRow: {
      flexDirection: 'row',
      gap: 7,
      marginHorizontal: 26,
      marginTop: 12,
    },
    qualityChip: {
      paddingHorizontal: 6,
      paddingVertical: 5,
      borderRadius: 7,
      backgroundColor: 'rgba(255,248,245,0.14)',
      alignItems: 'center',
    },
    timerChip: { width: 45 },
    qualityChipWide: { width: 62 },
    effectsChip: { width: 45 },
    qualityChipText: {
      color: '#fff8f5',
      fontSize: 12,
      includeFontPadding: false,
    },
    playerActionRow: {
      position: 'absolute',
      right: 26,
      bottom: 28,
      left: 26,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    playerNavigationActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    metadataPill: {
      alignSelf: 'flex-start',
      marginHorizontal: 26,
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: 'rgba(255,255,255,.14)',
    },
    metadataText: { color: '#d7d9dc', fontSize: 12, fontWeight: '400' },
    lyricPreview: {
      alignItems: 'flex-start',
      marginTop: 0,
      paddingHorizontal: 26,
      minHeight: 2 * 22 + 1 * 4,
    },
    lyricLine: { color: '#d7d9dc', fontSize: 16, lineHeight: 22, height: 22 },
    lyricMuted: { color: '#d7d9dc' },
    lyricCurrent: {
      color: '#fff',
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '700',
      textShadowColor: 'rgba(255,255,255,.34)',
      textShadowRadius: 2,
      marginTop: 4,
      textAlign: 'left',
    },
    copy: {
      color: '#d7d9dc',
      fontSize: 14,
      lineHeight: 20,
      marginHorizontal: 28,
      marginTop: 8,
    },
    badges: {
      flexDirection: 'row',
      gap: 7,
      marginHorizontal: 28,
      marginTop: 12,
    },
    badge: {
      color: '#fff',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,.48)',
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 3,
      fontSize: 11,
    },
    progressTouch: {
      height: 17,
      marginHorizontal: 26,
      marginTop: 8,
      justifyContent: 'center',
    },
    progressOverlay: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      left: 0,
      marginTop: 8,
    },
    progress: { height: 2 },
    progressFill: { height: 2, backgroundColor: '#fff8f5' },
    progressWaveClip: {
      position: 'absolute',
      top: -3,
      right: 0,
      bottom: -3,
      left: 0,
      overflow: 'hidden',
    },
    progressWaveMotion: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: PROGRESS_WAVE_WIDTH * 2,
      height: PROGRESS_WAVE_HEIGHT,
    },
    progressDot: {
      position: 'absolute',
      top: -3,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: '#fff8f5',
    },
    progressTime: {
      position: 'absolute',
      right: 0,
      bottom: 9,
      left: 0,
      color: '#fff8f5',
      fontSize: 12,
      lineHeight: 18,
      alignSelf: 'center',
      textAlign: 'center',
      textShadowColor: 'rgba(0,0,0,.45)',
      textShadowRadius: 3,
    },
    qualityOptionActive: { backgroundColor: 'rgba(255,248,245,0.28)' },
    qualityOptionDisabled: { opacity: 0.55 },
    tools: {
      height: 62,
      marginTop: 2,
      marginHorizontal: 18,
      paddingHorizontal: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    tool: { minWidth: 64, alignItems: 'center', justifyContent: 'center' },
    toolText: { color: '#d7d9dc', fontSize: 12, marginTop: 5 },
    timerSheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: 18,
      paddingBottom: 26,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,.18)',
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: '#132128',
      elevation: 18,
      zIndex: 2,
    },
    timerOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 20,
      elevation: 20,
      justifyContent: 'flex-end',
    },
    timerBackdrop: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: 'rgba(0,0,0,.52)',
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: '#5C696E',
      marginBottom: 15,
    },
    timerTitleRow: { flexDirection: 'row', justifyContent: 'space-between' },
    // Keep the close target out of the scaled right-edge back-gesture zone.
    timerClose: { marginRight: 32 },
    timerTitle: {
      color: '#fff',
      fontFamily: serif,
      fontSize: 21,
      fontWeight: '400',
    },
    timerSub: { color: '#d7d9dc', fontSize: 12, marginTop: 4 },
    timerGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 9,
      marginTop: 17,
    },
    timerOption: {
      width: '31%',
      height: 64,
      borderRadius: 13,
      backgroundColor: 'rgba(255,255,255,.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    timerMinutes: { color: '#fff', fontSize: 21, fontWeight: '400' },
    timerTrack: { color: '#fff', fontSize: 16, fontWeight: '400' },
    timerUnit: { color: '#d7d9dc', fontSize: 12, marginTop: 2 },
    cancelTimer: {
      height: 42,
      marginTop: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelTimerText: { color: '#fff', fontSize: 13, fontWeight: '400' },
    pickerOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 22,
      elevation: 22,
      justifyContent: 'flex-end',
    },
    pickerBackdrop: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: 'rgba(0,0,0,.52)',
    },
    pickerSheet: {
      maxHeight: '72%',
      padding: 18,
      paddingBottom: 28,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,.18)',
      backgroundColor: 'rgba(16,25,30,.92)',
    },
    pickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    pickerTitle: { color: '#fff', fontSize: 20, fontWeight: '400' },
    pickerSubtitle: {
      color: '#d7d9dc',
      fontSize: 12,
      marginTop: 4,
      maxWidth: 260,
    },
    pickerRow: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,.14)',
    },
    pickerIcon: {
      width: 42,
      height: 42,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,.12)',
    },
    pickerCopy: { flex: 1, marginLeft: 12 },
    pickerRowTitle: { color: '#fff', fontSize: 14, fontWeight: '400' },
    pickerRowMeta: { color: '#d7d9dc', fontSize: 12, marginTop: 3 },
    pickerEmpty: {
      minHeight: 92,
      justifyContent: 'center',
      alignItems: 'center',
    },
    lyrics: {
      paddingHorizontal: 20,
      alignItems: 'stretch',
    },
    lyricsViewport: {
      position: 'absolute',
      top: 148,
      right: 10,
      bottom: 0,
      left: 10,
    },
    lyricPress: { width: '100%' },
    lyricActivePress: { opacity: 1 },
    lyric: {
      color: '#7E898C',
      fontFamily: serif,
      fontSize: 20,
      lineHeight: 38,
      textAlign: 'left',
    },
    lyricActive: {
      color: '#fff',
      fontSize: 24,
      fontWeight: '700',
      textShadowColor: 'rgba(255,255,255,.34)',
      textShadowRadius: 2,
    },
    lyricRead: { color: '#fff' },
    lyricUnread: { color: '#9BA4A8' },
    lyricFadeTop: {
      position: 'absolute',
      right: 0,
      left: 0,
    },
    lyricFadeBottom: {
      position: 'absolute',
      right: 0,
      left: 0,
    },
    dock: {
      position: 'absolute',
      left: 14,
      right: 14,
      top: 62,
      height: 78,
      padding: 12,
      borderRadius: 0,
      backgroundColor: 'transparent',
      flexDirection: 'row',
      alignItems: 'center',
      zIndex: 3,
    },
    dockCopy: { flex: 1, marginLeft: 11 },
    dockTitle: { color: '#fff', fontSize: 15, fontWeight: '400' },
    dockArtist: { color: '#d7d9dc', fontSize: 12, marginTop: 4 },
    dockPlay: {
      width: 46,
      height: 46,
      borderRadius: 23,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,.48)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    queueList: { paddingBottom: 140 },
    queueSheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: 18,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: '#17242B',
    },
    sheetTrack: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    sheetTitle: { color: '#fff', fontSize: 16, fontWeight: '400' },
    sheetArtist: { color: '#d7d9dc', fontSize: 12, marginTop: 4 },
    sheetActions: { flexDirection: 'row', marginTop: 18 },
    sheetAction: {
      flex: 1,
      color: '#fff',
      fontSize: 12,
      textAlign: 'center',
      lineHeight: 24,
    },
  }),
);
