import React, { useCallback, useEffect, useRef } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Track } from '../domain/types';
import { useApp } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { useTheme } from '../theme';
import { OrderedCoverScope, OrderedCoverBatch } from './OrderedRemoteCover';
import { Cover, Glyph, TrackPlatformDuration } from './UI';
import { ListPagingFooter } from './ListPaging';
import { useQueueListPrefetch } from './useQueueListPrefetch';
import { usePlaybackListFollow } from './usePlaybackListFollow';
import { mediaPlaybackKey } from '../services/mediaPlaybackProgress';
import { trackCoverCandidates } from '../services/onlineCatalog';
import { QueueTrackActions } from './QueueTrackActions';
import { PlaybackModePicker } from './PlaybackModePicker';
import { QueueOrderButton } from './QueueOrderButton';
import { preloadPlaylistPresentation } from '../services/playlistPresentationPreload';

export function PlaybackQueueSheet() {
  const app = useApp();
  const layout = useLayout();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  // The Modal is outside App's transformed design canvas. Reuse the exact
  // canvas scale so its rows match Home and the player queue on every DPI.
  const queueScale = layout.scale;
  const q = (value: number) => Math.max(1, Math.round(value * queueScale));
  const queueActionScale = queueScale * 1.25;
  const queueActionPanelWidth = q(4 * 28 * 1.25 + 4);
  const queueListRef = useRef<FlatList<Track> | null>(null);
  const loadMoreQueue = app.loadMoreQueue;
  const queueHasMore = app.queuePage.hasMore;
  const queueError = app.queuePage.error;
  const prefetchQueueAt = app.prefetchQueueAt;
  const playerIndex = app.player.index;
  const requestQueuePage = () => {
    // AppContext owns the shared single-flight guard. Do not hold a second
    // lock until native URL validation finishes: the logical metadata page is
    // already published and the next page must be requestable immediately.
    void loadMoreQueue().catch(() => undefined);
  };
  const queueOpen = app.queueListOpen;
  const setQueueOpen = app.setQueueListOpen;
  const queueRowHeight = q(layout.trackRowHeight);
  // The shared list owns display-only warm-up for every track currently
  // published in the logical queue. URL pre-resolution always settles first.
  useEffect(
    () => preloadPlaylistPresentation(app.queue, app.waitForQueuePrewarm),
    [app.queue, app.waitForQueuePrewarm],
  );
  const locateCurrent = useCallback((index: number) => {
    if (!queueListRef.current) return false;
    queueListRef.current.scrollToIndex({
      index,
      animated: false,
      viewPosition: 0.35,
    });
    return true;
  }, []);
  const queueFollow = usePlaybackListFollow(
    app.queue,
    app.current,
    queueOpen,
    locateCurrent,
    app.queueOrderVersion,
  );
  const queuePrefetch = useQueueListPrefetch(
    prefetchQueueAt,
    {
      ...app.queuePage,
      hasMore: queueOpen && queueHasMore,
    },
    app.queueReversed,
    app.queue.length,
    queueRowHeight,
  );
  useEffect(() => {
    if (!queueOpen || !queueHasMore || queueError) return;
    void prefetchQueueAt(playerIndex).catch(() => undefined);
  }, [playerIndex, prefetchQueueAt, queueError, queueHasMore, queueOpen]);
  const orderVersion = useRef(app.queueOrderVersion);
  useEffect(() => {
    if (orderVersion.current === app.queueOrderVersion) return;
    orderVersion.current = app.queueOrderVersion;
    queueListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [app.queueOrderVersion]);
  const track = app.current;
  if (!track) return null;
  return (
    <>
      {queueOpen ? (
        <Modal
          transparent
          animationType="slide"
          onRequestClose={() => setQueueOpen(false)}
        >
          <OrderedCoverScope generationKey="popup-queue" exclusive>
            <OrderedCoverBatch
              candidates={app.queue.map(trackCoverCandidates)}
              moduleKey="popup-queue"
            />
            <View testID="home-queue-overlay" style={s.overlay}>
              <Pressable
                testID="home-queue-backdrop"
                accessibilityRole="button"
                accessibilityLabel="收起播放列表"
                style={s.backdrop}
                onPress={() => setQueueOpen(false)}
              />
              <View
                testID="home-queue-sheet"
                // Keep the sheet measurable for native layout/QA tooling. The
                // visual scale comes from the shared design canvas above.
                onLayout={() => undefined}
                style={[
                  s.sheet,
                  {
                    backgroundColor: c.bg,
                    paddingBottom: insets.bottom + 12,
                    paddingHorizontal: q(16),
                    paddingTop: q(10),
                    // The queue modal is outside the scaled design canvas;
                    // extend its surface through the system inset while the
                    // content padding remains above the home indicator.
                    marginBottom: -insets.bottom,
                    borderTopLeftRadius: q(22),
                    borderTopRightRadius: q(22),
                  },
                ]}
              >
                <View
                  style={[
                    s.handle,
                    {
                      backgroundColor: c.line,
                      width: q(32),
                      height: q(4),
                      borderRadius: q(2),
                    },
                  ]}
                />
                <View
                  testID="home-queue-header"
                  style={[s.queueHeader, { height: q(52) }]}
                >
                  <Text
                    style={[s.queueTitle, { color: c.text, fontSize: q(19) }]}
                  >
                    播放列表
                  </Text>
                  {app.queueOrigin ? (
                    <Pressable
                      testID="queue-origin-link"
                      accessibilityRole="button"
                      accessibilityLabel={`返回播放列表来源：${app.queueOrigin.label}`}
                      onPress={app.returnToQueueOrigin}
                      style={[
                        s.originLink,
                        { marginLeft: q(8), marginRight: q(4) },
                      ]}
                    >
                      <Text
                        testID="queue-origin-label"
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{ color: c.accent, fontSize: q(12) }}
                      >
                        来源：{app.queueOrigin.label} ›
                      </Text>
                    </Pressable>
                  ) : null}
                  <View style={{ marginLeft: 'auto' }}>
                    <QueueOrderButton scale={queueScale} />
                  </View>
                  <PlaybackModePicker compact scale={queueScale} />
                  <Pressable
                    testID="home-queue-close"
                    accessibilityRole="button"
                    accessibilityLabel="关闭播放列表"
                    onPress={() => setQueueOpen(false)}
                    style={[s.action, { width: q(28), height: q(36) }]}
                  >
                    <Glyph color={c.text} size={25}>
                      ×
                    </Glyph>
                  </Pressable>
                </View>
                {app.message && app.message !== '正在解析可播放音源…' ? (
                  <Text
                    accessibilityRole="alert"
                    style={[s.queueError, { color: c.red }]}
                  >
                    {app.message}
                  </Text>
                ) : null}
                <FlatList
                  testID="home-queue-list"
                  ref={queueListRef}
                  onScrollBeginDrag={() => {
                    queueFollow.onScrollBeginDrag();
                    queuePrefetch.onScrollBeginDrag();
                    // A new gesture is an explicit retry opportunity after a
                    // transient page error. Keep the retry one-shot for this
                    // gesture; the shared request guard handles duplicates.
                    if (queueError) requestQueuePage();
                  }}
                  onScroll={({ nativeEvent }) => {
                    if (!queueFollow.automaticScroll.current)
                      queuePrefetch.onScroll(nativeEvent);
                  }}
                  onContentSizeChange={(_, contentHeight) => {
                    if (!queueFollow.automaticScroll.current)
                      queuePrefetch.onContentSizeChange(0, contentHeight);
                    queueFollow.onContentSizeChange();
                  }}
                  onLayout={event => {
                    queuePrefetch.onLayout(event);
                    queueFollow.onLayout();
                  }}
                  getItemLayout={(_, index) => ({
                    length: queueRowHeight,
                    offset: queueRowHeight * index,
                    index,
                  })}
                  onScrollToIndexFailed={({ index }) =>
                    queueListRef.current?.scrollToOffset({
                      offset: queueRowHeight * index,
                      animated: false,
                    })
                  }
                  scrollEventThrottle={100}
                  ListFooterComponent={
                    <ListPagingFooter
                      {...app.queuePage}
                      onRetry={app.loadMoreQueue}
                    />
                  }
                  data={app.queue}
                  keyExtractor={mediaPlaybackKey}
                  // FlatList is a pure component. Queue pages are published
                  // independently from the current-track selection, so the
                  // paging state must invalidate the render window as soon
                  // as metadata arrives; otherwise the new rows can remain
                  // invisible until a second scroll gesture.
                  extraData={[
                    mediaPlaybackKey(track),
                    app.queue.length,
                    app.queuePage.loading,
                    app.queuePage.hasMore,
                    app.queuePage.error,
                  ]}
                  initialNumToRender={12}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item, index }) => (
                    <View
                      style={[s.queueRow, { height: q(layout.trackRowHeight) }]}
                    >
                      <Pressable
                        testID={`home-queue-track-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={`播放 ${item.title}`}
                        accessibilityState={{
                          selected:
                            mediaPlaybackKey(track) === mediaPlaybackKey(item),
                        }}
                        onPress={() =>
                          app
                            .playTrack(item, app.queue, index, {
                              openPlayer: false,
                            })
                            .catch(() => undefined)
                        }
                        style={[
                          s.queueMain,
                          { height: q(layout.trackRowHeight) },
                        ]}
                      >
                        <Cover
                          coverKey={item.coverKey}
                          uri={item.cover}
                          fallbackUris={trackCoverCandidates(item)}
                          moduleKey="mini-player-queue"
                          testID="mini-player-queue-cover"
                          size={q(layout.trackCoverSize)}
                          radius={7}
                        />
                        <View style={[s.queueCopy, { marginLeft: q(9) }]}>
                          <Text
                            numberOfLines={1}
                            style={[
                              s.queueTrackTitle,
                              {
                                color:
                                  mediaPlaybackKey(track) ===
                                  mediaPlaybackKey(item)
                                    ? c.blue
                                    : c.text,
                                fontSize: q(15),
                                lineHeight: q(20),
                              },
                            ]}
                          >
                            {item.title}
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={[
                              s.artist,
                              {
                                color: c.muted,
                                fontSize: q(12),
                                lineHeight: q(16),
                                marginTop: q(3),
                              },
                            ]}
                          >
                            {item.artist}
                          </Text>
                        </View>
                        <View
                          style={{
                            width: q(48),
                            flexShrink: 0,
                            marginLeft: q(5),
                            alignItems: 'flex-end',
                          }}
                        >
                          <TrackPlatformDuration
                            track={item}
                            color={c.muted}
                            testIDPrefix="home-queue"
                            fontSize={q(11)}
                            lineHeight={q(15)}
                            durationMarginTop={q(2)}
                          />
                        </View>
                      </Pressable>
                      <View
                        style={{
                          width: queueActionPanelWidth,
                          flexShrink: 0,
                          overflow: 'hidden',
                        }}
                      >
                        <QueueTrackActions
                          track={item}
                          scale={queueActionScale}
                        />
                      </View>
                    </View>
                  )}
                  showsHorizontalScrollIndicator={false}
                />
              </View>
            </View>
          </OrderedCoverScope>
        </Modal>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  artist: { fontSize: 11, lineHeight: 15, marginTop: 1 },
  action: { alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'transparent',
  },
  sheet: {
    maxHeight: '62%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  handle: { width: 32, height: 4, borderRadius: 2, alignSelf: 'center' },
  queueHeader: { height: 52, flexDirection: 'row', alignItems: 'center' },
  originLink: { flex: 1, minWidth: 0 },
  queueTitle: { fontSize: 19, fontWeight: '400' },
  queueError: { fontSize: 12, paddingBottom: 8 },
  queueRow: { height: 64, flexDirection: 'row', alignItems: 'center' },
  queueMain: {
    flex: 1,
    minWidth: 0,
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
  },
  queueCopy: { flex: 1, minWidth: 0, marginLeft: 12 },
  queueTrackTitle: { fontSize: 16, lineHeight: 21, fontWeight: '400' },
});
