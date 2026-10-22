import { OrderedCoverBatch } from './OrderedRemoteCover';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { covers } from '../assets/covers';
import { ResilientHomeCover } from './ResilientHomeCover';
import { SectionTitle, TrackPlatformDuration } from './UI';
import type { Track } from '../domain/types';
import type { HomeLayoutMetrics } from '../layout';
import {
  HOME_RELEASE_BATCH_SIZE,
  HOME_RELEASE_ROWS,
  homeSongWorkKey,
  fillUniqueHomeBatch,
  homeSongRailPageSize,
  loadMixedHomeChartPage,
  type HomeChartSource,
  type HomeReleasePage,
} from '../services/homeNewReleases';
import {
  newSongChart,
  trackCoverCandidates,
  type OnlineProvider,
} from '../services/onlineCatalog';
import type { QueueSource } from '../services/queuePaging';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';
import { createHomeTimingTrace } from '../services/homeTiming';

export interface HomeReleaseCacheState {
  tracks: Track[];
  page: number;
  hasMore: boolean;
  /** Remote continuation is independent of this rail's display deduplication. */
  remoteHasMore?: boolean;
  loading: boolean;
  error: string;
  sources: HomeChartSource[];
  nextOffset: number;
  refreshOffset?: number;
  pendingCount?: number;
}
const emptyState = (): HomeReleaseCacheState => ({
  tracks: [],
  page: 0,
  hasMore: true,
  loading: false,
  error: '',
  sources: [],
  nextOffset: 0,
});

