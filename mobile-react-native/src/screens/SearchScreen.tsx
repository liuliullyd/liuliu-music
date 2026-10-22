import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { covers } from '../assets/covers';
import { platformCaption, platformLabel } from '../components/platformLabels';
import { QueueTrackActions } from '../components/QueueTrackActions';
import { ResilientHomeCover } from '../components/ResilientHomeCover';
import { StickyBackgroundExtension } from '../components/StickyBackgroundExtension';
import { StickyPressable } from '../components/StickyPressable';
import { TrackActionIcon } from '../components/TrackActionIcon';
import { Cover, Glyph, TrackPlatformDuration } from '../components/UI';
import { useStableNativeScrollEvent } from '../components/useStableNativeScrollEvent';
import { useVisibleTrackPrewarm } from '../components/useVisibleTrackPrewarm';
import {
  trackQueueKey,
  type CatalogItem,
  type PlatformSetting,
  type Track,
} from '../domain/types';
import {
  getCatalog,
  getCollection,
  trackCoverCandidates,
} from '../services/onlineCatalog';
import {
  collectSearchAlbums,
  collectSearchArtists,
} from '../services/searchEntities';
import { byStartupPassOrder } from '../services/startupPlatformOrder';
import {
  useApp,
  useCatalogViewState,
  type SearchCategory,
} from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { serif, useTheme, type ThemePalette } from '../theme';
import { CollectionDetail } from './HomeScreen';
const categories: Array<{
  id: SearchCategory;
  label: string;
  unit: string;
}> = [
  { id: 'song', label: '单曲', unit: '首单曲' },
  { id: 'artist', label: '歌手', unit: '位歌手' },
  { id: 'album', label: '专辑', unit: '张专辑' },
  { id: 'playlist', label: '歌单', unit: '个歌单' },
];
type SearchRankItem = {
  title: string;
  artist: string;
  cover?: string;
};
const musicProviderIds: PlatformSetting['id'][] = [
  'netease',
  'qq',
  'kugou',
  'kuwo',
  'migu',
  'qishui',
];
export function SearchScreen({
  backgroundScrollY,
}: {
  backgroundScrollY?: Animated.Value;
}) {
  const { s } = useSearchStyles();
  const app = useApp();
  const layout = useLayout();
  const localScrollY = useRef(new Animated.Value(0)).current;
  const searchScrollY = backgroundScrollY ?? localScrollY;
  const searchRoot = app.tab === 'search' && app.page === 'root';
  const [queryState, setQuery] = useState(app.search.query);
  const [categoryState, setCategory] = useState<SearchCategory>(
    app.search.category,
  );
  const [providerState, setProvider] = useState<'all' | PlatformSetting['id']>(
    app.search.provider,
  );
  const [rising, setRising] = useState<SearchRankItem[]>([]);
  const [reviewed, setReviewed] = useState<SearchRankItem[]>([]);
  const [rankReady, setRankReady] = useState(false);
  const [controlsPinned, setControlsPinned] = useState(false);
  const [detailItem, setDetailItem] = useCatalogViewState<CatalogItem | null>(
    'search-detail',
    null,
  );
  const searchAppendInFlight = useRef(false);
  const restoredControlsVersion = useRef(app.catalogRestore?.version);
  let query = queryState,
    category = categoryState,
    provider = providerState;
  if (restoredControlsVersion.current !== app.catalogRestore?.version) {
    restoredControlsVersion.current = app.catalogRestore?.version;
    if (app.catalogRestore?.keys.includes('search-detail')) {
      query = app.search.query;
      category = app.search.category;
      provider = app.search.provider;
      setQuery(app.search.query);
      setCategory(app.search.category);
      setProvider(app.search.provider);
    }
  }
  useLayoutEffect(() => {
    if (!searchRoot) return;
    searchScrollY.setValue(0);
    setControlsPinned(false);
  }, [searchRoot, searchScrollY]);
  const availableProviders = useMemo(() => {
    const healthy = byStartupPassOrder(
      app.recommendationPlatforms
        .map(item => item.id)
        .filter(id => musicProviderIds.includes(id)),
      app.startupHealth,
    );

    return healthy;
  }, [app.recommendationPlatforms, app.startupHealth, category]);
  // Keep the platform row present while the once-per-launch health probe is
  // settling.  Unhealthy or not-yet-tested platforms are rendered disabled;
  // only `availableProviders` can submit a request or contribute results.
  const visibleProviders = useMemo(() => {
    const visible: PlatformSetting['id'][] = musicProviderIds;
    return byStartupPassOrder(visible, app.startupHealth, availableProviders);
  }, [availableProviders, app.startupHealth, category]);
  useEffect(() => {
    if (app.search.provider !== 'all') {
      setProvider(app.search.provider);
      return;
    }
    if (!availableProviders.includes(provider as PlatformSetting['id']))
      setProvider(availableProviders[0] ?? 'all');
  }, [app.search.provider, availableProviders, provider]);
  useEffect(() => {
    let cancelled = false;
    setRankReady(false);
    const load = async () => {
      const providers = app.recommendationPlatforms.map(item => item.id);
      if (!providers.length) return;
      const batches = await Promise.allSettled(
        providers.map(async provider => {
          const charts = await getCatalog(provider, 'charts');
          const rise = charts.find(item => /飙升/.test(item.title));
          const hotChart = charts.find(item => /热歌|热评/.test(item.title));
          const [riseDetail, hotDetail] = await Promise.all([
            rise ? getCollection(provider, 'charts', rise.id) : null,
            hotChart ? getCollection(provider, 'charts', hotChart.id) : null,
          ]);
          return {
            rise: riseDetail?.tracks ?? [],
            hot: hotDetail?.tracks ?? [],
          };
        }),
      );
      if (cancelled) return;
      const risingItems: SearchRankItem[] = [];
      const hotItems: SearchRankItem[] = [];
      const riseSeen = new Set<string>();
      const hotSeen = new Set<string>();
      for (const result of batches) {
        if (result.status !== 'fulfilled') continue;
        for (const track of result.value.rise) {
          const key = `${track.title}\u0000${track.artist}`;
          if (riseSeen.has(key)) continue;
          riseSeen.add(key);
          risingItems.push({
            title: track.title,
            artist: track.artist,
            cover: track.cover,
          });
        }
        for (const track of result.value.hot) {
          const key = `${track.title}\u0000${track.artist}`;
          if (hotSeen.has(key)) continue;
          hotSeen.add(key);
          hotItems.push({
            title: track.title,
            artist: track.artist,
            cover: track.cover,
          });
        }
      }
      setRising(risingItems.slice(0, 10));
      setReviewed(hotItems.slice(0, 10));
      setRankReady(true);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [app.recommendationPlatforms]);
  const visiblePrewarm = useVisibleTrackPrewarm({
    identity: `${app.search.query}:${app.search.provider}:${
      app.search.category
    }:${app.prewarmContextKey ?? app.state?.settings.quality}:${
      app.pageRefreshToken ?? 0
    }`,
    enabled:
      searchRoot && app.search.category === 'song' && Boolean(app.search.query),
    nestedList: true,
    tracks: app.search.tracks,
    prewarm: app.prewarmDetailTracks,
    release: app.releaseDetailPrewarm,
  });
  const submit = (
    value = query,
    nextCategory: SearchCategory = category,
    page = 1,
    nextProvider: 'all' | PlatformSetting['id'] = provider,
    append = false,
  ) => {
    const term = value.trim();
    if (!term) return Promise.resolve();
    if (nextProvider === 'all' && !availableProviders.length)
      return Promise.resolve();
    const selectedProvider: PlatformSetting['id'] =
      nextProvider === 'all' ? availableProviders[0]! : nextProvider;
    setQuery(term);
    setCategory(nextCategory);
    setProvider(selectedProvider);
    return app
      .runSearch(term, selectedProvider, page, nextCategory, append)
      .catch(() => undefined);
  };
  const loadNextSearchPage = () => {
    if (
      !app.search.query ||
      app.search.loading ||
      !app.search.hasNext ||
      searchAppendInFlight.current
    )
      return;
    searchAppendInFlight.current = true;
    void submit(
      app.search.query,
      app.search.category,
      app.search.page + 1,
      app.search.provider,
      true,
    ).finally(() => {
      searchAppendInFlight.current = false;
    });
  };
  const selectCategory = (next: SearchCategory) => {
    setCategory(next);
    const nextProvider =
      provider !== 'all' && availableProviders.includes(provider)
        ? provider
        : availableProviders[0] ?? 'all';
    setProvider(nextProvider);
    if (query.trim()) submit(query, next, 1, nextProvider);
  };
  const selectProvider = (next: PlatformSetting['id']) => {
    if (!availableProviders.includes(next)) return;
    setProvider(next);
    if (query.trim()) submit(query, category, 1, next);
  };
  const restoreSearchLanding = () => {
    app.resetSearch();
    setQuery('');
    setCategory('song');
    setProvider(availableProviders[0] ?? 'all');
  };
  const updateQuery = (value: string) => {
    setQuery(value);
    if (!value.trim() && app.search.query) restoreSearchLanding();
  };
  const openCollection = (item: CatalogItem) => {
    setDetailItem(canonicalCollectionItem(item));
    app.open('search-playlist');
  };
  const searchScrollEvent = useStableNativeScrollEvent(
    searchScrollY,
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      visiblePrewarm.onScroll(nativeEvent);
      setControlsPinned(nativeEvent.contentOffset.y >= layout.pageTopPadding);
      const distanceToBottom =
        nativeEvent.contentSize.height -
        (nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height);
      if (distanceToBottom <= 600) loadNextSearchPage();
    },
  );
  if (app.page === 'search-playlist')
    return <CollectionDetail item={detailItem} searchAppearance />;
  const hasResults = Boolean(app.search.query);
  return (
    <Animated.ScrollView
      testID="search-home"
      style={[s.root, { backgroundColor: 'transparent' }]}
      stickyHeaderIndices={[0]}
      contentContainerStyle={[
        s.content,
        {
          paddingHorizontal: layout.pageHorizontalPadding,
          paddingTop: layout.pageTopPadding,
          paddingBottom: layout.scrollBottomPadding,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      onLayout={visiblePrewarm.onLayout}
      onScroll={searchScrollEvent}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() =>
            query.trim() ? submit(query, category, 1) : app.refreshPage()
          }
        />
      }
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      <View
        testID="search-sticky-controls"
        onLayout={visiblePrewarm.onControlsLayout}
        collapsable={false}
        style={[
          s.stickyControls,
          {
            marginHorizontal: -layout.pageHorizontalPadding,
            paddingHorizontal: layout.pageHorizontalPadding,
          },
          controlsPinned && s.stickyControlsPinned,
        ]}
      >
        <StickyBackgroundExtension
          active={controlsPinned}
          color={s.stickyControlsPinned.backgroundColor}
        />
        <SearchHeader
          query={query}
          setQuery={updateQuery}
          submit={() => {
            void submit();
          }}
          clear={restoreSearchLanding}
          onBack={() => {
            if (hasResults) {
              restoreSearchLanding();
            } else app.back();
          }}
        />
        <CategoryTabs selected={category} onSelect={selectCategory} />
        <ProviderTabs
          selected={provider}
          providers={visibleProviders}
          enabledProviders={availableProviders}
          onSelect={selectProvider}
        />
      </View>
      <SearchPlaybackStatus />
      <SearchLanding
        hasResults={hasResults}
        category={category}
        onArtist={openCollection}
        onAlbum={openCollection}
        onCollection={openCollection}
        onPage={page => submit(query, category, page)}
        submit={value => {
          void submit(value, category, 1);
        }}
        rising={rising}
        reviewed={reviewed}
        rankReady={rankReady}
        visiblePrewarm={visiblePrewarm}
      />
    </Animated.ScrollView>
  );
}
function SearchPlaybackStatus() {
  const { s } = useSearchStyles();
  const app = useApp();
  if (!app.busy && !app.message.startsWith('正在')) return null;
  return (
    <View testID="search-playback-status" style={s.playbackStatus}>
      <Text style={s.playbackStatusText}>
        {app.message.startsWith('正在') ? app.message : '正在启动播放…'}
      </Text>
    </View>
  );
}
function SearchHeader({
  query,
  setQuery,
  submit,
  clear,
  onBack,
}: {
  query: string;
  setQuery: (value: string) => void;
  submit: () => void;
  clear: () => void;
  onBack: () => void;
}) {
  const { s, theme } = useSearchStyles();
  return (
    <View testID="search-header-row" style={s.searchHeaderRow}>
      <StickyPressable
        testID="search-back"
        accessibilityRole="button"
        accessibilityLabel="返回"
        onPress={onBack}
        hitSlop={14}
        pressRetentionOffset={14}
        style={s.backButton}
      >
        <Text style={s.backGlyph}>‹</Text>
      </StickyPressable>
      <View testID="search-box" style={s.searchBox}>
        <TextInput
          testID="search-input"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={submit}
          returnKeyType="search"
          placeholder="搜索歌曲、歌手、专辑或声音内容"
          placeholderTextColor={theme.muted}
          style={s.input}
        />
        {query ? (
          <StickyPressable
            accessibilityLabel="清空搜索关键词"
            onPress={clear}
            style={s.inputAction}
          >
            <Glyph color={theme.muted}>×</Glyph>
          </StickyPressable>
        ) : null}
        <StickyPressable
          testID="search-submit"
          accessibilityRole="button"
          accessibilityLabel="搜索"
          onPress={submit}
          style={s.searchButton}
          hitSlop={6}
        >
          <Glyph color={theme.accent} size={27}>
            ⌕
          </Glyph>
        </StickyPressable>
      </View>
    </View>
  );
}
function CategoryTabs({
  selected,
  onSelect,
}: {
  selected: SearchCategory;
  onSelect: (value: SearchCategory) => void;
}) {
  const { s } = useSearchStyles();
  return (
    <View testID="search-category-tabs" style={s.tabs}>
      {categories.map(item => (
        <StickyPressable
          key={item.id}
          testID={`search-tab-${item.id}`}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === item.id }}
          onPress={() => onSelect(item.id)}
          style={[s.tab, selected === item.id && s.tabActive]}
        >
          <Text style={[s.tabText, selected === item.id && s.tabTextActive]}>
            {item.label}
          </Text>
        </StickyPressable>
      ))}
    </View>
  );
}
function ProviderTabs({
  selected,
  providers,
  enabledProviders,
  onSelect,
}: {
  selected: 'all' | PlatformSetting['id'];
  providers: PlatformSetting['id'][];
  enabledProviders: PlatformSetting['id'][];
  onSelect: (value: PlatformSetting['id']) => void;
}) {
  const { s } = useSearchStyles();
  return (
    <ScrollView
      testID="search-provider-tabs"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.providerTabs}
      showsVerticalScrollIndicator={false}
    >
      {providers.map(id => (
        <StickyPressable
          key={id}
          testID={`search-provider-${id}`}
          accessibilityRole="button"
          accessibilityState={{
            disabled: !enabledProviders.includes(id),
            selected: selected === id,
          }}
          onPress={() => onSelect(id)}
          style={[
            s.providerTab,
            selected === id && s.providerTabActive,
            !enabledProviders.includes(id) && s.providerTabDisabled,
          ]}
        >
          <Text
            style={[
              s.providerTabText,
              selected === id && s.providerTabTextActive,
              !enabledProviders.includes(id) && s.providerTabTextDisabled,
            ]}
          >
            {platformLabel(id)}
          </Text>
        </StickyPressable>
      ))}
    </ScrollView>
  );
}
function SearchLanding({
  hasResults,
  category,
  onArtist,
  onAlbum,
  onCollection,
  onPage,
  submit,
  rising,
  reviewed,
  rankReady,
  visiblePrewarm,
}: {
  hasResults: boolean;
  category: SearchCategory;
  onArtist: (item: CatalogItem) => void;
  onAlbum: (item: CatalogItem) => void;
  onCollection: (item: CatalogItem) => void;
  onPage: (page: number) => void;
  submit: (value: string) => void;
  rising: SearchRankItem[];
  reviewed: SearchRankItem[];
  rankReady: boolean;
  visiblePrewarm: ReturnType<typeof useVisibleTrackPrewarm>;
}) {
  const { s } = useSearchStyles();
  const app = useApp();
  return (
    <>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>历史搜索</Text>
        {app.state.searchHistory.length ? (
          <Pressable
            accessibilityLabel="清空搜索历史"
            onPress={app.clearSearchHistory}
            style={s.sectionAction}
          >
            <Text style={s.trash}>♲</Text>
          </Pressable>
        ) : null}
      </View>
      <View testID="search-history-chips" style={s.historyChips}>
        {app.state.searchHistory.map(item => (
          <Pressable
            key={item}
            onPress={() => submit(item)}
            style={s.historyChip}
          >
            <Text style={s.historyText}>{item}</Text>
          </Pressable>
        ))}
      </View>
      {hasResults ? (
        <View
          testID="search-inline-results"
          onLayout={visiblePrewarm.onListContainerLayout}
        >
          <SearchResults
            category={category}
            onArtist={onArtist}
            onAlbum={onAlbum}
            onCollection={onCollection}
            onPage={onPage}
            visiblePrewarm={visiblePrewarm}
          />
        </View>
      ) : rankReady ? (
        <View testID="search-rank-row" style={s.rankRow}>
          <SearchRank title="搜索飙升" items={rising} submit={submit} />
          <SearchRank title="热评歌曲" items={reviewed} submit={submit} />
        </View>
      ) : null}
    </>
  );
}
function SearchRank({
  title,
  items,
  submit,
}: {
  title: string;
  items: SearchRankItem[];
  submit: (value: string) => void;
}) {
  const { s } = useSearchStyles();
  return (
    <View style={s.rankCard}>
      <Text style={s.rankTitle}>{title}</Text>
      {items.slice(0, 10).map((item, index) => (
        <Pressable
          key={`${item.title}-${index}`}
          style={s.rankItem}
          onPress={() => submit(item.title)}
        >
          <Text style={[s.rankNumber, index < 3 && s.rankTop]}>
            {index + 1}
          </Text>
          <View style={s.rankCopy}>
            <Text numberOfLines={1} style={s.rankSong}>
              {item.title}
            </Text>
            {item.artist ? (
              <Text numberOfLines={1} style={s.rankArtist}>
                {item.artist}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}
function SearchResults({
  category,
  onArtist,
  onAlbum,
  onCollection,
  onPage,
  visiblePrewarm,
}: {
  category: SearchCategory;
  onArtist: (item: CatalogItem) => void;
  onAlbum: (item: CatalogItem) => void;
  onCollection: (item: CatalogItem) => void;
  onPage: (page: number) => void;
  visiblePrewarm: ReturnType<typeof useVisibleTrackPrewarm>;
}) {
  const { s } = useSearchStyles();
  const app = useApp();
  const artists = useMemo(
    () => collectSearchArtists(app.search.tracks),
    [app.search.tracks],
  );
  const albums = useMemo(
    () => collectSearchAlbums(app.search.tracks),
    [app.search.tracks],
  );
  const count =
    category === 'song'
      ? app.search.tracks.length
      : category === 'artist'
      ? artists.length
      : category === 'album'
      ? albums.length
      : app.search.playlists.length;
  const favoriteType =
    category === 'artist'
      ? '歌手'
      : category === 'album'
      ? '专辑'
      : category === 'playlist'
      ? '歌单'
      : '歌单';
  return (
    <>
      {app.search.loading ? <Text style={s.resultCount}>正在搜索…</Text> : null}
      {app.search.errors.length ? (
        <Text
          testID="search-source-errors"
          numberOfLines={3}
          style={s.resultError}
        >
          {app.search.errors.slice(0, 5).join(' · ')}
        </Text>
      ) : null}
      <View
        testID="search-result-list"
        style={s.resultList}
        onLayout={visiblePrewarm.onListLayout}
      >
        {category === 'song'
          ? app.search.tracks.map((track, index) => (
              <SongResultRow
                key={track.id}
                track={track}
                onLayout={event =>
                  visiblePrewarm.onRowLayout(trackQueueKey(track), event)
                }
                onPlay={() =>
                  app
                    .playTrack(track, app.search.tracks, index, {
                      queueOrigin: app.captureQueueOrigin?.(),
                      queueSource: {
                        kind: 'search',
                        query: app.search.query,
                        provider: app.search.provider,
                        page: app.search.page,
                        hasMore: app.search.queueHasMore ?? app.search.hasNext,
                        providerPages: app.search.queueProviderPages,
                      },
                    })
                    .catch(() => undefined)
                }
              />
            ))
          : category === 'artist'
          ? artists.map(({ key, title, track, item }) => (
              <EntityResultRow
                key={key}
                item={item}
                favoriteType={favoriteType}
                title={title}
                subtitle={`${platformLabel(track.provider)} · 查看真实歌曲目录`}
                cover={track.cover}
                coverCandidates={trackCoverCandidates(track)}
                round
                onPress={() => onArtist(item)}
              />
            ))
          : category === 'album'
          ? albums.map(({ key, title, track, item }) => (
              <EntityResultRow
                key={key}
                item={item}
                favoriteType={favoriteType}
                title={title}
                subtitle={`${track.artist}${
                  track.releaseYear ? ` · ${track.releaseYear}` : ''
                }`}
                cover={track.cover}
                coverCandidates={trackCoverCandidates(track)}
                onPress={() => onAlbum(item)}
              />
            ))
          : app.search.playlists.map(item => (
              <EntityResultRow
                key={`${item.provider}:${item.id}`}
                item={canonicalCollectionItem(item)}
                favoriteType={favoriteType}
                title={item.title}
                subtitle={
                  [
                    item.artist ||
                      platformCaption(item.description, item.provider),
                    platformLabel(item.provider),
                  ]
                    .filter(
                      (value, index, values) =>
                        Boolean(value) && values.indexOf(value) === index,
                    )
                    .join(' · ') || platformLabel(item.provider)
                }
                cover={item.cover}
                coverCandidates={item.coverCandidates}
                onPress={() => onCollection(item)}
              />
            ))}
      </View>
      {!app.search.loading && !count ? (
        <Text style={s.empty}>
          {app.search.errors[0] || '没有找到相关内容，试试更短的关键词'}
        </Text>
      ) : null}
      {!app.search.loading && count ? (
        <View style={s.pager}>
          <Pressable
            testID="search-page-previous"
            disabled={app.search.page <= 1}
            onPress={() => onPage(app.search.page - 1)}
            style={[s.pageButton, app.search.page <= 1 && s.disabled]}
          >
            <Text style={s.pageButtonText}>上一页</Text>
          </Pressable>
          <Text testID="search-page-label" style={s.pageLabel}>
            第 {app.search.page} 页
          </Text>
          <Pressable
            testID="search-page-next"
            disabled={!app.search.hasNext}
            onPress={() => onPage(app.search.page + 1)}
            style={[s.pageButton, !app.search.hasNext && s.disabled]}
          >
            <Text style={s.pageButtonText}>下一页</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}
function SongResultRow({
  track,
  onPlay,
  onLayout,
}: {
  track: Track;
  onPlay: () => void;
  onLayout: (event: import('react-native').LayoutChangeEvent) => void;
}) {
  const { s, theme } = useSearchStyles();
  return (
    <View testID="search-song-result" style={s.songRow} onLayout={onLayout}>
      <Pressable
        testID="search-song-main"
        accessibilityLabel={`播放 ${track.title}`}
        onPress={onPlay}
        style={s.songMain}
      >
        <Cover
          coverKey={track.coverKey}
          uri={track.cover}
          fallbackUris={trackCoverCandidates(track)}
          moduleKey="search-song-results"
          testID="search-song-cover"
          size={58}
          radius={8}
        />
        <View style={s.resultCopy}>
          <Text numberOfLines={1} style={s.resultTitle}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={s.resultMeta}>
            {track.artist}
          </Text>
        </View>
        <TrackPlatformDuration
          track={track}
          color={theme.muted}
          testIDPrefix="search-song"
        />
      </Pressable>
      <QueueTrackActions track={track} showRemove={false} scope="search-song" />
    </View>
  );
}
function EntityResultRow({
  item,
  favoriteType,
  title,
  subtitle,
  cover,
  coverCandidates = [],
  round = false,
  onPress,
}: {
  item: CatalogItem;
  favoriteType: string;
  title: string;
  subtitle: string;
  cover?: string;
  coverCandidates?: string[];
  round?: boolean;
  onPress: () => void;
}) {
  const { s, theme } = useSearchStyles();
  const app = useApp();
  const favorite = app.isCollectionFavorite(item);
  const favoriteLabel = `${
    favorite ? '取消收藏' : '收藏'
  }${favoriteType} ${title}`;
  const key = `${item.provider}:${
    item.metadata?.collectionKind === 'artist'
      ? 'artist'
      : item.metadata?.collectionKind === 'new-albums'
      ? 'album'
      : 'playlist'
  }:${item.id}`;
  return (
    <View style={s.entityRow}>
      <Pressable
        testID={`search-entity-main-${key}`}
        accessibilityRole="button"
        accessibilityLabel={`打开 ${title}`}
        onPress={onPress}
        style={s.entityMain}
      >
        <ResilientHomeCover
          uri={cover}
          uris={coverCandidates}
          fallback={covers.vinyl}
          testID="search-entity-cover"
          style={s.entityCover}
          imageStyle={{ borderRadius: round ? 29 : 8 }}
        />
        <View style={s.resultCopy}>
          <Text numberOfLines={1} style={s.resultTitle}>
            {title}
          </Text>
          <Text numberOfLines={1} style={s.resultMeta}>
            {subtitle}
          </Text>
        </View>
      </Pressable>
      <Pressable
        testID={`search-entity-favorite-${key}`}
        accessibilityRole="button"
        accessibilityLabel={favoriteLabel}
        accessibilityState={{ selected: favorite }}
        onPress={() => app.toggleCollectionFavorite(item)}
        style={s.entityFavorite}
        hitSlop={8}
      >
        <TrackActionIcon
          kind="favorite"
          active={favorite}
          size={23}
          color={favorite ? theme.accent : theme.muted}
        />
      </Pressable>
    </View>
  );
}
function canonicalCollectionItem(item: CatalogItem): CatalogItem {
  return {
    ...item,
    metadata: {
      ...item.metadata,
      detailLayout: 'playlist',
      detailTopGradient: true,
    },
  };
}
function useSearchStyles() {
  const theme = useTheme();
  const s = useMemo(() => searchStyles(theme), [theme]);
  return { s, theme };
}
const searchStyles = (theme: ThemePalette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    content: { paddingHorizontal: 22, paddingTop: 8 },
    stickyControls: { backgroundColor: 'transparent' },
    stickyControlsPinned: { backgroundColor: theme.bg },
    searchHeaderRow: {
      minHeight: 49,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    backButton: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backGlyph: {
      color: theme.text,
      fontSize: 40,
      lineHeight: 44,
      fontWeight: '400',
    },
    searchBox: {
      flex: 1,
      height: 49,
      marginTop: 3,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 16,
      paddingLeft: 13,
      backgroundColor: theme.panelSoft,
    },
    input: {
      flex: 1,
      color: theme.text,
      fontSize: 15,
      marginLeft: 8,
      paddingVertical: 0,
    },
    inputAction: {
      width: 38,
      height: 46,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchButton: {
      height: 46,
      width: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabs: { flexDirection: 'row', marginTop: 16, gap: 5 },
    tab: {
      flex: 1,
      height: 34,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      backgroundColor: theme.panelSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabActive: {
      backgroundColor: theme.selectedSurface,
    },
    tabText: { color: theme.muted, fontSize: 12, fontWeight: '400' },
    tabTextActive: { color: theme.accent },
    providerTabs: { gap: 8, paddingTop: 10, paddingRight: 4 },
    providerTab: {
      minWidth: 68,
      height: 32,
      paddingHorizontal: 12,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      backgroundColor: theme.panelSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    providerTabActive: {
      backgroundColor: theme.selectedSurface,
    },
    providerTabDisabled: {
      opacity: 0.46,
    },
    providerTabText: { color: theme.muted, fontSize: 12, fontWeight: '400' },
    providerTabTextActive: { color: theme.accent },
    providerTabTextDisabled: { color: theme.muted },
    sectionHead: {
      minHeight: 42,
      marginTop: 18,
      flexDirection: 'row',
      alignItems: 'center',
    },
    discoveryHead: {
      minHeight: 42,
      marginTop: 18,
      flexDirection: 'row',
      alignItems: 'center',
    },
    quickEntryRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginTop: 18,
      paddingVertical: 4,
    },
    quickEntry: { alignItems: 'center', gap: 5, minWidth: 62 },
    quickGlyph: { color: theme.text, fontSize: 27, lineHeight: 31 },
    quickLabel: { color: theme.text, fontSize: 13 },
    sectionTitle: {
      flex: 1,
      color: theme.text,
      fontFamily: serif,
      fontSize: 19,
      fontWeight: '400',
    },
    sectionAction: { minHeight: 40, justifyContent: 'center' },
    sectionActionText: { color: theme.muted, fontSize: 13 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      minHeight: 32,
      borderRadius: 12,
      paddingHorizontal: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.panelSoft,
    },
    chipText: { color: theme.text, fontSize: 13 },
    banner: {
      height: 133,
      marginTop: 17,
      borderRadius: 13,
      overflow: 'hidden',
      padding: 20,
      justifyContent: 'center',
    },
    bannerRadius: { borderRadius: 13 },
    bannerShade: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: 'rgba(0,48,110,.22)',
    },
    bannerTitle: {
      color: '#fff',
      fontFamily: serif,
      fontSize: 22,
      lineHeight: 32,
      fontWeight: '400',
    },
    bannerLine: {
      width: 88,
      borderBottomWidth: 1.5,
      borderBottomColor: '#fff',
      marginTop: 5,
      transform: [{ rotate: '-8deg' }],
    },
    trash: { color: theme.muted, fontSize: 20 },
    historyChips: {
      maxHeight: 78,
      overflow: 'hidden',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    historyChip: {
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: theme.panelSoft,
    },
    rankRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 18,
    },
    rankCard: {
      flex: 1,
      minWidth: 0,
      borderRadius: 15,
      backgroundColor: theme.panelSoft,
      paddingHorizontal: 12,
      paddingVertical: 13,
    },
    rankTitle: {
      color: theme.text,
      fontFamily: serif,
      fontSize: 19,
      marginBottom: 7,
    },
    rankItem: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    rankNumber: {
      width: 18,
      color: theme.muted,
      fontSize: 14,
      textAlign: 'center',
    },
    rankTop: { color: theme.accent, fontWeight: '600' },
    rankCopy: { flex: 1, minWidth: 0 },
    rankSong: { color: theme.text, fontSize: 13 },
    rankArtist: { color: theme.muted, fontSize: 10, marginTop: 2 },
    historyText: { color: theme.text, fontSize: 13 },
    historyRemove: {
      width: 30,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    historyRemoveText: { color: theme.muted, fontSize: 16 },
    resultCount: {
      color: theme.muted,
      fontSize: 13,
      marginTop: 14,
      marginBottom: 6,
    },
    resultError: {
      color: theme.muted,
      fontSize: 12,
      lineHeight: 18,
      marginBottom: 6,
    },
    playbackStatus: {
      marginTop: 10,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: theme.panelSoft,
    },
    playbackStatusText: { color: theme.accent, fontSize: 12 },
    resultList: { marginTop: 2 },
    songRow: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    songMain: {
      flex: 1,
      minWidth: 0,
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    resultCopy: { flex: 1, minWidth: 0 },
    resultTitle: { color: theme.text, fontSize: 15, fontWeight: '400' },
    resultMeta: { color: theme.muted, fontSize: 12, marginTop: 4 },
    entityRow: {
      minHeight: 74,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    entityMain: {
      flex: 1,
      minWidth: 0,
      minHeight: 74,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    entityFavorite: {
      width: 40,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
    },
    entityCover: { width: 58, height: 58 },
    empty: {
      color: theme.muted,
      fontSize: 14,
      textAlign: 'center',
      padding: 30,
      lineHeight: 22,
    },
    pager: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      paddingVertical: 18,
    },
    pageButton: {
      minWidth: 78,
      height: 36,
      borderRadius: 12,
      backgroundColor: theme.panelSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pageButtonText: { color: theme.text, fontSize: 13, fontWeight: '400' },
    pageLabel: { color: theme.muted, fontSize: 13 },
    disabled: { opacity: 0.4 },
  });