export function HomeNewReleases({
  layout,
  source,
  fallbackSources = [],
  title = '新歌首发',
  testPrefix = 'home-release',
  onViewAll,
  refreshKey = 0,
  loadPage: customLoadPage,
  cache,
  onInitialLoadComplete,
  coverSectionOrder,
  timingKey,
  queueSourceForPlay,
  showPlatformDuration = true,
  singleProvider,
  allowDuplicateTracks = false,
  catalogIdentity,
  catalogProviderKey,
  replenishBlockedTracks = true,
  loadEnabled = true,
}: {
  layout: HomeLayoutMetrics;
  source?: { provider: OnlineProvider; id: string } | null;
  fallbackSources?: { provider: OnlineProvider; id: string }[];
  title?: string;
  testPrefix?: string;
  onViewAll?: (tracks: Track[]) => void;
  refreshKey?: number;
  loadPage?: (page: number, pageSize: number) => Promise<HomeReleasePage>;
  queueSourceForPlay?: (
    snapshot: HomeReleaseCacheState,
  ) => QueueSource | undefined;
  cache?: Map<string, HomeReleaseCacheState>;
  onInitialLoadComplete?: () => void;
  coverSectionOrder?: number;
  timingKey?: string;
  showPlatformDuration?: boolean;
  /** Restrict this Home song rail to the first passing startup platform. */
  singleProvider?: OnlineProvider;
  /** Song rails may intentionally keep repeated works from the selected source. */
  allowDuplicateTracks?: boolean;
  /** Custom Home catalogs keep their mounted batch when background health grows. */
  catalogIdentity?: string;
  /** New passing providers reopen continuation without resetting loaded data. */
  catalogProviderKey?: string;
  /** The music rail continues after filtered rows only on a real paging gesture. */
  replenishBlockedTracks?: boolean;
  /** Preserve committed media while a refreshed Home waits for this rail. */
  loadEnabled?: boolean;
}) {
  const app = useApp();
  const c = useTheme();
  const isChart = source !== undefined;
  const hasCustomRail = Boolean(customLoadPage);
  const sourceEntries = (
    isChart
      ? [source, ...fallbackSources].filter(
          (value): value is { provider: OnlineProvider; id: string } => !!value,
        )
      : app.recommendationPlatforms.map(item => ({
          provider: item.id,
          id: newSongChart(item.id),
        }))
  ).filter(value => !singleProvider || value.provider === singleProvider);
  const chartSourceKey = sourceEntries
    .map(value => `${value.provider}:${value.id}`)
    .join('|');
  const sourceKey = catalogIdentity ?? chartSourceKey;
  const candidates = useMemo(
    () =>
      !catalogIdentity && sourceKey
        ? sourceKey.split('|').map(value => {
            const [provider, id] = value.split(':');
            return { provider: provider as OnlineProvider, id: id! };
          })
        : [],
    [catalogIdentity, sourceKey],
  );
  const cacheKey = `${testPrefix}:${sourceKey}:${refreshKey}`;
  const refreshMetaKey = `${testPrefix}:${sourceKey}:refresh-meta`;
  const viewAll = isChart
    ? onViewAll
    : onViewAll ?? (() => app.open('new-songs'));
  const state = useRef(emptyState());
  const [snapshot, setSnapshot] = useState(state.current);
  const generation = useRef(0);
  const swipeStartX = useRef(0);
  const swipeTriggered = useRef(false);
  const loadNext = useRef<(targetPage?: number) => Promise<void>>(
    async () => undefined,
  );
  const requestedPage = useRef(1);
  const initialOffset = useRef(0);
  const rail = useRef<FlatList<Track[]>>(null);
  const initialLoadComplete = useRef(onInitialLoadComplete);
  const prewarmHomeTracks = useRef(app.prewarmHomeTracks);
  initialLoadComplete.current = onInitialLoadComplete;
  prewarmHomeTracks.current = app.prewarmHomeTracks;
  const previousCatalogProviders = useRef(catalogProviderKey);
  const catalogProvidersRef = useRef(catalogProviderKey);
  catalogProvidersRef.current = catalogProviderKey;

  useEffect(() => {
    const version = ++generation.current;
    const timing = timingKey
      ? createHomeTimingTrace(timingKey, 'new-releases')
      : undefined;
    timing?.('rail-mounted', { version });
    const cached = cache?.get(cacheKey);
    const resumeInterruptedBatch = Boolean(cached?.loading);
    // The previous mount owns its request. Its cached loading flag is not a
    // live request in this mount; keep records/cursors and resume that batch.
    state.current = cached ? { ...cached, loading: false } : emptyState();
    initialOffset.current = !customLoadPage
      ? cache?.get(refreshMetaKey)?.refreshOffset ?? 0
      : 0;
    swipeStartX.current = 0;
    swipeTriggered.current = false;
    requestedPage.current = Math.max(1, state.current.page);
    setSnapshot(state.current);
    rail.current?.scrollToOffset({ offset: 0, animated: false });
    let initialSettled = false;
    const finishInitialLoad = () => {
      if (initialSettled || generation.current !== version) return;
      initialSettled = true;
      initialLoadComplete.current?.();
    };
    const publish = (patch: Partial<HomeReleaseCacheState>) => {
      state.current = { ...state.current, ...patch };
      cache?.set(cacheKey, state.current);
      setSnapshot(state.current);
    };
    const load = async (targetPage = state.current.page + 1) => {
      if (!loadEnabled) return;
      requestedPage.current = Math.max(requestedPage.current, targetPage);
      if (
        (!customLoadPage && candidates.length === 0) ||
        state.current.loading ||
        !state.current.hasMore ||
        state.current.page >= requestedPage.current
      ) {
        if (!state.current.loading) finishInitialLoad();
        return;
      }
      publish({ loading: true, error: '' });
      const firstLoad = state.current.page === 0;
      const nextPage = state.current.page + 1;
      const startedAt = Date.now();
      const requestedProviders = catalogProvidersRef.current?.split('|') ?? [];
      timing?.('rail-request-start', { page: nextPage, version });
      try {
        let resolvedSources = state.current.sources;
        let additions: Track[];
        let hasMore: boolean;
        let remoteHasMore = state.current.remoteHasMore;
        let nextOffset = state.current.nextOffset;
        let error = '';
        const target = state.current.pendingCount ?? HOME_RELEASE_BATCH_SIZE;
        if (customLoadPage) {
          const result = await customLoadPage(
            nextPage,
            homeSongRailPageSize(nextPage),
          );
          if (generation.current !== version) return;
          const seen = new Set(state.current.tracks.map(track => track.id));
          additions = result.tracks.filter(track => {
            if (seen.has(track.id)) return false;
            seen.add(track.id);
            return true;
          });
          const providersGrew = Boolean(
            catalogIdentity &&
              catalogProvidersRef.current
                ?.split('|')
                .some(provider => !requestedProviders.includes(provider)),
          );
          hasMore = (result.hasMore && additions.length > 0) || providersGrew;
          remoteHasMore = result.hasMore || providersGrew;
        } else {
          resolvedSources = candidates;
          const keysOf = (track: Track) => [track.id, homeSongWorkKey(track)];
          const start =
            firstLoad && !state.current.nextOffset
              ? initialOffset.current
              : state.current.nextOffset;
          if (allowDuplicateTracks) {
            let wrappedToFirstBatch = false;
            let result = await loadMixedHomeChartPage(
              candidates,
              1,
              start,
              target,
              timing,
            );
            if (generation.current !== version) return;
            // Chart endpoints are finite and their total length can change
            // between refreshes. When the persisted refresh cursor now falls
            // beyond the current result, wrap this same provider/chart back
            // to its first batch instead of publishing an empty error rail.
            if (
              firstLoad &&
              start > 0 &&
              !result.tracks.length &&
              !result.hasMore
            ) {
              const wrapped = await loadMixedHomeChartPage(
                candidates,
                1,
                0,
                target,
                timing,
              );
              if (generation.current !== version) return;
              result = wrapped;
              wrappedToFirstBatch = true;
              nextOffset = wrapped.tracks.length ? target : 0;
            }
            additions = result.tracks.slice(0, target);
            hasMore = result.hasMore && additions.length > 0;
            if (!wrappedToFirstBatch) nextOffset = start + target;
            if (!additions.length && firstLoad && !hasMore)
              error = `${title}暂无可用数据`;
          } else {
            const fill = (offset: number, rawLimit: number) =>
              fillUniqueHomeBatch({
                offset,
                target,
                rawLimit,
                keysOf,
                seenKeys: new Set(state.current.tracks.flatMap(keysOf)),
                isCurrent: () => generation.current === version,
                timing,
                read: async (cursor, size) => {
                  const initialSlice =
                    cursor % HOME_RELEASE_BATCH_SIZE === 0 &&
                    size === HOME_RELEASE_BATCH_SIZE;
                  const result = timing
                    ? await loadMixedHomeChartPage(
                        candidates,
                        initialSlice ? cursor / HOME_RELEASE_BATCH_SIZE + 1 : 1,
                        initialSlice ? 0 : cursor,
                        size,
                        timing,
                      )
                    : initialSlice
                    ? await loadMixedHomeChartPage(
                        candidates,
                        cursor / HOME_RELEASE_BATCH_SIZE + 1,
                      )
                    : await loadMixedHomeChartPage(candidates, 1, cursor, size);
                  return { items: result.tracks, hasMore: result.hasMore };
                },
              });
            let result = await fill(start, HOME_RELEASE_BATCH_SIZE * 3);
            // Preserve finite-chart refresh wrapping, within this same raw budget.
            if (
              firstLoad &&
              start > 0 &&
              !result.items.length &&
              !result.hasMore &&
              !result.errors.length &&
              !result.cancelled &&
              result.rawRead < HOME_RELEASE_BATCH_SIZE * 3
            ) {
              result = await fill(
                0,
                HOME_RELEASE_BATCH_SIZE * 3 - result.rawRead,
              );
            }
            if (result.cancelled) return;
            if (
              firstLoad &&
              !result.items.length &&
              !result.hasMore &&
              !result.errors.length
            )
              throw new Error(`${title}暂无可用数据`);
            additions = result.items;
            hasMore = result.hasMore;
            nextOffset = result.nextOffset;
            error = result.errors.join('；');
            if (firstLoad && !additions.length && !error)
              error = `${title}暂无可用数据`;
          }
        }
        if (generation.current !== version) return;
        publish({
          tracks: [...state.current.tracks, ...additions],
          page: error ? state.current.page : nextPage,
          nextOffset,
          pendingCount: error ? target - additions.length : undefined,
          hasMore,
          ...(customLoadPage ? { remoteHasMore } : {}),
          error,
          loading: false,
          sources: resolvedSources,
        });
        timing?.('rail-published', {
          page: nextPage,
          ms: Date.now() - startedAt,
          added: additions.length,
          total: state.current.tracks.length,
          nextOffset,
          error: Boolean(error),
          version,
        });
        if (error) requestedPage.current = state.current.page;
        if (!customLoadPage)
          cache?.set(refreshMetaKey, {
            ...emptyState(),
            refreshOffset: hasMore ? nextOffset : 0,
          });
        if (firstLoad)
          prewarmHomeTracks.current(
            state.current.tracks.slice(0, HOME_RELEASE_ROWS * 2),
          );
        if (firstLoad) finishInitialLoad();
        if (
          !error &&
          state.current.hasMore &&
          state.current.page < requestedPage.current
        )
          load(requestedPage.current);
      } catch (error) {
        if (generation.current === version) {
          timing?.('rail-failed', {
            page: nextPage,
            ms: Date.now() - startedAt,
            version,
          });
          requestedPage.current = state.current.page;
          publish({
            loading: false,
            error: error instanceof Error ? error.message : '新歌加载失败',
          });
          if (firstLoad) finishInitialLoad();
        }
      }
    };
    loadNext.current = load;
    if (!state.current.tracks.length || resumeInterruptedBatch)
      load(state.current.page + 1);
    if (loadEnabled && state.current.tracks.length) finishInitialLoad();
    return () => {
      timing?.('rail-unmounted', { version });
      generation.current += 1;
    };
  }, [
    sourceKey,
    isChart,
    refreshKey,
    customLoadPage,
    title,
    cache,
    cacheKey,
    refreshMetaKey,
    candidates,
    catalogIdentity,
    timingKey,
    allowDuplicateTracks,
    loadEnabled,
  ]);

  useEffect(() => {
    const previous = previousCatalogProviders.current?.split('|') ?? [];
    previousCatalogProviders.current = catalogProviderKey;
    if (
      catalogIdentity &&
      catalogProviderKey
        ?.split('|')
        .some(provider => !previous.includes(provider))
    ) {
      state.current = { ...state.current, hasMore: true, remoteHasMore: true };
      cache?.set(cacheKey, state.current);
      setSnapshot(state.current);
    }
  }, [catalogIdentity, catalogProviderKey, cache, cacheKey]);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
    waitForInteraction: true,
  }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<Track[]>[] }) => {
      prewarmHomeTracks.current(
        viewableItems
          .filter(token => token.isViewable)
          .flatMap(token => token.item),
      );
    },
  ).current;
  const visibleTracks = useMemo(
    () => snapshot.tracks.filter(track => !app.isTrackBlocked?.(track)),
    [app, snapshot.tracks],
  );
  useEffect(() => {
    if (
      replenishBlockedTracks &&
      visibleTracks.length < snapshot.tracks.length &&
      snapshot.hasMore &&
      !snapshot.loading
    )
      loadNext.current();
  }, [
    replenishBlockedTracks,
    app.trackBlacklistVersion,
    snapshot.hasMore,
    snapshot.loading,
    snapshot.tracks.length,
    visibleTracks.length,
  ]);
  const columns = useMemo(() => {
    const groups: Track[][] = [];
    for (
      let index = 0;
      index < visibleTracks.length;
      index += HOME_RELEASE_ROWS
    )
      groups.push(visibleTracks.slice(index, index + HOME_RELEASE_ROWS));
    return groups;
  }, [visibleTracks]);

  return (
    <View
      testID={isChart || hasCustomRail ? testPrefix : 'home-new-releases'}
      style={[s.section, { height: layout.releaseHeight }]}
    >
      <OrderedCoverBatch
        sectionOrder={coverSectionOrder}
        candidates={visibleTracks.map(trackCoverCandidates)}
        moduleKey={sourceKey || testPrefix}
      />
      {visibleTracks.length ? (
        <SectionTitle
          title={title}
          action={viewAll ? '查看全部' : undefined}
          hideActionLabel
          onPress={viewAll ? () => viewAll(visibleTracks) : undefined}
          actionTestID={
            isChart || hasCustomRail
              ? `${testPrefix}-all`
              : 'home-new-songs-all'
          }
          darkMode={false}
        />
      ) : null}
      <FlatList
        key={sourceKey || 'disabled'}
        ref={rail}
        testID={`${testPrefix}-rail`}
        horizontal
        data={columns}
        keyExtractor={items => items[0]!.id}
        extraData={layout}
        showsHorizontalScrollIndicator={false}
        style={{ height: layout.releaseHeight - 35 }}
        contentContainerStyle={s.rail}
        initialNumToRender={Math.ceil(
          HOME_RELEASE_BATCH_SIZE / HOME_RELEASE_ROWS,
        )}
        windowSize={5}
        maxToRenderPerBatch={Math.ceil(
          HOME_RELEASE_BATCH_SIZE / HOME_RELEASE_ROWS,
        )}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        onScrollBeginDrag={({ nativeEvent }) => {
          swipeStartX.current = nativeEvent.contentOffset.x;
          swipeTriggered.current = false;
        }}
        onScroll={({ nativeEvent }) => {
          if (
            !swipeTriggered.current &&
            !state.current.error &&
            nativeEvent.contentOffset.x > swipeStartX.current + 1
          ) {
            swipeTriggered.current = true;
            loadNext.current(requestedPage.current + 1);
          }
        }}
        onScrollEndDrag={({ nativeEvent }) => {
          if (
            !swipeTriggered.current &&
            !state.current.error &&
            nativeEvent.contentOffset.x > swipeStartX.current + 1
          ) {
            swipeTriggered.current = true;
            loadNext.current(requestedPage.current + 1);
          }
        }}
        scrollEventThrottle={100}
        snapToInterval={layout.releaseCardWidth + 14}
        decelerationRate="fast"
        getItemLayout={(_data, index) => ({
          index,
          length: layout.releaseCardWidth + 14,
          offset: 18 + index * (layout.releaseCardWidth + 14),
        })}
        renderItem={({ item: tracks, index: column }) => (
          <View
            testID={`${testPrefix}-column`}
            style={[s.column, { width: layout.releaseCardWidth }]}
          >
            {tracks.map((track, row) => (
              <Pressable
                key={track.id}
                testID={`${testPrefix}-card`}
                accessibilityRole="button"
                accessibilityLabel={`播放 ${track.title}`}
                onPress={() =>
                  app
                    .playTrack(
                      track,
                      visibleTracks,
                      column * HOME_RELEASE_ROWS + row,
                      {
                        queueOrigin: app.captureQueueOrigin?.(title),
                        queueSource:
                          queueSourceForPlay?.(snapshot) ??
                          (snapshot.sources.length
                            ? {
                                kind: 'chart-mix',
                                sources: snapshot.sources,
                                offset: snapshot.nextOffset,
                                hasMore: snapshot.hasMore,
                              }
                            : undefined),
                      },
                    )
                    .catch(() => undefined)
                }
                style={[s.card, { height: layout.releaseCardHeight }]}
              >
                <ResilientHomeCover
                  visualOrder={
                    coverSectionOrder === undefined
                      ? undefined
                      : [coverSectionOrder, column * HOME_RELEASE_ROWS + row]
                  }
                  uri={track.cover}
                  uris={trackCoverCandidates(track)}
                  fallback={covers[track.coverKey]}
                  resizeMethod="resize"
                  testID={`${testPrefix}-cover`}
                  clipToImageStyle
                  style={{
                    width: layout.releaseCoverSize,
                    height: layout.releaseCoverSize,
                  }}
                  imageStyle={s.cover}
                />
                <View style={s.copy}>
                  <Text numberOfLines={1} style={[s.title, { color: c.text }]}>
                    {track.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[s.artist, { color: c.muted }]}
                  >
                    {track.artist}
                  </Text>
                </View>
                {showPlatformDuration ? (
                  <TrackPlatformDuration
                    track={track}
                    color={c.muted}
                    testIDPrefix={testPrefix}
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
        ListFooterComponent={
          snapshot.error ? (
            <View style={s.status}>
              <Pressable
                testID={`${testPrefix}-retry`}
                accessibilityRole="button"
                onPress={() => loadNext.current()}
              >
                <Text style={{ color: c.blue }}>加载失败，点击重试</Text>
              </Pressable>
            </View>
          ) : !snapshot.loading &&
            snapshot.page > 0 &&
            !snapshot.tracks.length ? (
            <View style={s.status}>
              <Text style={{ color: c.muted }}>暂无可用{title}</Text>
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginTop: 10, paddingTop: 8, backgroundColor: 'transparent' },
  header: {
    height: 27,
    marginHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heading: { flex: 1, fontSize: 16, fontWeight: '400' },
  more: { height: 27, paddingLeft: 12, justifyContent: 'center' },
  moreText: { fontSize: 13, fontWeight: '400' },
  rail: { paddingHorizontal: 18, paddingTop: 4 },
  column: { marginRight: 14, gap: 6 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  cover: { borderRadius: 9 },
  copy: { flex: 1, minWidth: 0, marginLeft: 11 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  artist: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  status: {
    width: 125,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
});
