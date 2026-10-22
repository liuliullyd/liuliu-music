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
  Image,
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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { covers } from '../assets/covers';
import {
  HomeNewReleases,
  type HomeReleaseCacheState,
} from '../components/HomeNewReleases';
import { HomePlaylistDetail } from '../components/HomePlaylistDetail';
import { ListPagingFooter, reachedListBottom } from '../components/ListPaging';
import {
  OrderedCoverBatch,
  OrderedCoverScope,
} from '../components/OrderedRemoteCover';
import { PersonalPlaylistDetail } from '../components/PersonalPlaylistDetail';
import { PersonalPlaylistManager } from '../components/PersonalPlaylistManager';
import { platformCaption, platformLabel } from '../components/platformLabels';
import { PlaybackModePicker } from '../components/PlaybackModePicker';
import {
  PlaylistDetailGradientViewport,
  usePlaylistDetailScrollGradient,
} from '../components/PlaylistDetailScrollGradient';
import { PlaylistDownloadPicker } from '../components/PlaylistDownloadPicker';
import {
  PlaylistInformationGradient,
  PlaylistInformationSurface,
  PlaylistInformationTopGradient,
  usePlaylistInformationColor,
} from '../components/PlaylistInformationSurface';
import {
  PlaylistManagementActions,
  playlistManagementLayout,
} from '../components/PlaylistManagementActions';
import { PlaylistShareButton } from '../components/PlaylistShareButton';
import { QueueTrackActions } from '../components/QueueTrackActions';
import {
  ReferenceHomePlaylistRail,
  ReferenceHomeScenes,
  ReferenceHomeSurface,
} from '../components/ReferenceHomeSurface';
import { ResilientHomeCover } from '../components/ResilientHomeCover';
import { StickyBackgroundExtension } from '../components/StickyBackgroundExtension';
import { StickyPressable } from '../components/StickyPressable';
import { TrackActionIcon } from '../components/TrackActionIcon';
import { Glyph, SectionTitle, TrackRow } from '../components/UI';
import { useListPrefetch } from '../components/useListPrefetch';
import {
  PLAYLIST_PLATFORM_WIDTH,
  usePlaylistPlatformSnap,
} from '../components/usePlaylistPlatformSnap';
import { useStableNativeScrollEvent } from '../components/useStableNativeScrollEvent';
import { useVisibleTrackPrewarm } from '../components/useVisibleTrackPrewarm';
import { categories } from '../data/catalog';
import type {
  CatalogItem,
  CatalogKind,
  PlatformSetting,
  Track,
} from '../domain/types';
import { trackQueueKey } from '../domain/types';
import {
  DESIGN_WIDTH,
  HOME_TOP_NAV_HEIGHT,
  homeLayoutMetrics,
  type HomeLayoutMetrics,
} from '../layout';
import {
  catalogSearchInputWidth,
  catalogSearchScrollOffset,
} from '../services/catalogSearchLayout';
import { collectionEntityKind } from '../services/collectionIdentity';
import { loadCollectionTrackBatch } from '../services/collectionPaging';
import type { DownloadPreview } from '../services/downloadPresentation';
import { HOME_RELEASE_BATCH_SIZE } from '../services/homeNewReleases';
import {
  homePersonalPlaylists,
  type PersonalPlaylistDisplayItem,
} from '../services/homePersonalPlaylists';
import {
  createHomeScenePlaceholders,
  isHomeSceneLoadReady,
  loadHomeScenePlaylists,
  type HomeScenePlaylist,
} from '../services/homeScenePlaylists';
import { createHomeTimingTrace } from '../services/homeTiming';
import { sampleLibraryCoverEdgeColor } from '../services/libraryArtwork';
import { libraryCollectionArtwork } from '../services/libraryCollectionArtwork';
import { collectKnownTracks } from '../services/libraryPlaybackActions';
import { savedPlaylistReference } from '../services/linkedPlaylist';
import { loadCategoryFeedPage } from '../services/liveDiscovery';
import {
  loadLiveTracks,
  loadMediaDiscovery,
  mediaDiscoveryConfigs,
  type MediaDiscoveryKind,
  type MediaProvider,
} from '../services/mediaDiscovery';
import {
  copyMediaCursor,
  createMediaCursor,
  type MediaCursor,
} from '../services/mediaDiscoveryPaging';
import {
  getCatalog,
  getPlaylistCatalogPage,
  miguHotChart,
  newSongChart,
  playlistCategoryLabelsForProvider,
  trackCoverCandidates,
  type OnlineProvider,
} from '../services/onlineCatalog';
import { searchOnlinePlaylists } from '../services/onlineMusic';
import { platformDisplayText } from '../services/platformPresentation';
import { catalogSnapshotQueueSource } from '../services/queuePaging';
import { byStartupPassOrder } from '../services/startupPlatformOrder';
import { useApp, type AppPage } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import {
  useCollectionPages,
  type CollectionPageSnapshot,
} from '../state/useCollectionPages';
import { createThemedStyles, light, serif, useTheme } from '../theme';
const HOME_RECOMMENDATION_BATCH_SIZE = 6;
const HOME_HORIZONTAL_BATCH_SIZE = 10;
// Network batches and render windows stay at twenty; scrolling preloads by six.
const HOME_VERTICAL_BATCH_SIZE = 20;
const HOME_VERTICAL_PREFETCH_GROUP_SIZE = 6;
const MEDIA_DIRECT_BATCH_SIZE = 6;
const HOME_VERTICAL_CARD_HEIGHT = 140;
const HOME_VERTICAL_CARD_GAP = 18;
const HOME_VERTICAL_SECTION_GAP = 28;
const HOME_VERTICAL_GROUP_HEIGHT =
  HOME_VERTICAL_BATCH_SIZE * HOME_VERTICAL_CARD_HEIGHT +
  (HOME_VERTICAL_BATCH_SIZE - 1) * HOME_VERTICAL_CARD_GAP;
const HOME_VERTICAL_CARD_STRIDE =
  HOME_VERTICAL_CARD_HEIGHT + HOME_VERTICAL_CARD_GAP;
export const PLAYLIST_CATEGORY_LABELS = [
  '全部',
  '华语',
  '欧美',
  '日语',
  '韩语',
  '粤语',
  '小语种',
  '流行',
  '摇滚',
  '民谣',
  '电子',
  '舞曲',
  '说唱',
  '轻音乐',
  '爵士',
  '古典',
  '乡村',
  '蓝调',
  '另类',
  '世界音乐',
  '原声',
  '影视',
  'ACG',
  '古风',
  '中国风',
  '怀旧',
  '清新',
  '浪漫',
  '伤感',
  '治愈',
  '放松',
  '安静',
  '夜晚',
  '学习',
  '工作',
  '通勤',
  '旅行',
  '运动',
  '亲子',
  '快乐',
  '孤独',
  '感动',
  '兴奋',
  '青春',
  '网络歌曲',
  'KTV',
  '翻唱',
  '现场',
  'DJ',
  '综艺',
  '儿歌',
  '少儿',
  '游戏',
  '80后',
  '90后',
  '00后',
] as const;
export const isKuwoPlaylistSearch = (
  kind: CatalogKind,
  provider: OnlineProvider | null,
  query: string,
) => kind === 'playlists' && provider === 'kuwo' && query.trim().length > 0;
export const isPlaylistSearch = (
  kind: CatalogKind,
  provider: OnlineProvider | null,
  query: string,
) => kind === 'playlists' && provider !== null && query.trim().length > 0;
export const playlistCategoryScrollOffset = (layoutX: number) =>
  Math.max(0, layoutX - 18);
/** Select a fresh Home catalog page for each persisted launch/refresh token. */
export const homePlaylistStartPage = (launchPage: number, refreshToken = 0) =>
  Math.max(
    1,
    Math.floor(Number(launchPage) || 1) +
      Math.max(0, Math.floor(Number(refreshToken) || 0)),
  );
/**
 * One cover request slot per rendered card keeps catalog cover startup in the
 * same top-to-bottom order as the page, without making a whole rail/batch the
 * scheduling unit.
 */
export const catalogCoverModuleKey = (order: number) =>
  `catalog-cover-${String(Math.max(0, Math.floor(Number(order) || 0))).padStart(
    6,
    '0',
  )}`;
export interface HomeVerticalPlaylistRenderWindow {
  startIndex: number;
  endIndex: number;
  beforeHeight: number;
  afterHeight: number;
  totalHeight: number;
}
/**
 * Keep the complete playlist data in memory while mounting only the current
 * group and its immediate neighbours. The spacer heights preserve the exact
 * content extent, including the inter-card gap at each virtualized boundary.
 */
export function getHomeVerticalPlaylistRenderWindow(
  itemCount: number,
  renderGroup: number,
): HomeVerticalPlaylistRenderWindow {
  const count = Math.max(0, itemCount);
  const groupCount = Math.ceil(count / HOME_VERTICAL_BATCH_SIZE);
  const activeGroup = Math.min(
    Math.max(0, Math.floor(renderGroup)),
    Math.max(0, groupCount - 1),
  );
  const firstGroup = Math.max(0, activeGroup - 1);
  const lastGroup = Math.min(groupCount - 1, activeGroup + 1);
  const startIndex = Math.min(count, firstGroup * HOME_VERTICAL_BATCH_SIZE);
  const endIndex = Math.min(
    count,
    Math.max(startIndex, (lastGroup + 1) * HOME_VERTICAL_BATCH_SIZE),
  );
  const beforeHeight =
    startIndex > 0
      ? startIndex * HOME_VERTICAL_CARD_STRIDE - HOME_VERTICAL_CARD_GAP
      : 0;
  const remaining = Math.max(0, count - endIndex);
  const afterHeight =
    remaining > 0
      ? remaining * HOME_VERTICAL_CARD_STRIDE - HOME_VERTICAL_CARD_GAP
      : 0;
  const totalHeight =
    count * HOME_VERTICAL_CARD_HEIGHT +
    Math.max(0, count - 1) * HOME_VERTICAL_CARD_GAP;
  return { startIndex, endIndex, beforeHeight, afterHeight, totalHeight };
}
function interleaveCatalogBatches(batches: CatalogItem[][]) {
  const result: CatalogItem[] = [];
  const seen = new Set<string>();
  const length = Math.max(0, ...batches.map(batch => batch.length));
  for (let index = 0; index < length; index += 1)
    for (const batch of batches) {
      const item = batch[index];
      const key = item && `${item.provider}:${item.id}`;
      if (item && key && !seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
  return result;
}
/**
 * Some provider plaza endpoints ignore their page argument and return the
 * same ordered batch every time. Advance the visible start within that
 * provider response for later Home generations so a repeated response cannot
 * pin one collection to the first card forever. Page one keeps the provider's
 * original order.
 */
export function catalogItemKey(item: CatalogItem) {
  return `${item.provider}:${item.id}`;
}
/** Home music/catalog rails bind to the first startup-healthy platform. */
export function firstPassingHomeProvider(
  platforms: ReadonlyArray<Pick<PlatformSetting, 'id'>>,
  firstDetected?: OnlineProvider | null,
) {
  if (
    firstDetected &&
    platforms.some(platform => platform.id === firstDetected)
  )
    return firstDetected;
  return platforms[0]?.id;
}
/** Keep the selected provider as its full PlatformSetting at service edges. */
export function firstPassingHomePlatforms(
  platforms: ReadonlyArray<PlatformSetting>,
  firstDetected?: OnlineProvider | null,
) {
  const provider = firstPassingHomeProvider(platforms, firstDetected);
  return provider ? platforms.filter(platform => platform.id === provider) : [];
}
export function filterFreshHomePlaylistItems(
  items: CatalogItem[],
  excludedKeys?: ReadonlySet<string>,
) {
  if (!excludedKeys?.size) return items;
  return items.filter(item => !excludedKeys.has(catalogItemKey(item)));
}
/**
 * The public plaza APIs are often cached by page. Shuffle the provider-local
 * batch after removing recently shown collections so a refresh can advance
 * even when the backend returns the same page payload.
 */
export function shuffleHomePlaylistItems(
  items: CatalogItem[],
  excludedKeys?: ReadonlySet<string>,
  random: () => number = Math.random,
) {
  const fresh = filterFreshHomePlaylistItems(items, excludedKeys);
  const source = fresh.length ? fresh : items;
  const shuffled = [...source];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const value = Number(random());
    const normalized = Number.isFinite(value)
      ? Math.min(0.999999, Math.max(0, value))
      : 0;
    const swapIndex = Math.floor(normalized * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}
export function randomHomePlaylistPage(
  basePage: number,
  random: () => number = Math.random,
) {
  const page = Math.max(1, Math.floor(Number(basePage) || 1));
  const value = Number(random());
  const normalized = Number.isFinite(value)
    ? Math.min(0.999999, Math.max(0, value))
    : 0;
  return page + Math.floor(normalized * 5);
}
export function rotateHomePlaylistFirst(
  items: CatalogItem[],
  previousKey?: string,
) {
  const result = [...items];
  if (!previousKey || result.length < 2) return result;
  const replacementIndex = result.findIndex(
    item => catalogItemKey(item) !== previousKey,
  );
  if (replacementIndex > 0)
    [result[0], result[replacementIndex]] = [
      result[replacementIndex],
      result[0],
    ];
  return result;
}
export async function loadHomePlaylistRefreshPage(
  provider: OnlineProvider,
  requestedPage: number,
  retryDelayMs = 250,
  excludedKeys?: ReadonlySet<string>,
) {
  const page = Math.max(1, Math.floor(requestedPage));
  let items: CatalogItem[] = [];
  let catalogError: unknown = null;
  try {
    items = await getCatalog(provider, 'playlists', page);
  } catch (error) {
    catalogError = error;
    console.warn(
      '[home-catalog]',
      JSON.stringify({
        provider,
        page,
        stage: 'featured-playlists',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  if (!items.length) {
    if (retryDelayMs > 0)
      await new Promise<void>(resolve => setTimeout(resolve, retryDelayMs));
    try {
      items = await getCatalog(provider, 'playlists', page);
    } catch (error) {
      catalogError = error;
      console.warn(
        '[home-catalog]',
        JSON.stringify({
          provider,
          page,
          stage: 'featured-playlists-retry',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  if (!items.length && page > 1) {
    try {
      items = await getCatalog(provider, 'playlists', 1);
    } catch (error) {
      catalogError = error;
      console.warn(
        '[home-catalog]',
        JSON.stringify({
          provider,
          page: 1,
          stage: 'featured-playlists-wrap',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    if (items.length)
      return {
        provider,
        page: 1,
        items: filterFreshHomePlaylistItems(items, excludedKeys),
      };
  }
  // Some platform plaza endpoints return an empty/HTML response on Android
  // while their typed playlist-search endpoint remains available. Keep this
  // fallback provider-local and collection-only: it never changes the health
  // gate, source binding, or playback path.
  if (!items.length) {
    try {
      const fallback = await searchOnlinePlaylists(
        '热门歌单',
        page,
        HOME_HORIZONTAL_BATCH_SIZE,
        provider,
      );
      items = filterFreshHomePlaylistItems(
        fallback.items.filter(item => item.provider === provider),
        excludedKeys,
      );
      if (!items.length && page > 1) {
        const firstPage = await searchOnlinePlaylists(
          '热门歌单',
          1,
          HOME_HORIZONTAL_BATCH_SIZE,
          provider,
        );
        items = filterFreshHomePlaylistItems(
          firstPage.items.filter(item => item.provider === provider),
          excludedKeys,
        );
      }
      if (!items.length && fallback.errors.length)
        catalogError = new Error(fallback.errors.join('；'));
      console.info(
        '[home-catalog]',
        JSON.stringify({
          provider,
          page,
          stage: 'playlist-search-fallback',
          items: items.length,
          error: fallback.errors[0] ?? undefined,
        }),
      );
    } catch (error) {
      catalogError = error;
      console.warn(
        '[home-catalog]',
        JSON.stringify({
          provider,
          page,
          stage: 'playlist-search-fallback',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  if (!items.length && catalogError) throw catalogError;
  return {
    provider,
    page,
    items: filterFreshHomePlaylistItems(items, excludedKeys),
  };
}
/**
 * Probe a short window of provider pages for a genuinely new batch. Some
 * providers ignore the requested page, so the caller also receives the page
 * that was actually attempted for cursor advancement.
 */
export async function loadFreshHomePlaylistPage(
  provider: OnlineProvider,
  requestedPage: number,
  excludedKeys?: ReadonlySet<string>,
) {
  const startPage = Math.max(1, Math.floor(Number(requestedPage) || 1));
  let last = await loadHomePlaylistRefreshPage(
    provider,
    startPage,
    0,
    excludedKeys,
  );
  if (last.items.length) return { ...last, page: startPage };
  for (let offset = 1; offset < 5; offset += 1) {
    const candidatePage = startPage + offset;
    last = await loadHomePlaylistRefreshPage(
      provider,
      candidatePage,
      0,
      excludedKeys,
    );
    if (last.items.length) return { ...last, page: candidatePage };
  }
  // A finite catalog may be smaller than the remembered history. Keep the
  // rail usable in that case, but still randomize its order and ensure the
  // first card is rotated by the caller.
  const fallback = await loadHomePlaylistRefreshPage(provider, startPage, 0);
  return { ...fallback, page: startPage };
}
export type MediaSurfaceSnapshot<T> = {
  items: T[];
  cursor: MediaCursor<T>;
  page: number;
  hasMore: boolean;
  refreshKey: number;
};
type PlaylistBrowserContext = {
  personal?: boolean;
  section?: 'scenes' | 'mine';
  personalPlaylistId?: string;
  mediaKind: 'music';
  title: string;
  query?: string;
  /**
   * Reuse the all-playlists visual shell while keeping the originating
   * catalog's entities and detail paging source.
   */
  sourceKind?: Extract<CatalogKind, 'new-albums' | 'charts'>;
  /** Already-loaded Home entities reused by the matching all-page surface. */
  initialItems?: CatalogItem[];
  initialSnapshot?: MediaSurfaceSnapshot<CatalogItem>;
};
export type DetailCatalogListContext = {
  mediaKind: 'music';
  title: string;
  listKind: 'tracks';
  query?: string;
  source?: CatalogItem;
  initialSnapshot?: MediaSurfaceSnapshot<Track>;
};
export function HomeScreen({
  designHeight,
  hidden = false,
  backgroundScrollY,
}: {
  designHeight: number;
  hidden?: boolean;
  backgroundScrollY?: Animated.Value;
}) {
  const app = useApp();
  const theme = useTheme();
  const homeRootActive =
    !hidden && (app.page === 'root' || app.page === 'home-menu');
  const homeRootCommitted = useRef(homeRootActive);
  useLayoutEffect(() => {
    homeRootCommitted.current = homeRootActive;
  }, [homeRootActive]);
  const personalState = app.state,
    personalCurrent = app.current;
  const personalPlaylists = useMemo(
    () => homePersonalPlaylists(personalState, personalCurrent),
    [personalState, personalCurrent],
  );
  const localScrollY = useRef(new Animated.Value(0)).current;
  const homeScrollY = backgroundScrollY ?? localScrollY;
  const [sceneRailTop, setSceneRailTop] = useState<number | null>(null);
  const sceneBackdropOpacity = useMemo(
    () =>
      sceneRailTop === null
        ? 0
        : homeScrollY.interpolate({
            inputRange: [sceneRailTop, sceneRailTop + 1],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          }),
    [homeScrollY, sceneRailTop],
  );
  const layout = homeLayoutMetrics(designHeight);
  const playlistBrowserVisited = useRef(false);
  const playlistBrowserEntry = useRef(0);
  const playlistBrowserActive = !hidden && app.page === 'playlist';
  if (playlistBrowserActive) playlistBrowserVisited.current = true;
  const [verticalEndToken, setVerticalEndToken] = useState(0);
  const [verticalRetryToken, setVerticalRetryToken] = useState(0);
  const verticalGesture = useRef({ active: false, moved: false, lastY: 0 });
  const pullTriggered = React.useRef(false);
  const verticalListTop = useRef<number | null>(null);
  const verticalPrefetchGroup = useRef(2);
  const verticalRenderGroup = useRef(0);
  const [renderGroup, setRenderGroup] = useState(0);
  const observedHomeRefresh = useRef(app.homeRefreshToken);
  useEffect(() => {
    if (observedHomeRefresh.current === app.homeRefreshToken) return;
    observedHomeRefresh.current = app.homeRefreshToken;
    // Media visibility belongs to the current serial generation. Old media
    // must wait with the other lower sections when the root scroller resets.
    verticalRenderGroup.current = 0;
    verticalPrefetchGroup.current = 2;
    verticalGesture.current.active = false;
    setRenderGroup(0);
  }, [app.homeRefreshToken]);
  const [onlinePlaylists, setOnlinePlaylists] = useState<CatalogItem[]>([]),
    [recommendationReadyKey, setRecommendationReadyKey] = useState<
      string | null
    >(null),
    [homeScenePlaylists, setHomeScenePlaylists] = useState<HomeScenePlaylist[]>(
      [],
    ),
    [playlistHasMore, setPlaylistHasMore] = useState(true),
    [homeCharts, setHomeCharts] = useState<CatalogItem[]>([]),
    [homeRankingCharts, setHomeRankingCharts] = useState<CatalogItem[]>([]),
    [selectedState, setSelected] = useState<CatalogItem | null>(null),
    [playlistBrowserState, setPlaylistBrowserState] =
      useState<PlaylistBrowserContext>(
        () =>
          (app.catalogViewState?.get('home-playlist-browser-context') as
            | PlaylistBrowserContext
            | undefined) ?? {
            mediaKind: 'music',
            title: '歌单推荐',
          },
      ),
    [detailCatalogState, setDetailCatalogList] =
      useState<DetailCatalogListContext | null>(null),
    [homeError, setHomeError] = useState('');
  let selected = selectedState;
  let playlistBrowserContext = playlistBrowserState;
  const setPlaylistBrowserContext = (
    next: React.SetStateAction<PlaylistBrowserContext>,
  ) => {
    setPlaylistBrowserState(previous => {
      const value = typeof next === 'function' ? next(previous) : next;
      app.catalogViewState?.set('home-playlist-browser-context', value);
      return value;
    });
  };
  const playlistSection = playlistBrowserContext.section ?? 'scenes';
  const personalPlaylistId = playlistBrowserContext.personalPlaylistId;
  const setPlaylistSection = (section: 'scenes' | 'mine') =>
    setPlaylistBrowserContext(current => ({ ...current, section }));
  let detailCatalogList = detailCatalogState;
  const playlistLoadingRef = useRef(false);
  const playlistNextPages = useRef(new Map<OnlineProvider, number>());
  const playlistRefreshPages = useRef(new Map<OnlineProvider, number>());
  const playlistExhaustedProviders = useRef(new Set<OnlineProvider>());
  const playlistGeneration = useRef(0);
  const sceneGeneration = useRef(0);
  const playlistVisibleKeys = useRef(new Set<string>());
  const playlistHistoryKeys = useRef(new Set<string>());
  const playlistFirstKey = useRef<string | undefined>(undefined);
  const homeRankingFirstKey = useRef<string | undefined>(undefined);
  const playlistSwipeStartX = useRef(0);
  const playlistSwipeTriggered = useRef(false);
  const playlistPendingLoads = useRef(0);
  const playlistLoadDraining = useRef(false);
  const releaseCache = useRef(new Map<string, HomeReleaseCacheState>());
  const selectedHomeProvider = firstPassingHomeProvider(
    app.recommendationPlatforms,
    app.startupHealth?.first,
  );
  const selectedHomePlatform = app.recommendationPlatforms.find(
    platform => platform.id === selectedHomeProvider,
  );
  // Later passing platforms must not restart this first-provider Home generation.
  const homeMusicPlatforms = useMemo(
    () => (selectedHomePlatform ? [selectedHomePlatform] : []),
    [selectedHomePlatform],
  );
  const enabledProviders = useMemo(
    () => homeMusicPlatforms.map(platform => platform.id),
    [homeMusicPlatforms],
  );
  // The ranking catalog keeps its all-healthy set. The lower playlist list
  // follows the same first startup-passing provider as the music rails.
  const allHealthyCatalogProviders = useMemo(
    () => app.recommendationPlatforms.map(platform => platform.id),
    [app.recommendationPlatforms],
  );
  const healthyCatalogProvidersRef = useRef(allHealthyCatalogProviders);
  healthyCatalogProvidersRef.current = allHealthyCatalogProviders;
  const firstPassingProvider = enabledProviders[0];
  const homeRankingProvider =
    firstPassingProvider === app.startupHealth?.first
      ? firstPassingProvider
      : undefined;
  const homeCatalogLaunchPage = homePlaylistStartPage(
    app.homeCatalogLaunchPage ?? 1,
  );
  const startupKey = `${app.homeRefreshToken}:${enabledProviders.join('|')}`;
  const homeScrollPosition = useRef({ key: startupKey, y: 0 });
  const homeOriginRestoreVersion = useRef(0);
  const originRestore = app.catalogRestore;
  if (
    originRestore?.version !== undefined &&
    homeOriginRestoreVersion.current !== originRestore.version
  ) {
    homeOriginRestoreVersion.current = originRestore.version;
    if (originRestore.keys.includes('home-origin-scroll-y')) {
      homeScrollPosition.current.y = Number(
        app.catalogViewState.get('home-origin-scroll-y') ?? 0,
      );
    }
    if (originRestore.keys.includes('home-selected')) {
      selected = app.catalogViewState.get(
        'home-selected',
      ) as CatalogItem | null;
      playlistBrowserContext = app.catalogViewState.get(
        'home-playlist-browser-context',
      ) as PlaylistBrowserContext;
      detailCatalogList = app.catalogViewState.get(
        'home-detail-catalog-list',
      ) as DetailCatalogListContext | null;
      setSelected(selected);
      setPlaylistBrowserContext(playlistBrowserContext);
      setDetailCatalogList(detailCatalogList);
    }
  }
  const lastHomeScrollEventAt = useRef(0);
  if (homeScrollPosition.current.key !== startupKey) {
    homeScrollPosition.current = { key: startupKey, y: 0 };
    lastHomeScrollEventAt.current = 0;
  }
  const [startup, setStartup] = useState({ key: startupKey, stage: 0 });
  const startupStage = startup.key === startupKey ? startup.stage : 0;
  const currentStartupKey = useRef(startupKey);
  currentStartupKey.current = startupKey;
  const finishStartupStage = useCallback(
    (expected: number, key = startupKey) => {
      if (currentStartupKey.current !== key) return;
      setStartup(current =>
        current.key === key && current.stage === expected
          ? { ...current, stage: expected + 1 }
          : current,
      );
    },
    [startupKey],
  );
  const finishNewReleases = useCallback(
    () => finishStartupStage(2),
    [finishStartupStage],
  );
  const finishLive = useCallback(
    () => finishStartupStage(3),
    [finishStartupStage],
  );
  const finishRisingChart = useCallback(
    () => finishStartupStage(5),
    [finishStartupStage],
  );
  const finishHotChart = useCallback(
    () => finishStartupStage(6),
    [finishStartupStage],
  );
  const finishRankingCharts = useCallback(
    () => finishStartupStage(7),
    [finishStartupStage],
  );
  const [homeMediaGenerations, setHomeMediaGenerations] = useState<
    Partial<
      Record<
        never,
        {
          key: string;
          refreshKey: number;
        }
      >
    >
  >({});
  const verticalReady = startupStage >= 8;
  const completeHomeRefresh = app.finishHomeRefresh,
    refreshGeneration = app.homeRefreshToken;
  const finishHomeRefresh = useCallback(
    () => completeHomeRefresh?.(refreshGeneration),
    [completeHomeRefresh, refreshGeneration],
  );
  useEffect(() => {
    // No usable platform is a settled empty generation, so it cannot lock retry.
    if (!enabledProviders.length) finishHomeRefresh();
  }, [enabledProviders.length, finishHomeRefresh]);
  const loadHomeLivePage = useCallback(
    async (page: number, pageSize: number) => {
      const result = await loadLiveTracks(
        page,
        homeMusicPlatforms,
        'all',
        pageSize,
        { recheckKugouEmpty: true },
      );
      if (result.retryable) throw new Error(result.errors.join('；'));
      return { tracks: result.tracks, hasMore: result.hasMore };
    },
    [homeMusicPlatforms],
  );
  const refreshRecommendationPlaylists = useCallback(async () => {
    if (
      !enabledProviders.length ||
      playlistLoadingRef.current ||
      playlistLoadDraining.current
    )
      return;
    const version = ++playlistGeneration.current;
    playlistLoadingRef.current = true;
    const excludedKeys = new Set([
      ...playlistHistoryKeys.current,
      ...playlistVisibleKeys.current,
    ]);
    const requestedPages = new Map(
      enabledProviders.map(provider => [
        provider,
        randomHomePlaylistPage(
          playlistRefreshPages.current.get(provider) ?? homeCatalogLaunchPage,
        ),
      ]),
    );
    const request = () =>
      Promise.allSettled(
        enabledProviders.map(async provider => {
          const page = requestedPages.get(provider) ?? homeCatalogLaunchPage;
          const result = await loadFreshHomePlaylistPage(
            provider,
            page,
            excludedKeys,
          );
          return {
            ...result,
            items: shuffleHomePlaylistItems(result.items, excludedKeys),
            requestedPage: page,
          };
        }),
      );
    try {
      let results = await request();
      if (playlistGeneration.current !== version) return;
      let batches = results.flatMap(result =>
        result.status === 'fulfilled' ? [result.value.items] : [],
      );
      if (!batches.some(batch => batch.length > 0)) {
        await new Promise<void>(resolve => setTimeout(resolve, 250));
        if (playlistGeneration.current !== version) return;
        results = await request();
        if (playlistGeneration.current !== version) return;
        batches = results.flatMap(result =>
          result.status === 'fulfilled' ? [result.value.items] : [],
        );
      }
      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value.items.length)
          continue;
        const nextPage = result.value.page + 1;
        playlistNextPages.current.set(result.value.provider, nextPage);
        playlistRefreshPages.current.set(result.value.provider, nextPage);
      }
      const playlists = rotateHomePlaylistFirst(
        interleaveCatalogBatches(batches),
        playlistFirstKey.current,
      );
      if (playlists.length) {
        const visible = playlists.slice(0, HOME_RECOMMENDATION_BATCH_SIZE);
        setOnlinePlaylists(visible);
        playlistVisibleKeys.current = new Set(visible.map(catalogItemKey));
        playlistFirstKey.current = catalogItemKey(visible[0]!);
        for (const item of visible)
          playlistHistoryKeys.current.add(catalogItemKey(item));
        setPlaylistHasMore(batches.some(batch => batch.length > 0));
        setHomeError('');
      } else {
        setHomeError('推荐歌单刷新失败，请稍后重试');
      }
    } finally {
      if (playlistGeneration.current === version)
        playlistLoadingRef.current = false;
    }
  }, [enabledProviders, homeCatalogLaunchPage]);
  useEffect(() => {
    setRecommendationReadyKey(null);
    // Before the once-per-launch probe finishes the healthy-provider list is
    // intentionally empty. Do not run a fake empty Home generation (including
    // its retry delay); the real generation starts when passing providers land.
    if (!enabledProviders.length) return;
    playlistGeneration.current += 1;
    let active = true;
    const load = async () => {
      const timing = createHomeTimingTrace(startupKey, 'playlists');
      const startedAt = Date.now();
      timing('rail-request-start');
      setStartup({ key: startupKey, stage: 0 });
      setHomeError('');
      setOnlinePlaylists([]);
      const excludedKeys = new Set([
        ...playlistHistoryKeys.current,
        ...playlistVisibleKeys.current,
      ]);
      setHomeCharts([]);
      setHomeRankingCharts([]);
      playlistNextPages.current = new Map();
      playlistExhaustedProviders.current = new Set();
      setPlaylistHasMore(true);
      playlistLoadingRef.current = false;
      playlistSwipeStartX.current = 0;
      playlistSwipeTriggered.current = false;
      playlistPendingLoads.current = 0;
      playlistLoadDraining.current = false;
      const requestedPages = new Map(
        enabledProviders.map(provider => [
          provider,
          randomHomePlaylistPage(
            playlistRefreshPages.current.get(provider) ?? homeCatalogLaunchPage,
          ),
        ]),
      );
      const requestProvider = async (provider: OnlineProvider) => {
        const providerStartedAt = Date.now();
        const page = requestedPages.get(provider) ?? 1;
        timing('provider-start', { provider, page });
        try {
          const result = await loadFreshHomePlaylistPage(
            provider,
            page,
            excludedKeys,
          );
          timing('provider-complete', {
            provider,
            page,
            received: result.items.length,
            ms: Date.now() - providerStartedAt,
          });
          return {
            ...result,
            items: shuffleHomePlaylistItems(result.items, excludedKeys),
          };
        } catch (error) {
          timing('provider-failed', {
            provider,
            page,
            ms: Date.now() - providerStartedAt,
          });
          throw error;
        }
      };
      let playlistResults = await Promise.allSettled(
        enabledProviders.map(requestProvider),
      );
      if (!active) return;
      const batchesFromResults = (results: typeof playlistResults) =>
        results.flatMap(result => {
          if (result.status !== 'fulfilled') return [];
          return [result.value.items];
        });
      let playlistBatches = batchesFromResults(playlistResults);
      // A refresh must replace the rail with fresh data, but transient public
      // catalog failures should not make a healthy 1080 refresh look empty.
      // Retry the requested refresh page once before surfacing the existing
      // explicit error state. A refresh never reports stale page-one data as new.
      if (!playlistBatches.some(batch => batch.length > 0)) {
        await new Promise<void>(resolve => setTimeout(resolve, 250));
        if (!active) return;
        playlistResults = await Promise.allSettled(
          enabledProviders.map(requestProvider),
        );
        if (!active) return;
        playlistBatches = batchesFromResults(playlistResults);
      }
      for (const result of playlistResults) {
        if (result.status !== 'fulfilled' || !result.value.items.length)
          continue;
        const nextPage = result.value.page + 1;
        playlistNextPages.current.set(result.value.provider, nextPage);
        playlistRefreshPages.current.set(result.value.provider, nextPage);
      }
      const playlists = rotateHomePlaylistFirst(
        interleaveCatalogBatches(playlistBatches),
        playlistFirstKey.current,
      );
      if (playlists.length) {
        const visible = playlists.slice(0, HOME_RECOMMENDATION_BATCH_SIZE);
        setOnlinePlaylists(visible);
        playlistVisibleKeys.current = new Set(visible.map(catalogItemKey));
        playlistFirstKey.current = catalogItemKey(visible[0]!);
        for (const item of visible)
          playlistHistoryKeys.current.add(catalogItemKey(item));
      }
      setPlaylistHasMore(playlistBatches.some(batch => batch.length > 0));
      if (!playlists.length) setHomeError('推荐歌单加载失败，请稍后重试');
      setRecommendationReadyKey(startupKey);
      setStartup({ key: startupKey, stage: 1 });
      timing('rail-published', {
        ms: Date.now() - startedAt,
        total: Math.min(playlists.length, HOME_RECOMMENDATION_BATCH_SIZE),
      });
    };
    load().catch(error => {
      if (active) {
        setHomeError(
          error instanceof Error ? error.message : '首页在线内容加载失败',
        );
        setRecommendationReadyKey(startupKey);
        setStartup({ key: startupKey, stage: 1 });
      }
    });
    return () => {
      active = false;
      playlistLoadingRef.current = false;
    };
  }, [enabledProviders, homeCatalogLaunchPage, startupKey]);
  useEffect(() => {
    if (
      !isHomeSceneLoadReady(
        enabledProviders.length,
        recommendationReadyKey,
        startupKey,
      )
    ) {
      setHomeScenePlaylists([]);
      return;
    }
    const version = ++sceneGeneration.current;
    let active = true;
    setHomeScenePlaylists(createHomeScenePlaceholders());
    loadHomeScenePlaylists(homeMusicPlatforms, scene => {
      if (!active || sceneGeneration.current !== version) return;
      setHomeScenePlaylists(current =>
        current.map(value => (value.sceneId === scene.sceneId ? scene : value)),
      );
    })
      .catch(() => {})
      .finally(() => {
        if (active && sceneGeneration.current === version)
          finishStartupStage(1);
      });
    return () => {
      active = false;
    };
  }, [
    app.homeRefreshToken,
    homeMusicPlatforms,
    enabledProviders.length,
    recommendationReadyKey,
    startupKey,
    finishStartupStage,
  ]);
  useEffect(() => {
    if (startupStage !== 4) return;
    let active = true;
    Promise.allSettled(
      healthyCatalogProvidersRef.current.map(provider =>
        getCatalog(provider, 'charts'),
      ),
    ).then(chartResults => {
      if (!active) return;
      const chartBatches = chartResults.flatMap(result =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const charts = interleaveCatalogBatches(chartBatches);
      // Preserve the complete shared catalog for song rails and View All.
      // Randomize only the Home card rail, once per completed generation.
      setHomeCharts(charts);
      const rankingCharts = rotateHomePlaylistFirst(
        shuffleHomePlaylistItems(
          charts.filter(
            chart =>
              chart.provider === homeRankingProvider && chart.kind === 'charts',
          ),
        ),
        homeRankingFirstKey.current,
      );
      if (rankingCharts.length)
        homeRankingFirstKey.current = catalogItemKey(rankingCharts[0]!);
      setHomeRankingCharts(rankingCharts);
      if (!chartBatches.length) setHomeError('首页榜单加载失败，请稍后重试');
      setStartup({ key: startupKey, stage: 5 });
    });
    return () => {
      active = false;
    };
  }, [homeRankingProvider, app.homeRefreshToken, startupKey, startupStage]);
  const loadMorePlaylists = useCallback(async () => {
    if (playlistLoadingRef.current || !playlistHasMore) return;
    const enabled = enabledProviders;
    if (!enabled.length) return;
    const version = playlistGeneration.current;
    playlistLoadingRef.current = true;
    try {
      const providers = enabled.filter(
        provider => !playlistExhaustedProviders.current.has(provider),
      );
      if (!providers.length) {
        setPlaylistHasMore(false);
        return;
      }
      const results = await Promise.allSettled(
        providers.map(async provider => {
          const page = playlistNextPages.current.get(provider) ?? 1;
          const excludedKeys = new Set([
            ...playlistHistoryKeys.current,
            ...playlistVisibleKeys.current,
          ]);
          const result = await loadFreshHomePlaylistPage(
            provider,
            page,
            excludedKeys,
          );
          return {
            provider,
            page: result.page,
            items: shuffleHomePlaylistItems(result.items, excludedKeys),
          };
        }),
      );
      if (playlistGeneration.current !== version) return;
      const batches = results.flatMap(result =>
        result.status === 'fulfilled' ? [result.value.items] : [],
      );
      if (!batches.length) throw new Error('推荐歌单加载失败，请稍后重试');
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        if (result.value.items.length) {
          playlistNextPages.current.set(
            result.value.provider,
            result.value.page + 1,
          );
        } else {
          playlistExhaustedProviders.current.add(result.value.provider);
        }
      }
      const candidates = interleaveCatalogBatches(batches).slice(
        0,
        HOME_RECOMMENDATION_BATCH_SIZE,
      );
      setOnlinePlaylists(current => {
        const seen = new Set(
          current.map(item => `${item.provider}:${item.id}`),
        );
        const next = [
          ...current,
          ...candidates.filter(
            item => !seen.has(`${item.provider}:${item.id}`),
          ),
        ];
        playlistVisibleKeys.current = new Set(next.map(catalogItemKey));
        for (const item of candidates)
          playlistHistoryKeys.current.add(catalogItemKey(item));
        return next;
      });
      setPlaylistHasMore(
        candidates.length > 0 &&
          providers.some(
            provider => !playlistExhaustedProviders.current.has(provider),
          ),
      );
    } catch (error) {
      if (playlistGeneration.current === version) {
        setHomeError(
          error instanceof Error ? error.message : '推荐歌单加载失败',
        );
      }
    } finally {
      if (playlistGeneration.current === version) {
        playlistLoadingRef.current = false;
      }
    }
  }, [enabledProviders, playlistHasMore]);
  const loadMorePlaylistsRef = useRef(loadMorePlaylists);
  loadMorePlaylistsRef.current = loadMorePlaylists;
  const queuePlaylistLoad = useCallback(async () => {
    playlistPendingLoads.current += 1;
    if (playlistLoadDraining.current) return;
    playlistLoadDraining.current = true;
    try {
      while (playlistPendingLoads.current > 0) {
        playlistPendingLoads.current -= 1;
        await loadMorePlaylistsRef.current();
      }
    } finally {
      playlistLoadDraining.current = false;
    }
  }, []);
  const recordPlaylistScroll = useCallback(
    (nativeEvent: {
      contentOffset: {
        x: number;
      };
    }) => {
      if (
        !playlistSwipeTriggered.current &&
        nativeEvent.contentOffset.x > playlistSwipeStartX.current + 1
      ) {
        playlistSwipeTriggered.current = true;
        queuePlaylistLoad().catch(() => undefined);
      }
    },
    [queuePlaylistLoad],
  );
  const handleHomeScroll = useCallback(
    (nativeEvent: NativeScrollEvent) => {
      if (!homeRootCommitted.current) return;
      if (
        verticalGesture.current.active &&
        nativeEvent.contentOffset.y < -40 &&
        !pullTriggered.current
      ) {
        pullTriggered.current = true;
        app.refreshHome();
      }
      const visibleBottom =
        nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height;
      const gesture = verticalGesture.current;
      const movingDown =
        gesture.active && nativeEvent.contentOffset.y > gesture.lastY + 1;
      const firstMovement = movingDown && !gesture.moved;
      if (movingDown) gesture.moved = true;
      gesture.lastY = nativeEvent.contentOffset.y;
      if (verticalReady && verticalListTop.current !== null) {
        const listOffset = Math.max(
          0,
          nativeEvent.contentOffset.y -
            verticalListTop.current -
            HOME_VERTICAL_SECTION_GAP,
        );
        const group = Math.floor(listOffset / HOME_VERTICAL_GROUP_HEIGHT);
        if (group !== verticalRenderGroup.current) {
          verticalRenderGroup.current = group;
          setRenderGroup(group);
        }
      }
      if (
        verticalReady &&
        verticalListTop.current !== null &&
        visibleBottom >= verticalListTop.current &&
        movingDown
      ) {
        const group =
          3 +
          Math.floor(
            Math.max(
              0,
              visibleBottom -
                verticalListTop.current -
                HOME_VERTICAL_SECTION_GAP,
            ) /
              (HOME_VERTICAL_PREFETCH_GROUP_SIZE * HOME_VERTICAL_CARD_STRIDE),
          );
        if (group > verticalPrefetchGroup.current) {
          const enteredGroups = group - verticalPrefetchGroup.current;
          verticalPrefetchGroup.current = group;
          setVerticalEndToken(current => current + enteredGroups);
        }
        if (firstMovement) setVerticalRetryToken(current => current + 1);
      }
    },
    [verticalReady, app],
  );
  const homeScrollEvent = useStableNativeScrollEvent(
    homeScrollY,
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      homeScrollPosition.current.y = Math.max(0, nativeEvent.contentOffset.y);
      app.catalogViewState?.set(
        'home-origin-scroll-y',
        homeScrollPosition.current.y,
      );
      // Decoration follows native frames; preserve the existing 100ms list gate.
      const now = Date.now();
      if (
        now - lastHomeScrollEventAt.current >= 100 ||
        nativeEvent.contentOffset.y < -40
      ) {
        lastHomeScrollEventAt.current = now;
        handleHomeScroll(nativeEvent);
      }
    },
  );
  const finishHomeScroll = ({
    nativeEvent,
  }: NativeSyntheticEvent<NativeScrollEvent>) => {
    homeScrollPosition.current.y = Math.max(0, nativeEvent.contentOffset.y);
    app.catalogViewState?.set(
      'home-origin-scroll-y',
      homeScrollPosition.current.y,
    );
    handleHomeScroll(nativeEvent);
  };
  const openItem = (item: CatalogItem) => {
    app.catalogViewState?.set('home-selected', item);
    setSelected(item);
    app.open('playlist-detail');
  };
  const openCatalogCollectionItem = (
    item: CatalogItem,
    sourceKind: Extract<CatalogKind, 'new-albums' | 'charts'>,
    source: string,
  ) =>
    openItem({
      ...item,
      metadata: {
        ...item.metadata,
        collectionKind: sourceKind,
        detailLayout: 'playlist',
        detailTopGradient: true,
        source,
      },
    });
  const openRecommendationItem = (item: CatalogItem) =>
    openItem({
      ...item,
      metadata: {
        ...item.metadata,
        detailTopGradient: true,
        source: 'home-recommended-playlists',
      },
    });
  const openScenePlaylist = (item: CatalogItem) =>
    openItem({
      ...item,
      metadata: {
        ...item.metadata,
        detailTopGradient: true,
        source: 'home-scene-playlists',
      },
    });
  const openPersonalItem = (item: PersonalPlaylistDisplayItem) => {
    if (item.personalPlaylistId) {
      setPlaylistBrowserContext(current => ({
        ...current,
        personalPlaylistId: item.personalPlaylistId,
      }));
      app.open('personal-playlist');
    } else if (item.collection) openScenePlaylist(item.collection);
  };
  const returnToPersonalManager = () => {
    app.setTab('library');
    app.catalogViewState.set('library-mode', 'music');
    app.catalogViewState.set('library-playlist-opened', null);
    app.open('playlists');
  };
  const openLiveCollection = (tracks: Track[]) => {
    const provider: OnlineProvider =
      (tracks[0]?.provider as OnlineProvider | undefined) ??
      firstPassingHomeProvider(
        app.recommendationPlatforms,
        app.startupHealth?.first,
      ) ??
      'netease';
    openItem({
      id: 'live',
      title: 'Live 现场',
      description: '仅显示包含英文 Live 标记的现场歌曲',
      provider,
      kind: 'charts',
      metadata: {
        collectionKind: 'charts',
        detailLayout: 'playlist',
        detailTopGradient: true,
        source: 'home-live',
      },
    });
  };
  const openVerticalPlaylist = (item: CatalogItem) =>
    openItem({
      ...item,
      metadata: {
        ...item.metadata,
        detailTopGradient: true,
        source: 'home-vertical-playlists',
      },
    });
  const openPlaylistBrowser = (context: PlaylistBrowserContext) => {
    if (!context.sourceKind || context.sourceKind === 'charts')
      playlistBrowserEntry.current += 1;
    setPlaylistBrowserContext(current => ({
      ...context,
      section: current.section,
      personalPlaylistId: current.personalPlaylistId,
    }));
    app.open('playlist');
  };
  const openPlaylistBrowserItem = (item: CatalogItem) => {
    const sourceKind = playlistBrowserContext.sourceKind;
    if (!sourceKind) {
      openRecommendationItem(item);
      return;
    }
    openCatalogCollectionItem(
      item,
      sourceKind,
      sourceKind === 'new-albums'
        ? 'home-new-albums-catalog'
        : 'home-charts-catalog',
    );
  };
  const openDetailCatalogList = (context: DetailCatalogListContext) => {
    app.catalogViewState?.set('home-detail-catalog-list', context);
    setDetailCatalogList(context);
    app.open('catalog-list');
  };
  const renderCurrentContent = () => {
    if (hidden) return null;
    if (app.page === 'personal-playlist') {
      const playlist = app.state.playlists.find(
        item => item.id === personalPlaylistId,
      );
      if (playlist) {
        const tracks = new Map(
          collectKnownTracks(app.state, app.current).map(track => [
            track.id,
            track,
          ]),
        );
        return (
          <PersonalPlaylistDetail
            playlistId={playlist.id}
            title={playlist.title}
            tracks={playlist.trackIds.flatMap(id => tracks.get(id) ?? [])}
            fallbackCoverKey={playlist.coverKey}
            playlistCover={playlist.cover}
            description={playlist.description}
            onBack={app.back}
            onDeleted={returnToPersonalManager}
          />
        );
      }
    }
    if (app.page === 'feed')
      return (
        <CatalogBrowser
          kind="charts"
          title="完整榜单"
          onOpen={item =>
            openCatalogCollectionItem(item, 'charts', 'home-charts-catalog')
          }
          homeLayout={layout}
        />
      );
    if (app.page === 'playlist') return null;
    if (app.page === 'new-songs')
      return <Feed title="新歌首发" forceCategory="新歌" />;
    if (app.page === 'new-albums')
      return (
        <CatalogBrowser
          kind="new-albums"
          title="新碟上架"
          onOpen={item =>
            openCatalogCollectionItem(
              item,
              'new-albums',
              'home-new-albums-catalog',
            )
          }
          homeLayout={layout}
        />
      );
    if (app.page === 'radio' || app.page === 'live')
      return <MediaDiscovery kind={app.page} />;
    if (app.page === 'playlist-detail')
      return <CollectionDetail item={selected} />;
    if (app.page === 'catalog-list' && detailCatalogList)
      return (
        <DetailStyleCatalogList context={detailCatalogList} onOpen={openItem} />
      );
    return null;
  };
  const renderHomeContent = () => {
    return (
      <OrderedCoverScope generationKey={`home:${startupKey}`}>
        <HomeRootScrollView
          testID="discovery-home"
          key={`home-root-${startupKey}`}
          initialScrollY={homeScrollPosition.current.y}
          originRestoreVersion={
            originRestore?.keys.includes('home-origin-scroll-y')
              ? originRestore.version
              : 0
          }
          scrollY={homeScrollY}
          stickyHeaderIndices={
            playlistSection === 'mine' || homeScenePlaylists.length ? [2] : []
          }
          style={[s.root, { backgroundColor: 'transparent' }]}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator
          onScrollBeginDrag={({ nativeEvent }) => {
            if (!homeRootCommitted.current) return;
            pullTriggered.current = false;
            verticalGesture.current = {
              active: true,
              moved: false,
              lastY: nativeEvent.contentOffset.y,
            };
          }}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={app.homeRefreshing ?? false}
              onRefresh={() => {
                // Android can emit both the pull threshold scroll event and
                // RefreshControl.onRefresh for one gesture. Treat them as one
                // refresh so the playlist request cannot be cancelled by a
                // second generation before the four startup sections finish.
                if (!homeRootCommitted.current || pullTriggered.current) return;
                pullTriggered.current = true;
                app.refreshHome();
              }}
            />
          }
          onScroll={homeScrollEvent}
          onScrollEndDrag={event => {
            finishHomeScroll(event);
            verticalGesture.current.active = false;
          }}
          onMomentumScrollBegin={() => {
            verticalGesture.current.active = verticalGesture.current.moved;
          }}
          onMomentumScrollEnd={event => {
            finishHomeScroll(event);
            verticalGesture.current.active = false;
          }}
        >
          <HomeNavigationBar />
          <ReferenceHomeSurface
            playlists={onlinePlaylists}
            scenePlaylists={homeScenePlaylists}
            playlistSection={playlistSection}
            onPlaylistSectionChange={setPlaylistSection}
            onOpenPlaylist={openRecommendationItem}
            onViewAllPlaylists={() =>
              openPlaylistBrowser(
                playlistSection === 'mine'
                  ? { mediaKind: 'music', title: '我的歌单', personal: true }
                  : { mediaKind: 'music', title: '歌单推荐' },
              )
            }
            onRefreshRecommendations={() => {
              refreshRecommendationPlaylists().catch(() => undefined);
            }}
            onPlaylistDragStart={x => {
              playlistSwipeStartX.current = x;
              playlistSwipeTriggered.current = false;
            }}
            onPlaylistScroll={recordPlaylistScroll}
          />
          <View
            testID="home-scenes-sticky"
            onLayout={event => setSceneRailTop(event.nativeEvent.layout.y)}
          >
            <StickyBackgroundExtension
              active={
                !hidden &&
                app.page === 'root' &&
                (playlistSection === 'mine' || homeScenePlaylists.length > 0) &&
                sceneRailTop !== null
              }
              color={theme.bg}
              opacity={sceneBackdropOpacity}
            />
            <Animated.View
              testID="home-scenes-sticky-backdrop"
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: theme.bg, opacity: sceneBackdropOpacity },
              ]}
            />
            {playlistSection === 'mine' ? (
              <ReferenceHomePlaylistRail
                emptyCopy="暂无我的歌单"
                cards={personalPlaylists.map(item => ({
                  key: `${item.provider ?? 'personal'}:${item.id}`,
                  title: item.title,
                  copy: item.description,
                  cover: item.cover,
                  coverCandidates: item.coverCandidates,
                  fallback: item.coverKey ? covers[item.coverKey] : undefined,
                  coverTestID: `home-my-playlist-cover-${
                    item.provider ?? 'personal'
                  }-${item.id}`,
                  moduleKey: `home-my-playlist-${item.provider ?? 'personal'}:${
                    item.id
                  }`,
                  onPress: () => openPersonalItem(item),
                  suppressLongPress: true,
                }))}
              />
            ) : (
              <ReferenceHomeScenes
                scenePlaylists={homeScenePlaylists}
                onOpenScenePlaylist={openScenePlaylist}
              />
            )}
          </View>

          {startupStage >= 2 ? (
            <HomeNewReleases
              key={`home-new-releases-${startupKey}`}
              layout={layout}
              singleProvider={firstPassingProvider}
              allowDuplicateTracks
              onViewAll={tracks =>
                firstPassingProvider
                  ? openDetailCatalogList({
                      mediaKind: 'music',
                      title: '新歌首发',
                      listKind: 'tracks',
                      source: {
                        id: newSongChart(firstPassingProvider),
                        title: '新歌首发',
                        description: '首页新歌首发',
                        cover: tracks[0]?.cover ?? '',
                        coverCandidates: tracks[0]
                          ? trackCoverCandidates(tracks[0])
                          : undefined,
                        provider: firstPassingProvider,
                        kind: 'playlists',
                        metadata: {
                          collectionKind: 'charts',
                          source: 'home-new-releases',
                          detailTopGradient: true,
                        },
                      },
                    })
                  : undefined
              }
              refreshKey={app.homeRefreshToken}
              cache={releaseCache.current}
              coverSectionOrder={1}
              timingKey={startupKey}
              onInitialLoadComplete={finishNewReleases}
            />
          ) : null}

          {startupStage >= 3 ? (
            <HomeNewReleases
              key={`home-live-${startupKey}`}
              layout={layout}
              title="Live 现场"
              testPrefix="home-live"
              singleProvider={firstPassingProvider}
              loadPage={loadHomeLivePage}
              queueSourceForPlay={snapshot => ({
                kind: 'live',
                provider: 'all',
                page: snapshot.page,
                pageSize: HOME_RELEASE_BATCH_SIZE,
                seenKeys: snapshot.tracks.map(trackQueueKey),
                hasMore: snapshot.remoteHasMore ?? snapshot.hasMore,
                platforms: homeMusicPlatforms,
              })}
              onViewAll={openLiveCollection}
              refreshKey={app.homeRefreshToken}
              cache={releaseCache.current}
              coverSectionOrder={2}
              timingKey={startupKey}
              onInitialLoadComplete={finishLive}
            />
          ) : null}

          {homeChartSections.map(section => {
            const charts = homeCharts
              .filter(value =>
                value.provider === 'migu' && section.key === 'hot'
                  ? value.id === miguHotChart.id
                  : section.match.test(value.title),
              )
              .filter(
                (value, index, values) =>
                  values.findIndex(item => item.provider === value.provider) ===
                  index,
              );
            const songCharts = firstPassingProvider
              ? charts.filter(value => value.provider === firstPassingProvider)
              : [];
            const chart = songCharts[0];
            const content = (
              <HomeNewReleases
                key={section.key}
                layout={layout}
                title={section.title}
                testPrefix={`home-chart-${section.key}`}
                coverSectionOrder={section.key === 'rising' ? 3 : 4}
                source={
                  chart ? { provider: chart.provider, id: chart.id } : null
                }
                fallbackSources={[]}
                singleProvider={firstPassingProvider}
                allowDuplicateTracks
                onViewAll={
                  chart
                    ? () =>
                        openDetailCatalogList({
                          mediaKind: 'music',
                          title: section.title,
                          listKind: 'tracks',
                          source: {
                            ...chart,
                            metadata: {
                              ...chart.metadata,
                              collectionKind: 'charts',
                              source: `home-${section.key}-chart`,
                              detailLayout: 'playlist',
                              detailTopGradient: true,
                              platformItems: charts,
                            },
                          },
                        })
                    : undefined
                }
                refreshKey={app.homeRefreshToken}
                cache={releaseCache.current}
                onInitialLoadComplete={
                  section.key === 'rising' ? finishRisingChart : finishHotChart
                }
              />
            );
            if (section.key === 'rising')
              return startupStage >= 5 ? content : null;
            return startupStage >= 6 ? (
              <View key="hot-boundary" testID="home-hot-boundary">
                {content}
              </View>
            ) : null;
          })}

          <SequencedHomeSection
            testID="home-deferred-other-charts"
            loaded={startupStage >= 7}
            height={layout.playlistHeight + 45}
          >
            <OtherChartsRail
              charts={homeRankingCharts}
              ready={startupStage >= 7}
              onInitialLoadComplete={finishRankingCharts}
              layout={layout}
              onOpen={item =>
                openCatalogCollectionItem(item, 'charts', 'home-charts-rail')
              }
              onViewAll={() =>
                openPlaylistBrowser({
                  mediaKind: 'music',
                  title: '排行榜',
                  sourceKind: 'charts',
                  initialItems: homeCharts,
                })
              }
            />
          </SequencedHomeSection>

          <SequencedHomeSection
            testID="home-deferred-playlists"
            loaded={verticalReady}
            onTop={value => {
              verticalListTop.current = value;
            }}
            height={HOME_VERTICAL_SECTION_GAP + HOME_VERTICAL_GROUP_HEIGHT}
          >
            <HomeVerticalPlaylists
              providers={homeRankingProvider ? enabledProviders : []}
              onInitialLoadComplete={finishHomeRefresh}
              refreshKey={app.homeRefreshToken}
              initialPage={homePlaylistStartPage(
                homeCatalogLaunchPage,
                app.homeRefreshToken,
              )}
              endToken={verticalEndToken}
              retryToken={verticalRetryToken}
              onOpen={openVerticalPlaylist}
              renderGroup={renderGroup}
            />
          </SequencedHomeSection>

          {homeError ? <Text style={s.errorText}>{homeError}</Text> : null}
        </HomeRootScrollView>
      </OrderedCoverScope>
    );
  };
  return (
    <>
      <View
        testID="home-kept-content"
        style={homeRootActive ? s.homeContentVisible : s.homeContentHidden}
        pointerEvents={homeRootActive ? 'auto' : 'none'}
        accessibilityElementsHidden={!homeRootActive}
        importantForAccessibility={
          homeRootActive ? 'auto' : 'no-hide-descendants'
        }
      >
        {renderHomeContent()}
      </View>
      {renderCurrentContent()}
      {playlistBrowserVisited.current ? (
        <View
          key="kept-playlist-browser"
          testID="playlist-browser-host"
          style={[
            s.root,
            StyleSheet.absoluteFill,
            { opacity: playlistBrowserActive ? 1 : 0 },
          ]}
          pointerEvents={playlistBrowserActive ? 'auto' : 'none'}
          accessibilityElementsHidden={!playlistBrowserActive}
          importantForAccessibility={
            playlistBrowserActive ? 'auto' : 'no-hide-descendants'
          }
        >
          {playlistBrowserContext.personal ? (
            <PersonalPlaylistManager
              onOpenCollection={openScenePlaylist}
              onOpenPersonalPlaylist={id => {
                setPlaylistBrowserContext(current => ({
                  ...current,
                  personalPlaylistId: id,
                }));
                app.open('personal-playlist');
              }}
            />
          ) : (
            <CatalogBrowser
              kind={playlistBrowserContext.sourceKind ?? 'playlists'}
              playlistLayout={Boolean(playlistBrowserContext.sourceKind)}
              title={playlistBrowserContext.title}
              onOpen={openPlaylistBrowserItem}
              homeLayout={layout}
              initialItems={playlistBrowserContext.initialItems}
              active={playlistBrowserActive}
              entryRevision={playlistBrowserEntry.current}
            />
          )}
        </View>
      ) : null}
    </>
  );
}
function HomeRootScrollView({
  initialScrollY,
  originRestoreVersion,
  scrollY,
  ...props
}: React.ComponentProps<typeof Animated.ScrollView> & {
  initialScrollY: number;
  originRestoreVersion?: number;
  scrollY: Animated.Value;
}) {
  // Freeze the native starting offset for this mount. Later Home renders must
  // not write a sampled scroll position back into a moving ScrollView.
  const initialOffset = useRef({ x: 0, y: initialScrollY }).current;
  const scrollRef = useRef<ScrollView | null>(null);
  const restoreVersion = useRef(originRestoreVersion);
  useLayoutEffect(() => {
    if (restoreVersion.current === originRestoreVersion) return;
    restoreVersion.current = originRestoreVersion;
    if (!originRestoreVersion) return;
    scrollY.setValue(initialScrollY);
    scrollRef.current?.scrollTo({ y: initialScrollY, animated: false });
  }, [initialScrollY, originRestoreVersion, scrollY]);
  useLayoutEffect(() => {
    scrollY.setValue(initialOffset.y);
  }, [scrollY, initialOffset]);
  return (
    <Animated.ScrollView
      {...props}
      ref={scrollRef}
      contentOffset={initialOffset}
      showsHorizontalScrollIndicator
      showsVerticalScrollIndicator
    />
  );
}
function SequencedHomeSection({
  children,
  height,
  loaded,
  onTop,
  testID,
}: {
  children: React.ReactNode;
  height: number;
  loaded: boolean;
  onTop?: (top: number) => void;
  testID: string;
}) {
  return (
    <View
      testID={testID}
      onLayout={event => onTop?.(event.nativeEvent.layout.y)}
      style={loaded ? undefined : { height }}
    >
      {loaded ? children : null}
    </View>
  );
}
function HomeVerticalPlaylists({
  onInitialLoadComplete,
  providers,
  refreshKey,
  initialPage,
  endToken,
  retryToken = 0,
  onOpen,
  renderGroup,
}: {
  onInitialLoadComplete?: () => void;
  providers: OnlineProvider[];
  refreshKey: number;
  initialPage: number;
  endToken: number;
  retryToken?: number;
  onOpen: (item: CatalogItem) => void;
  renderGroup: number;
}) {
  const app = useApp();
  const initialComplete = useRef(onInitialLoadComplete);
  initialComplete.current = onInitialLoadComplete;
  const [items, setItems] = useState<CatalogItem[]>([]);
  const cursors = useRef(
    new Map<
      OnlineProvider,
      {
        page: number;
        buffer: CatalogItem[];
        exhausted: boolean;
        restartAtFirstPage: boolean;
      }
    >(),
  );
  const seen = useRef(new Set<string>());
  const firstPage = useRef(initialPage);
  const hasMore = useRef(true);
  const loadingRef = useRef(false);
  const retryNeeded = useRef(false);
  const generation = useRef(0);
  const lastEndToken = useRef(endToken);
  const lastRetryToken = useRef(retryToken);
  const latestTokens = useRef({ endToken, retryToken });
  latestTokens.current = { endToken, retryToken };
  const pendingPages = useRef(0);
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const providerIdentity = providers.join('|');
  const requestBatch = useCallback(async (version: number) => {
    const availableProviders = providersRef.current;
    if (loadingRef.current || !hasMore.current || !availableProviders.length)
      return false;
    loadingRef.current = true;
    retryNeeded.current = false;
    // Work on copies so a failure or an obsolete response cannot consume a
    // buffered tail, advance a real page, or commit only part of this batch.
    const nextCursors = new Map(
      availableProviders.map(provider => {
        const current = cursors.current.get(provider);
        return [
          provider,
          current
            ? { ...current, buffer: [...current.buffer] }
            : {
                page: firstPage.current,
                buffer: [],
                exhausted: false,
                restartAtFirstPage: firstPage.current > 1,
              },
        ];
      }),
    );
    const batch: CatalogItem[] = [];
    const nextSeen = new Set(seen.current);
    const fetched = new Set<OnlineProvider>();
    try {
      while (batch.length < HOME_VERTICAL_BATCH_SIZE) {
        let consumed = false;
        for (const cursor of nextCursors.values()) {
          const candidate = cursor.buffer.shift();
          if (!candidate) continue;
          consumed = true;
          const key = catalogItemKey(candidate);
          if (!nextSeen.has(key)) {
            nextSeen.add(key);
            batch.push(candidate);
          }
          if (batch.length === HOME_VERTICAL_BATCH_SIZE) break;
        }
        if (consumed) continue;
        const missing = availableProviders.filter(provider => {
          const cursor = nextCursors.get(provider)!;
          return !cursor.exhausted && !fetched.has(provider);
        });
        if (!missing.length) break;
        const results = await Promise.all(
          missing.map(async provider => {
            const cursor = nextCursors.get(provider)!;
            let page = cursor.page;
            let result = await getPlaylistCatalogPage(provider, page, {
              paginateKugouAllPlaylists: true,
            });
            if (generation.current !== version)
              return { provider, result, page };
            // Persisted launch counters can outgrow the provider's finite plaza.
            // Restart only an empty initial cursor; normal terminal pages end it.
            if (
              (!result.items.length || result.outOfRange) &&
              cursor.restartAtFirstPage
            ) {
              page = 1;
              result = await getPlaylistCatalogPage(provider, page, {
                paginateKugouAllPlaylists: true,
              });
            }
            return { provider, result, page };
          }),
        );
        if (generation.current !== version) return false;
        for (const { provider, result, page } of results) {
          const cursor = nextCursors.get(provider)!;
          const values = result.outOfRange ? [] : result.items;
          fetched.add(provider);
          cursor.page = result.nextPage ?? page;
          cursor.restartAtFirstPage = false;
          cursor.buffer = [...values];
          cursor.exhausted =
            result.nextPage === null ||
            !values.some(value => !nextSeen.has(catalogItemKey(value)));
        }
      }
      if (generation.current !== version) return false;
      cursors.current = nextCursors;
      seen.current = nextSeen;
      if (batch.length) setItems(current => [...current, ...batch]);
      hasMore.current = [...nextCursors.values()].some(
        cursor => cursor.buffer.length > 0 || !cursor.exhausted,
      );
      return true;
    } finally {
      if (generation.current === version) {
        loadingRef.current = false;
      }
    }
  }, []);
  const drainPendingPages = useCallback(
    async (version: number) => {
      if (loadingRef.current || !providersRef.current.length) return;
      while (
        pendingPages.current > 0 &&
        hasMore.current &&
        generation.current === version
      ) {
        pendingPages.current -= 1;
        try {
          if (!(await requestBatch(version))) return;
        } catch {
          if (generation.current === version) {
            retryNeeded.current = true;
            pendingPages.current = 0;
          }
          return;
        }
      }
    },
    [requestBatch],
  );
  useEffect(() => {
    const version = ++generation.current;
    firstPage.current = Math.max(1, Math.floor(initialPage));
    cursors.current = new Map();
    seen.current = new Set();
    hasMore.current = true;
    loadingRef.current = false;
    retryNeeded.current = false;
    pendingPages.current = providersRef.current.length ? 1 : 0;
    lastEndToken.current = latestTokens.current.endToken;
    lastRetryToken.current = latestTokens.current.retryToken;
    setItems([]);
    drainPendingPages(version)
      .catch(() => undefined)
      .finally(() => {
        if (generation.current === version) initialComplete.current?.();
      });
    return () => {
      generation.current += 1;
      loadingRef.current = false;
    };
  }, [drainPendingPages, initialPage, providerIdentity, refreshKey]);
  useEffect(() => {
    if (endToken === lastEndToken.current) return;
    pendingPages.current += Math.max(0, endToken - lastEndToken.current);
    lastEndToken.current = endToken;
    drainPendingPages(generation.current).catch(() => undefined);
  }, [drainPendingPages, endToken]);
  useEffect(() => {
    if (retryToken === lastRetryToken.current) return;
    lastRetryToken.current = retryToken;
    if (!retryNeeded.current) return;
    pendingPages.current = 1;
    drainPendingPages(generation.current).catch(() => undefined);
  }, [drainPendingPages, retryToken]);
  const renderWindow = getHomeVerticalPlaylistRenderWindow(
    items.length,
    renderGroup,
  );
  const visibleItems = items.slice(
    renderWindow.startIndex,
    renderWindow.endIndex,
  );
  return (
    <View testID="home-playlists" style={s.verticalPlaylistList}>
      <OrderedCoverBatch
        candidates={items.map(value => [
          value.cover,
          ...(value.coverCandidates ?? []),
        ])}
        moduleKey="home-vertical-playlists"
        sectionOrder={8}
      />
      {renderWindow.beforeHeight > 0 ? (
        <View
          testID="home-playlists-before-spacer"
          style={{ height: renderWindow.beforeHeight }}
        />
      ) : null}
      {visibleItems.map((item, index) => {
        return (
          <VerticalPlaylistCard
            key={`${item.provider}:${item.id}`}
            visualOrder={[8, renderWindow.startIndex + index]}
            item={item}
            favorite={app.isCollectionFavorite(item)}
            onToggleFavorite={() => app.toggleCollectionFavorite(item)}
            onPress={() => onOpen(item)}
            width={DESIGN_WIDTH - 36}
          />
        );
      })}
      {renderWindow.afterHeight > 0 ? (
        <View
          testID="home-playlists-after-spacer"
          style={{ height: renderWindow.afterHeight }}
        />
      ) : null}
    </View>
  );
}
function OtherChartsRail({
  charts,
  ready,
  onInitialLoadComplete,
  layout,
  onOpen,
  onViewAll,
}: {
  charts: CatalogItem[];
  ready: boolean;
  onInitialLoadComplete: () => void;
  layout: HomeLayoutMetrics;
  onOpen: (item: CatalogItem) => void;
  onViewAll: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(HOME_HORIZONTAL_BATCH_SIZE);
  const visibleCountRef = useRef(HOME_HORIZONTAL_BATCH_SIZE);
  const swipeStartX = useRef(0);
  const swipeTriggered = useRef(false);
  useEffect(() => {
    swipeStartX.current = 0;
    swipeTriggered.current = false;
    visibleCountRef.current = HOME_HORIZONTAL_BATCH_SIZE;
    setVisibleCount(HOME_HORIZONTAL_BATCH_SIZE);
  }, [charts]);
  const revealNextGroup = useCallback(() => {
    if (visibleCountRef.current >= charts.length) return;
    visibleCountRef.current = Math.min(
      visibleCountRef.current + HOME_HORIZONTAL_BATCH_SIZE,
      charts.length,
    );
    setVisibleCount(visibleCountRef.current);
  }, [charts.length]);
  const displayedCharts = useMemo(
    () => charts.slice(0, visibleCount),
    [charts, visibleCount],
  );
  const [coversByChart, setCoversByChart] = useState<Record<string, string>>(
    {},
  );
  useEffect(() => {
    if (!ready) return;
    let active = true;
    Promise.all(
      displayedCharts.map(async chart => {
        try {
          const result = await loadCollectionTrackBatch(
            chart.provider,
            'charts',
            chart.id,
            0,
            10,
          );
          return [
            `${chart.provider}:${chart.id}`,
            result.tracks[0]?.cover ?? '',
          ] as const;
        } catch {
          return [`${chart.provider}:${chart.id}`, ''] as const;
        }
      }),
    ).then(entries => {
      if (!active) return;
      setCoversByChart(
        Object.fromEntries(entries.filter(([, cover]) => cover)),
      );
      onInitialLoadComplete();
    });
    return () => {
      active = false;
    };
  }, [displayedCharts, ready, onInitialLoadComplete]);
  return (
    <>
      {displayedCharts.length ? (
        <View style={[s.homeSectionTitle, s.otherChartsTitle]}>
          <SectionTitle
            title="排行榜"
            action="查看全部"
            hideActionLabel
            onPress={onViewAll}
            actionTestID="home-other-charts-all"
            darkMode
          />
        </View>
      ) : null}
      <ScrollView
        testID="home-other-charts"
        horizontal
        onScrollBeginDrag={({ nativeEvent }) => {
          swipeStartX.current = nativeEvent.contentOffset.x;
          swipeTriggered.current = false;
        }}
        onScroll={({ nativeEvent }) => {
          if (
            !swipeTriggered.current &&
            nativeEvent.contentOffset.x > swipeStartX.current + 1
          ) {
            swipeTriggered.current = true;
            revealNextGroup();
          }
        }}
        scrollEventThrottle={100}
        style={[s.playlistScroller, { height: layout.playlistHeight }]}
        contentContainerStyle={[s.playlistRail, s.homeChartsRail]}
        showsHorizontalScrollIndicator
        showsVerticalScrollIndicator
      >
        {displayedCharts.map((chart, index) => (
          <PlaylistCard
            key={`${chart.provider}:${chart.id}`}
            item={chart}
            coverOverride={coversByChart[`${chart.provider}:${chart.id}`]}
            visualOrder={[5, index]}
            onPress={() => onOpen(chart)}
            width={layout.playlistCardWidth}
            imageHeight={layout.playlistImageHeight}
            footerHeight={layout.playlistFooterHeight}
          />
        ))}
      </ScrollView>
    </>
  );
}
const homeChartSections = [
  { key: 'rising', title: '飙升榜', match: /飙升/ },
  { key: 'hot', title: '热歌榜', match: /热歌|TOP500/ },
];
function HomeNavigationBar() {
  const app = useApp();
  const layout = useLayout();
  return (
    <View style={[s.homeNavRoot, { height: layout.homeTopNavigationHeight }]}>
      <View
        style={[
          s.homeNavBar,
          {
            height: layout.homeTopNavigationHeight,
            paddingHorizontal: layout.homeTopNavigationPadding,
          },
        ]}
      >
        <Pressable
          testID="home-menu-button"
          accessibilityRole="button"
          accessibilityLabel="打开主菜单"
          onPress={() => app.open('home-menu')}
          style={[
            s.homeMenuButton,
            {
              width: layout.homeTopNavigationButtonSize,
              height: layout.homeTopNavigationButtonSize,
            },
          ]}
        >
          <View
            style={[
              s.menuLine,
              {
                width: Math.round(layout.homeTopNavigationButtonSize * 0.47),
              },
            ]}
          />
          <View
            style={[
              s.menuLine,
              {
                width: Math.round(layout.homeTopNavigationButtonSize * 0.47),
              },
            ]}
          />
          <View
            style={[
              s.menuLine,
              {
                width: Math.round(layout.homeTopNavigationButtonSize * 0.47),
              },
            ]}
          />
        </Pressable>
        <Pressable
          testID="home-top-search"
          accessibilityRole="button"
          accessibilityLabel="搜索"
          onPress={() => app.setTab('search')}
          style={[
            s.roundAction,
            s.homeSearchAction,
            {
              width: layout.homeTopNavigationButtonSize,
              height: layout.homeTopNavigationButtonSize,
              borderRadius: layout.homeTopNavigationButtonSize / 2,
            },
          ]}
        >
          <Text
            style={[
              s.homeSearchGlyph,
              { fontSize: Math.round(layout.homeTopNavigationFontSize * 1.6) },
            ]}
          >
            ⌕
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
function PlaylistCard({
  item,
  onPress,
  width,
  imageHeight,
  footerHeight,
  coverOverride,
  visualOrder,
}: {
  item: CatalogItem;
  onPress: () => void;
  width: number;
  imageHeight: number;
  footerHeight: number;
  coverOverride?: string;
  visualOrder?: readonly [number, number];
}) {
  return (
    <Pressable
      testID="home-playlist-card"
      accessibilityRole="button"
      onPress={onPress}
      style={[s.playlistCard, { width }]}
    >
      <ResilientHomeCover
        clipToImageStyle
        visualOrder={visualOrder}
        uri={coverOverride || item.cover}
        uris={coverOverride ? undefined : item.coverCandidates}
        fallback={covers.train}
        resizeMethod="resize"
        testID="home-playlist-cover"
        style={[s.playlistImage, { height: imageHeight }]}
        imageStyle={s.playlistRadius}
      />
      <View style={[s.playlistFooter, { height: footerHeight }]}>
        <View style={s.playlistCopy}>
          <Text numberOfLines={1} style={s.playlistTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={s.playlistSub}>
            {platformCaption(item.description, item.provider)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
type MediaOriginReturn<T> = {
  version: number;
  state?: MediaSurfaceSnapshot<T> & {
    identity: string;
  };
  onChange?: (
    snapshot: MediaSurfaceSnapshot<T> & {
      identity: string;
    },
  ) => void;
  requested?: boolean;
};
function useMediaItems<T>(
  loader: (
    page: number,
    cursor: MediaCursor<T>,
  ) => Promise<{
    items: T[];
    hasMore: boolean;
    errors?: string[];
  }>,
  enabled: boolean,
  identity: string,
  refreshKey: number,
  keyOf: (item: T) => string,
  initialSnapshot?: MediaSurfaceSnapshot<T>,
  fetchInitially = true,
  requestActive = true,
  originReturn?: MediaOriginReturn<T>,
) {
  const [items, setItems] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const generation = useRef(0);
  const cursor = useRef(createMediaCursor<T>());
  const cursorIdentity = useRef(identity);
  const requestPage = useRef(0);
  const pending = useRef(0);
  const active = useRef<Promise<void> | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const publishedItems = useRef<T[]>([]);
  const more = useRef(true);
  const loaderRef = useRef(loader);
  const keyRef = useRef(keyOf);
  const seedRef = useRef(initialSnapshot);
  const activeRef = useRef(requestActive);
  activeRef.current = requestActive;
  const wasActive = useRef(requestActive);
  seedRef.current = initialSnapshot;
  loaderRef.current = loader;
  keyRef.current = keyOf;
  const returnState = useRef(originReturn);
  returnState.current = originReturn;
  const restoredVersion = useRef(-1);
  const currentIdentity =
    !(originReturn?.state || originReturn?.requested) ||
    cursorIdentity.current === identity;
  let visibleItems = currentIdentity ? items : [];
  let visibleLoading = currentIdentity ? loading : true;
  let visibleHasMore = currentIdentity ? hasMore : true;
  let visibleError = currentIdentity ? error : '';
  let visibleSettled =
    currentIdentity && settledKey === `${identity}:${refreshKey}`;
  const restored = originReturn?.state;
  if (
    restored?.identity === identity &&
    restored.refreshKey === refreshKey &&
    restoredVersion.current !== originReturn!.version
  ) {
    restoredVersion.current = originReturn!.version;
    requestController.current?.abort();
    generation.current += 1;
    pending.current = 0;
    active.current = null;
    cursorIdentity.current = identity;
    cursor.current = copyMediaCursor(restored.cursor);
    requestPage.current = restored.page;
    publishedItems.current = [...restored.items];
    more.current = restored.hasMore;
    visibleItems = publishedItems.current;
    visibleHasMore = restored.hasMore;
    visibleError = '';
    visibleLoading = false;
    visibleSettled = true;
    setItems(visibleItems);
    setHasMore(visibleHasMore);
    setError('');
    setLoading(false);
    setSettledKey(`${identity}:${refreshKey}`);
  }
  const loadMore = useCallback((): Promise<void> => {
    if (!enabled || !more.current || !activeRef.current)
      return Promise.resolve();
    pending.current += 1;
    if (active.current) return active.current;
    const version = generation.current;
    setLoading(true);
    const run = async () => {
      try {
        while (
          pending.current > 0 &&
          more.current &&
          version === generation.current
        ) {
          pending.current -= 1;
          const next = copyMediaCursor(cursor.current);
          const controller = new AbortController();
          requestController.current = controller;
          next.signal = controller.signal;
          const baseItems = [...publishedItems.current];
          const publishItems = (values: T[]) => {
            const seen = new Set(baseItems.map(keyRef.current));
            const combined = [
              ...baseItems,
              ...values.filter(item => {
                const key = keyRef.current(item);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              }),
            ];
            publishedItems.current = combined;
            setItems(combined);
          };
          next.onProgress = (values, preview) => {
            if (version !== generation.current || controller.signal.aborted)
              return;
            cursor.current = preview;
            publishItems(values);
          };
          setError('');
          try {
            const result = await loaderRef.current(
              requestPage.current + 1,
              next,
            );
            if (version !== generation.current || controller.signal.aborted)
              return;
            cursor.current = next;
            requestPage.current += 1;
            console.info(
              '[media-surface]',
              JSON.stringify({
                identity,
                generation: refreshKey,
                request: requestPage.current,
                received: result.items.length,
                hasMore: result.hasMore,
              }),
            );
            publishItems(result.items);
            more.current = result.hasMore;
            setHasMore(result.hasMore);
            if (result.errors?.length) setError(result.errors.join('；'));
          } catch (reason) {
            if (version !== generation.current || controller.signal.aborted)
              return;
            setError(reason instanceof Error ? reason.message : String(reason));
            pending.current = 0;
          }
          setSettledKey(`${identity}:${refreshKey}`);
        }
      } finally {
        if (version === generation.current) {
          active.current = null;
          requestController.current = null;
          setLoading(false);
        }
      }
    };
    const promise = run();
    active.current = promise;
    return promise;
  }, [enabled, identity, refreshKey]);
  const loadRef = useRef(loadMore);
  loadRef.current = loadMore;
  useEffect(() => {
    requestController.current?.abort();
    generation.current += 1;
    active.current = null;
    pending.current = 0;
    if (
      returnState.current?.state?.identity === identity &&
      returnState.current.state.refreshKey === refreshKey &&
      restoredVersion.current === returnState.current.version
    ) {
      return () => {
        generation.current += 1;
        requestController.current?.abort();
      };
    }
    if (cursorIdentity.current !== identity) cursorIdentity.current = identity;
    // A refresh owns a new catalog generation. Reset this surface's cursor
    // while leaving horizontal and vertical preload trigger semantics intact.
    const seed =
      seedRef.current?.refreshKey === refreshKey ? seedRef.current : undefined;
    cursor.current = seed
      ? copyMediaCursor(seed.cursor)
      : createMediaCursor<T>();
    requestPage.current = seed?.page ?? 0;
    setItems(seed?.items ?? []);
    publishedItems.current = seed?.items ?? [];
    setError('');
    setLoading(false);
    setSettledKey(seed ? `${identity}:${refreshKey}` : null);
    more.current = seed?.hasMore ?? true;
    setHasMore(more.current);
    if (enabled && fetchInitially) void loadRef.current();
    return () => {
      generation.current += 1;
      requestController.current?.abort();
    };
  }, [enabled, identity, refreshKey, fetchInitially]);
  useEffect(() => {
    const resumed = requestActive && !wasActive.current;
    wasActive.current = requestActive;
    if (!requestActive) {
      pending.current = 0;
      requestController.current?.abort();
    } else if (
      resumed &&
      enabled &&
      fetchInitially &&
      settledKey !== `${identity}:${refreshKey}`
    ) {
      // Let the aborted generation release its active promise before resuming.
      const previous = active.current ?? Promise.resolve();
      void previous.then(() => {
        if (activeRef.current) void loadRef.current();
      });
    }
  }, [
    requestActive,
    enabled,
    fetchInitially,
    settledKey,
    identity,
    refreshKey,
  ]);
  const snapshot = (): MediaSurfaceSnapshot<T> & {
    identity: string;
  } => ({
    identity,
    items: [...publishedItems.current],
    cursor: copyMediaCursor(cursor.current),
    page: requestPage.current,
    hasMore: more.current,
    refreshKey,
  });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  useEffect(() => {
    if (cursorIdentity.current === identity)
      returnState.current?.onChange?.(snapshotRef.current());
  }, [error, hasMore, identity, items, loading, refreshKey]);
  return {
    items: visibleItems,
    loading: visibleLoading,
    hasMore: visibleHasMore,
    error: visibleError,
    settled: visibleSettled,
    loadMore,
    snapshot,
  };
}
function VerticalPlaylistCard({
  item,
  favorite,
  onToggleFavorite,
  onPress,
  width,
  visualOrder,
}: {
  item: CatalogItem;
  favorite: boolean;
  onToggleFavorite: () => void;
  onPress: () => void;
  width: number;
  visualOrder?: readonly [number, number];
}) {
  const c = useTheme();
  return (
    <Pressable
      testID="home-vertical-playlist-card"
      accessibilityRole="button"
      accessibilityLabel={`打开合集 ${item.title}`}
      onPress={onPress}
      style={[s.verticalPlaylistCard, { width }]}
    >
      <View
        testID="home-vertical-playlist-cover-slot"
        style={s.verticalPlaylistCoverButton}
      >
        <ResilientHomeCover
          clipToImageStyle
          uri={item.cover}
          uris={item.coverCandidates}
          fallback={covers.train}
          resizeMethod="resize"
          visualOrder={visualOrder}
          testID="home-vertical-playlist-cover"
          style={s.verticalPlaylistImage}
          imageStyle={s.verticalPlaylistImageRadius}
        />
      </View>
      <View style={s.verticalPlaylistCopy}>
        <Text
          testID="home-vertical-playlist-title"
          numberOfLines={2}
          style={s.verticalPlaylistTitle}
        >
          {item.title}
        </Text>
        <Text
          testID="home-vertical-playlist-description"
          numberOfLines={1}
          style={s.verticalPlaylistSub}
        >
          {platformCaption(item.description, item.provider)}
        </Text>
        <Pressable
          testID="home-vertical-playlist-favorite"
          accessibilityRole="button"
          accessibilityLabel={favorite ? '取消收藏合集' : '收藏合集'}
          accessibilityState={{ selected: favorite }}
          onPress={event => {
            event?.stopPropagation();
            onToggleFavorite();
          }}
          style={[
            s.verticalPlaylistFavorite,
            favorite && s.verticalPlaylistFavoriteSelected,
          ]}
        >
          <TrackActionIcon
            kind="favorite"
            active={favorite}
            size={20}
            color={favorite ? c.accent : c.text}
          />
          <Text
            style={[
              s.verticalPlaylistFavoriteText,
              favorite
                ? s.verticalPlaylistFavoriteTextActive
                : s.verticalPlaylistFavoriteTextInactive,
            ]}
          >
            {favorite ? '已收藏' : '收藏'}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}
function CategoryTabs() {
  const app = useApp();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      contentContainerStyle={s.feedTabs}
      showsVerticalScrollIndicator
    >
      {categories.map(item => (
        <Pressable
          key={item}
          onPress={() => app.setCategory(item)}
          style={[s.feedTab, app.category === item && s.feedTabActive]}
        >
          <Text
            style={[
              s.feedTabText,
              app.category === item && s.feedTabTextActive,
            ]}
          >
            {item}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
function Feed({
  title,
  forceCategory,
}: {
  title?: string;
  forceCategory?: Track['language'] | '新歌';
} = {}) {
  const app = useApp();
  const layout = useLayout();
  useEffect(() => {
    if (forceCategory === '新歌' && app.category !== '新歌')
      app.setCategory('新歌');
  }, [app, forceCategory]);
  return (
    <View testID="discovery-feed" style={s.root}>
      <View
        style={[
          s.detailTopBar,
          {
            minHeight: layout.headerHeight,
            paddingHorizontal: layout.pageHorizontalPadding,
          },
        ]}
      >
        <Pressable
          accessibilityLabel="返回"
          onPress={app.back}
          style={[
            s.backButton,
            { width: layout.headerButtonSize, height: layout.headerButtonSize },
          ]}
        >
          <Glyph color={light.text} size={31}>
            ‹
          </Glyph>
        </Pressable>
        <View style={s.subHeaderCopy}>
          <Text style={s.subTitle}>{title ?? `${app.category}推荐`}</Text>
          <Text style={s.subCopy}>每页最多 20 首</Text>
        </View>
        {forceCategory === '新歌' ? (
          <Pressable
            testID="open-new-albums"
            accessibilityRole="button"
            accessibilityLabel="查看新碟上架"
            onPress={() => app.open('new-albums')}
            style={s.subHeaderAction}
          >
            <Text style={s.subHeaderActionText}>新碟上架 ›</Text>
          </Pressable>
        ) : null}
      </View>
      <CategoryTabs />
      <ScrollView
        contentContainerStyle={[
          s.list,
          { paddingBottom: layout.scrollBottomPadding },
        ]}
        showsHorizontalScrollIndicator
        showsVerticalScrollIndicator
      >
        {app.feed.map((track, index) => (
          <TrackRow
            key={track.id}
            track={track}
            index={(app.feedPage - 1) * 20 + index + 1}
            darkMode
            active={app.current?.id === track.id}
            favorite={app.isFavorite(track)}
            onFavorite={() => app.toggleFavorite(track)}
            onPlay={() =>
              app
                .playTrack(track, app.feed, index, {
                  queueOrigin: app.captureQueueOrigin?.(
                    title ?? `${app.category}推荐`,
                  ),
                })
                .catch(() => undefined)
            }
          />
        ))}
      </ScrollView>
      <View style={s.pager}>
        <Pressable
          disabled={app.feedPage === 1}
          onPress={() => app.setFeedPage(Math.max(1, app.feedPage - 1))}
          style={s.pageButton}
        >
          <Glyph color={app.feedPage === 1 ? light.muted : light.text}>‹</Glyph>
        </Pressable>
        <Text style={s.pageText}>第 {app.feedPage} 页 · 每页最多 20 首</Text>
        <Pressable
          disabled={app.feed.length < 20}
          onPress={() => app.setFeedPage(app.feedPage + 1)}
          style={s.pageButton}
        >
          <Glyph color={app.feed.length < 20 ? light.muted : light.text}>
            ›
          </Glyph>
        </Pressable>
      </View>
    </View>
  );
}
function MediaDiscovery({ kind }: { kind: MediaDiscoveryKind }) {
  const app = useApp();
  const layout = useLayout();
  const config = mediaDiscoveryConfigs[kind];
  // Media pages share the launch-fixed healthy-platform binding with Home;
  // querying persisted-but-failed providers here caused misleading failures
  const available = app.recommendationPlatforms;
  const [provider, setProvider] = useState<MediaProvider>('all');
  const [page, setPage] = useState(1);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const topMedia = kind === 'video' || kind === 'live';
  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrors([]);
    loadMediaDiscovery(kind, page, app.recommendationPlatforms, provider)
      .then(result => {
        if (!active) return;
        setTracks(result.tracks);
        setErrors(result.errors);
      })
      .catch(reason => {
        if (!active) return;
        setTracks([]);
        setErrors([
          reason instanceof Error ? reason.message : `${config.title}加载失败`,
        ]);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [app.recommendationPlatforms, config.title, kind, page, provider]);
  return (
    <View testID={`media-${kind}`} style={s.root}>
      {topMedia ? (
        <HomeNavigationBar />
      ) : (
        <View
          style={[
            s.subHeader,
            {
              minHeight: layout.headerHeight,
              paddingHorizontal: layout.pageHorizontalPadding,
            },
          ]}
        >
          <Pressable
            accessibilityLabel="返回"
            onPress={app.back}
            style={[
              s.backButton,
              {
                width: layout.headerButtonSize,
                height: layout.headerButtonSize,
              },
            ]}
          >
            <Glyph color={light.text} size={31}>
              ‹
            </Glyph>
          </Pressable>
          <View style={s.subHeaderCopy}>
            <Text style={s.subTitle}>{config.title}</Text>
            <Text style={s.subCopy}>{config.description}</Text>
          </View>
        </View>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        style={s.catalogProviderScroller}
        contentContainerStyle={s.catalogProviders}
        showsVerticalScrollIndicator
      >
        <Pressable
          testID="media-provider-all"
          accessibilityRole="button"
          accessibilityState={{ selected: provider === 'all' }}
          onPress={() => {
            setProvider('all');
            setPage(1);
          }}
          style={[
            s.catalogProvider,
            provider === 'all' && s.catalogProviderActive,
          ]}
        >
          <Text
            style={[
              s.catalogProviderText,
              provider === 'all' && s.catalogProviderTextActive,
            ]}
          >
            全部
          </Text>
        </Pressable>
        {available.map(value => (
          <Pressable
            key={value.id}
            testID={`media-provider-${value.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: provider === value.id }}
            onPress={() => {
              setProvider(value.id);
              setPage(1);
            }}
            style={[
              s.catalogProvider,
              provider === value.id && s.catalogProviderActive,
            ]}
          >
            <Text
              style={[
                s.catalogProviderText,
                provider === value.id && s.catalogProviderTextActive,
              ]}
            >
              {platformLabel(value.id)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView
        contentContainerStyle={[
          s.mediaList,
          { paddingBottom: layout.scrollBottomPadding },
        ]}
        showsHorizontalScrollIndicator
        showsVerticalScrollIndicator
      >
        {loading ? (
          <Text style={s.catalogState}>正在读取五平台真实内容…</Text>
        ) : null}
        {!loading && !tracks.length ? (
          <Text style={s.catalogState}>
            {errors[0] ?? `暂时没有可用${config.title}内容`}
          </Text>
        ) : null}
        {tracks.map((track, index) => (
          <TrackRow
            key={`${track.provider}:${track.providerId ?? track.id}`}
            track={track}
            index={(page - 1) * 20 + index + 1}
            darkMode
            active={app.current?.id === track.id}
            favorite={app.isFavorite(track)}
            onFavorite={() => app.toggleFavorite(track)}
            onPlay={() =>
              app
                .playTrack(track, tracks, index, {
                  queueOrigin: app.captureQueueOrigin?.(config.title),
                })
                .catch(() => undefined)
            }
          />
        ))}
        {tracks.length && errors.length ? (
          <Text style={s.mediaWarning}>{errors.join('；')}</Text>
        ) : null}
      </ScrollView>
      <View style={s.pager}>
        <Pressable
          disabled={page === 1}
          onPress={() => setPage(value => Math.max(1, value - 1))}
          style={s.pageButton}
        >
          <Glyph color={page === 1 ? light.muted : light.text}>‹</Glyph>
        </Pressable>
        <Text style={s.pageText}>
          第 {page} 页 ·{' '}
          {provider === 'all' ? '全部平台' : platformLabel(provider)}
        </Text>
        <Pressable
          disabled={tracks.length < 20}
          onPress={() => setPage(value => value + 1)}
          style={s.pageButton}
        >
          <Glyph color={tracks.length < 20 ? light.muted : light.text}>›</Glyph>
        </Pressable>
      </View>
    </View>
  );
}
function CatalogBrowser({
  kind,
  title,
  onOpen,
  homeLayout,
  playlistLayout = false,
  initialItems,
  active = true,
  entryRevision = 0,
}: {
  kind: CatalogKind;
  title: string;
  onOpen: (item: CatalogItem) => void;
  homeLayout: HomeLayoutMetrics;
  playlistLayout?: boolean;
  initialItems?: CatalogItem[];
  active?: boolean;
  entryRevision?: number;
}) {
  const app = useApp();
  const layout = useLayout();
  const c = useTheme();
  const playlistVisual = playlistLayout || kind === 'playlists';
  const preserveChartProviderOptions = kind === 'charts' && playlistLayout;
  // The current charts endpoint returns its complete ordered catalog in one
  // response; unlike playlists and albums it has no page cursor to advance.
  const sourceHasPages = kind !== 'charts';
  const pageActive = useRef(active);
  pageActive.current = active;
  const firstPlatformCatalog =
    kind === 'playlists' || (kind === 'charts' && playlistLayout);
  const available = useMemo(
    () =>
      firstPlatformCatalog
        ? byStartupPassOrder(app.recommendationPlatforms, app.startupHealth)
        : [...app.recommendationPlatforms].sort(
            (a, b) => Number(b.id === 'migu') - Number(a.id === 'migu'),
          ),
    [app.recommendationPlatforms, app.startupHealth, firstPlatformCatalog],
  );
  const catalogPlatformsRef = useRef(available);
  catalogPlatformsRef.current = available;
  const [provider, setProvider] = useState<OnlineProvider | null>(
      available[0]?.id ?? null,
    ),
    [items, setItems] = useState<CatalogItem[]>([]),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [unavailableProviders, setUnavailableProviders] = useState<
      OnlineProvider[]
    >([]),
    [category, setCategory] = useState('全部'),
    [editorItems, setEditorItems] = useState<CatalogItem[]>([]),
    [editorPage, setEditorPage] = useState(1),
    [editorLoading, setEditorLoading] = useState(false),
    [moreItems, setMoreItems] = useState<CatalogItem[]>([]),
    [morePage, setMorePage] = useState(1),
    [moreHasMore, setMoreHasMore] = useState(true),
    [playlistSearchOpen, setPlaylistSearchOpen] = useState(false),
    [playlistSearchText, setPlaylistSearchText] = useState(''),
    [playlistSearchQuery, setPlaylistSearchQuery] = useState(''),
    [playlistSearchViewport, setPlaylistSearchViewport] = useState(0),
    [playlistSearchConfirmWidth, setPlaylistSearchConfirmWidth] = useState(48),
    [playlistSearchCancelWidth, setPlaylistSearchCancelWidth] = useState(56);
  const availableForPage = useMemo(
    () => available.filter(value => !unavailableProviders.includes(value.id)),
    [available, unavailableProviders],
  );
  const displayAvailable = availableForPage;
  const searchingPlaylists = isPlaylistSearch(
    kind,
    provider,
    playlistSearchQuery,
  );
  const editorLoadGuard = useRef(false);
  const moreLoadGuard = useRef(false);
  const morePendingLoads = useRef(0);
  const moreLoadDraining = useRef(false);
  const categoryScrollRef = useRef<ScrollView | null>(null);
  const categoryOffsets = useRef<Record<string, number>>({});
  const playlistSearchTextRef = useRef('');
  const playlistProviderScrollRef = useRef<ScrollView | null>(null);
  const playlistProviderScrollX = useRef(0);
  const playlistProviderViewport = useRef(0);
  const playlistProviderContent = useRef(0);
  const playlistSearchAnchor = useRef({ x: 0, width: 0 });
  const playlistSearchRestoreX = useRef<number | null>(null);
  const playlistSearchOpenRef = useRef(playlistSearchOpen);
  playlistSearchOpenRef.current = playlistSearchOpen;
  const revealPlaylistSearch = useCallback(() => {
    if (
      !playlistSearchOpenRef.current ||
      !playlistProviderViewport.current ||
      !playlistProviderContent.current
    )
      return;
    const { x, width } = playlistSearchAnchor.current;
    if (!width) return;
    const offset = catalogSearchScrollOffset(
      playlistProviderViewport.current,
      playlistProviderContent.current,
      playlistProviderScrollX.current,
      x,
      width,
    );
    if (Math.abs(offset - playlistProviderScrollX.current) < 0.5) return;
    playlistProviderScrollRef.current?.scrollTo({ x: offset, animated: false });
    playlistProviderScrollX.current = offset;
  }, []);
  const restorePlaylistProviderScroll = useCallback(() => {
    const x = playlistSearchRestoreX.current;
    if (x === null) return;
    playlistProviderScrollRef.current?.scrollTo({ x, animated: false });
    playlistProviderScrollX.current = x;
    playlistSearchRestoreX.current = null;
  }, []);
  const handledPlaylistEntry = useRef(entryRevision);
  useLayoutEffect(() => {
    if (handledPlaylistEntry.current === entryRevision) return;
    handledPlaylistEntry.current = entryRevision;
    if (!firstPlatformCatalog) return;
    setProvider(availableForPage[0]?.id ?? null);
    setPage(1);
    setPlaylistSearchOpen(false);
    setPlaylistSearchText('');
    setPlaylistSearchQuery('');
    playlistSearchTextRef.current = '';
  }, [availableForPage, entryRevision, firstPlatformCatalog]);
  const markProviderUnavailable = useCallback(
    (failedProvider: OnlineProvider, reason?: unknown) => {
      setUnavailableProviders(current =>
        current.includes(failedProvider)
          ? current
          : [...current, failedProvider],
      );
      setError(
        `${platformLabel(failedProvider)}暂时无法获取内容，已顺延到下一个平台${
          reason instanceof Error && reason.message
            ? `（${reason.message}）`
            : ''
        }`,
      );
    },
    [],
  );
  const loadCatalogPage = useCallback(
    async (
      targetProvider: OnlineProvider,
      targetPage: number,
      targetCategory: string,
    ) => {
      if (isPlaylistSearch(kind, targetProvider, playlistSearchQuery)) {
        const result = await searchOnlinePlaylists(
          playlistSearchQuery.trim(),
          targetPage,
          30,
          targetProvider,
          catalogPlatformsRef.current,
          'music',
        );
        if (!result.items.length && result.errors.length)
          throw new Error(result.errors[0]);
        return result.items.filter(value => value.provider === targetProvider);
      }
      return getCatalog(targetProvider, kind, targetPage, targetCategory);
    },
    [kind, playlistSearchQuery],
  );
  useEffect(() => {
    setUnavailableProviders([]);
    setPlaylistSearchOpen(false);
    setPlaylistSearchText('');
    setPlaylistSearchQuery('');
    playlistSearchTextRef.current = '';
    categoryOffsets.current = {};
  }, [app.pageRefreshToken, kind, title]);
  useEffect(() => {
    if (provider && availableForPage.some(value => value.id === provider))
      return;
    setProvider(availableForPage[0]?.id ?? null);
    setPage(1);
  }, [availableForPage, provider]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    if (playlistVisual) {
      setItems([]);
      setEditorItems([]);
      setMoreItems([]);
      setEditorPage(1);
      setMorePage(1);
      setMoreHasMore(true);
      editorLoadGuard.current = false;
      moreLoadGuard.current = false;
      morePendingLoads.current = 0;
      moreLoadDraining.current = false;
    }
    if (!provider) {
      setItems([]);
      if (playlistVisual) {
        setEditorItems([]);
        setMoreItems([]);
      }
      setLoading(false);
      return () => {
        active = false;
      };
    }
    if (kind === 'charts' && initialItems?.length) {
      const values = initialItems.filter(value => value.provider === provider);
      if (!values.length) {
        // Home's initial chart batch is intentionally bound to its first
        // passing provider. The chart all-page must request the selected
        // provider instead of treating that missing Home batch as a failure.
        if (!preserveChartProviderOptions) {
          markProviderUnavailable(provider);
          setItems([]);
          setLoading(false);
          return () => {
            active = false;
          };
        }
      } else {
        if (playlistVisual) {
          setItems(values);
          setEditorItems(values.slice(6, 16));
          setMoreItems(values.slice(16));
          setMoreHasMore(false);
        } else {
          setItems(values);
        }
        setLoading(false);
        return () => {
          active = false;
        };
      }
    }
    loadCatalogPage(provider, page, category)
      .then(value => {
        if (!active) return;
        if (page === 1 && !value.length && !searchingPlaylists) {
          markProviderUnavailable(provider);
          setItems([]);
          if (playlistVisual) {
            setEditorItems([]);
            setMoreItems([]);
          }
          return;
        }
        if (page === 1 && !value.length && searchingPlaylists) {
          setItems([]);
          if (playlistVisual) {
            setEditorItems([]);
            setMoreItems([]);
          }
          setError(
            `没有找到匹配的${provider ? platformLabel(provider) : ''}歌单`,
          );
          return;
        }
        if (playlistVisual) {
          setItems(value);
          setEditorItems(value.slice(6, 16));
          setMoreItems(value.slice(16));
          setMoreHasMore(sourceHasPages && value.length > 0);
        } else {
          setItems(value);
        }
      })
      .catch(reason => {
        if (active) {
          if (page === 1 && !searchingPlaylists)
            markProviderUnavailable(provider, reason);
          setItems([]);
          if (playlistVisual) {
            setEditorItems([]);
            setMoreItems([]);
          }
          setError(reason instanceof Error ? reason.message : '目录加载失败');
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [
    category,
    initialItems,
    kind,
    loadCatalogPage,
    markProviderUnavailable,
    page,
    playlistVisual,
    playlistSearchQuery,
    preserveChartProviderOptions,
    provider,
    searchingPlaylists,
    sourceHasPages,
  ]);
  const loadEditorPage = useCallback(() => {
    if (
      !pageActive.current ||
      !playlistVisual ||
      !sourceHasPages ||
      !provider ||
      loading ||
      editorLoading ||
      editorLoadGuard.current
    )
      return;
    editorLoadGuard.current = true;
    setEditorLoading(true);
    const nextPage = editorPage + 1;
    loadCatalogPage(provider, nextPage, category)
      .then(value => {
        setEditorItems(current => [
          ...current,
          ...value
            .filter(
              next =>
                !current.some(
                  existing =>
                    existing.id === next.id &&
                    existing.provider === next.provider,
                ),
            )
            .slice(0, 10),
        ]);
        setEditorPage(nextPage);
      })
      .catch(() => undefined)
      .finally(() => {
        editorLoadGuard.current = false;
        setEditorLoading(false);
      });
  }, [
    category,
    editorLoading,
    editorPage,
    loading,
    loadCatalogPage,
    playlistVisual,
    provider,
    sourceHasPages,
  ]);
  const loadMorePageNow = useCallback(() => {
    if (
      !pageActive.current ||
      !playlistVisual ||
      !sourceHasPages ||
      !provider ||
      loading ||
      moreLoadGuard.current ||
      !moreHasMore
    )
      return;
    moreLoadGuard.current = true;
    const nextPage = morePage + 1;
    loadCatalogPage(provider, nextPage, category)
      .then(value => {
        const additions = value.filter(
          next =>
            !moreItems.some(
              existing =>
                existing.id === next.id && existing.provider === next.provider,
            ),
        );
        setMoreItems(current => [...current, ...additions]);
        setMorePage(nextPage);
        setMoreHasMore(sourceHasPages && value.length > 0);
      })
      .catch(() => undefined)
      .finally(() => {
        moreLoadGuard.current = false;
      });
  }, [
    category,
    loadCatalogPage,
    loading,
    moreHasMore,
    moreItems,
    morePage,
    playlistVisual,
    provider,
    sourceHasPages,
  ]);
  const loadMorePageRef = useRef(loadMorePageNow);
  loadMorePageRef.current = loadMorePageNow;
  const loadMorePage = useCallback(() => {
    if (!pageActive.current) return;
    morePendingLoads.current += 1;
    if (moreLoadDraining.current) return;
    moreLoadDraining.current = true;
    void (async () => {
      try {
        while (morePendingLoads.current > 0 && pageActive.current) {
          morePendingLoads.current -= 1;
          await loadMorePageRef.current();
        }
      } finally {
        moreLoadDraining.current = false;
      }
    })();
  }, []);
  const playlistSearchWidth = useRef(new Animated.Value(0)).current;
  const playlistSearchTargetWidth =
    playlistSearchViewport > 0
      ? catalogSearchInputWidth(
          playlistSearchViewport,
          playlistSearchConfirmWidth + playlistSearchCancelWidth,
        )
      : 210;
  useEffect(() => {
    Animated.timing(playlistSearchWidth, {
      toValue: playlistSearchOpen ? playlistSearchTargetWidth : 0,
      duration: 220,
      useNativeDriver: false,
    }).start(result => {
      if (result?.finished === false) return;
      if (playlistSearchOpen) revealPlaylistSearch();
      else restorePlaylistProviderScroll();
    });
  }, [
    playlistSearchOpen,
    playlistSearchTargetWidth,
    playlistSearchWidth,
    revealPlaylistSearch,
    restorePlaylistProviderScroll,
  ]);
  const submitPlaylistSearch = useCallback(() => {
    const query = playlistSearchTextRef.current.trim();
    setPage(1);
    setPlaylistSearchQuery(query);
  }, []);
  const selectPlaylistCategory = useCallback((label: string) => {
    setCategory(label);
    setPage(1);
    setPlaylistSearchOpen(false);
    setPlaylistSearchText('');
    setPlaylistSearchQuery('');
    playlistSearchTextRef.current = '';
    const offset = playlistCategoryScrollOffset(
      categoryOffsets.current[label] ?? 0,
    );
    categoryScrollRef.current?.scrollTo({
      x: offset,
      animated: true,
    });
  }, []);
  if (!playlistVisual) {
    return (
      <OrderedCoverScope
        active
        generationKey={`catalog:${kind}:${
          provider ?? 'none'
        }:${category}:${page}`}
      >
        <View
          testID={`catalog-${kind}`}
          style={[s.root, { backgroundColor: c.bg }]}
        >
          <View
            style={[
              s.subHeader,
              {
                minHeight: layout.headerHeight,
                paddingHorizontal: layout.pageHorizontalPadding,
              },
            ]}
          >
            <Pressable
              accessibilityLabel="返回"
              onPress={app.back}
              style={[
                s.backButton,
                {
                  width: layout.headerButtonSize,
                  height: layout.headerButtonSize,
                },
              ]}
            >
              <Glyph color={c.text} size={31}>
                ‹
              </Glyph>
            </Pressable>
            <View>
              <Text style={[s.subTitle, { color: c.text }]}>{title}</Text>
              <Text style={[s.subCopy, { color: c.muted }]}>
                通过检测的平台公开目录 · 实时加载
              </Text>
            </View>
          </View>
          <ScrollView
            style={s.catalogProviderScroller}
            horizontal
            showsHorizontalScrollIndicator
            contentContainerStyle={s.catalogProviders}
            showsVerticalScrollIndicator
          >
            {displayAvailable.map(value => (
              <Pressable
                key={value.id}
                accessibilityRole="button"
                accessibilityState={{ selected: provider === value.id }}
                onPress={() => {
                  setProvider(value.id);
                  setPage(1);
                }}
                style={[
                  s.catalogProvider,
                  provider === value.id && s.catalogProviderActive,
                ]}
              >
                <Text
                  style={[
                    s.catalogProviderText,
                    provider === value.id && s.catalogProviderTextActive,
                  ]}
                >
                  {platformLabel(value.id)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {loading ? (
            <Text style={s.catalogState}>正在读取真实在线目录…</Text>
          ) : null}
          {error ? <Text style={s.errorText}>{error}</Text> : null}
          <ScrollView
            testID="catalog-collection-rail"
            horizontal
            showsHorizontalScrollIndicator
            style={[s.playlistScroller, { height: homeLayout.playlistHeight }]}
            contentContainerStyle={s.playlistRail}
            showsVerticalScrollIndicator
          >
            {items.map(value => (
              <PlaylistCard
                key={value.id}
                item={value}
                onPress={() => onOpen(value)}
                width={homeLayout.playlistCardWidth}
                imageHeight={homeLayout.playlistImageHeight}
                footerHeight={homeLayout.playlistFooterHeight}
              />
            ))}
          </ScrollView>
          <View style={s.pager}>
            <Pressable
              disabled={page === 1}
              onPress={() => setPage(value => Math.max(1, value - 1))}
              style={s.pageButton}
            >
              <Glyph color={page === 1 ? c.muted : c.text}>‹</Glyph>
            </Pressable>
            <Text style={[s.pageText, { color: c.muted }]}>第 {page} 页</Text>
            <Pressable
              disabled={!items.length}
              onPress={() => setPage(value => value + 1)}
              style={s.pageButton}
            >
              <Glyph color={!items.length ? c.muted : c.text}>›</Glyph>
            </Pressable>
          </View>
        </View>
      </OrderedCoverScope>
    );
  }
  const categoryLabels = provider
    ? playlistCategoryLabelsForProvider(provider)
    : PLAYLIST_CATEGORY_LABELS;
  const showCategoryFilter = kind === 'playlists';
  const showPlaylistSearch = showCategoryFilter && provider !== null;
  const playlistSearchCluster =
    showPlaylistSearch && provider ? (
      <Animated.View
        testID="catalog-playlist-search-anchor"
        onLayout={({ nativeEvent }) => {
          playlistSearchAnchor.current = {
            x: nativeEvent.layout.x,
            width: nativeEvent.layout.width,
          };
          revealPlaylistSearch();
        }}
        style={s.catalogSearchCluster}
      >
        <Animated.View
          style={[s.catalogSearchInputWrap, { width: playlistSearchWidth }]}
        >
          <TextInput
            testID={`catalog-${provider}-search-input`}
            accessibilityLabel={`搜索${platformLabel(provider)}歌单`}
            value={playlistSearchText}
            onChangeText={value => {
              playlistSearchTextRef.current = value;
              setPlaylistSearchText(value);
            }}
            onSubmitEditing={submitPlaylistSearch}
            placeholder={`搜索${platformLabel(provider)}歌单`}
            placeholderTextColor={c.muted}
            returnKeyType="search"
            style={[s.catalogSearchInput, { color: c.text }]}
          />
        </Animated.View>
        {playlistSearchOpen ? (
          <StickyPressable
            testID={`catalog-${provider}-search-confirm`}
            accessibilityRole="button"
            accessibilityLabel={`确认搜索${platformLabel(provider)}歌单`}
            onLayout={({ nativeEvent }) =>
              setPlaylistSearchConfirmWidth(nativeEvent.layout.width)
            }
            onPress={submitPlaylistSearch}
            style={s.catalogSearchConfirm}
          >
            <Text style={[s.catalogSearchConfirmText, { color: c.bg }]}>
              确认
            </Text>
          </StickyPressable>
        ) : null}
        <StickyPressable
          testID={`catalog-${provider}-search-button`}
          accessibilityRole="button"
          onLayout={({ nativeEvent }) =>
            setPlaylistSearchCancelWidth(nativeEvent.layout.width)
          }
          accessibilityLabel={
            playlistSearchOpen
              ? `关闭${platformLabel(provider)}歌单搜索`
              : `搜索${platformLabel(provider)}歌单`
          }
          onPress={() => {
            if (playlistSearchOpen) {
              setPlaylistSearchOpen(false);
              setPlaylistSearchText('');
              setPlaylistSearchQuery('');
              playlistSearchTextRef.current = '';
              setPage(1);
            } else {
              playlistSearchRestoreX.current = playlistProviderScrollX.current;
              setPlaylistSearchOpen(true);
              playlistSearchTextRef.current = playlistSearchQuery;
              setPlaylistSearchText(playlistSearchQuery);
            }
          }}
          style={[
            s.catalogCategory,
            playlistSearchOpen && s.catalogCategoryActive,
            playlistSearchOpen
              ? { backgroundColor: c.text, borderColor: c.text }
              : { backgroundColor: c.panelSoft, borderColor: c.line },
          ]}
        >
          <Glyph color={playlistSearchOpen ? c.bg : c.text}>
            {playlistSearchOpen ? '×' : '⌕'}
          </Glyph>
        </StickyPressable>
      </Animated.View>
    ) : null;
  return (
    <PlaylistCatalogSurface
      kind={kind}
      title={title}
      active={active}
      generationKey={`catalog:${kind}:${
        provider ?? 'none'
      }:${category}:${page}`}
      homeLayout={homeLayout}
      items={items}
      editorItems={editorItems}
      moreItems={moreItems}
      loading={loading}
      error={error}
      hasMore={moreHasMore}
      onOpen={onOpen}
      onMore={loadMorePage}
      onEditorMore={loadEditorPage}
      eyebrow={`COLLECTIONS · ${provider ? platformLabel(provider) : 'ONLINE'}`}
      filters={
        <>
          {showCategoryFilter ? (
            <ScrollView
              testID="catalog-playlist-categories"
              ref={categoryScrollRef}
              style={s.catalogCategoryScroller}
              horizontal
              showsHorizontalScrollIndicator
              contentContainerStyle={s.catalogCategoryRow}
              showsVerticalScrollIndicator
            >
              {categoryLabels.map(label => (
                <StickyPressable
                  key={`category-${label}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: category === label }}
                  onLayout={({ nativeEvent }) => {
                    categoryOffsets.current[label] = nativeEvent.layout.x;
                  }}
                  onPress={() => {
                    if (category === label) {
                      selectPlaylistCategory(label);
                      return;
                    }
                    selectPlaylistCategory(label);
                  }}
                  style={[
                    s.catalogCategory,
                    category === label && s.catalogCategoryActive,
                    category === label
                      ? { backgroundColor: c.text, borderColor: c.text }
                      : { backgroundColor: c.panelSoft, borderColor: c.line },
                  ]}
                >
                  <Text
                    style={[
                      s.catalogCategoryText,
                      { color: category === label ? c.bg : c.text },
                    ]}
                  >
                    {label}
                  </Text>
                </StickyPressable>
              ))}
            </ScrollView>
          ) : null}
          <ScrollView
            ref={playlistProviderScrollRef}
            testID="catalog-playlist-platforms"
            onLayout={({ nativeEvent }) => {
              playlistProviderViewport.current = nativeEvent.layout.width;
              setPlaylistSearchViewport(nativeEvent.layout.width);
              revealPlaylistSearch();
            }}
            onContentSizeChange={width => {
              playlistProviderContent.current = width;
              revealPlaylistSearch();
            }}
            onScroll={({ nativeEvent }) => {
              playlistProviderScrollX.current = nativeEvent.contentOffset.x;
            }}
            scrollEventThrottle={16}
            style={s.catalogCategoryScroller}
            horizontal
            showsHorizontalScrollIndicator
            contentContainerStyle={s.catalogCategoryRow}
            showsVerticalScrollIndicator
          >
            {displayAvailable.map(value => (
              <React.Fragment key={value.id}>
                <StickyPressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: provider === value.id }}
                  onPress={() => {
                    setProvider(value.id);
                    setPage(1);
                    setPlaylistSearchOpen(false);
                    setPlaylistSearchText('');
                    setPlaylistSearchQuery('');
                    playlistSearchTextRef.current = '';
                  }}
                  style={[
                    s.catalogCategory,
                    provider === value.id && s.catalogCategoryActive,
                    provider === value.id
                      ? { backgroundColor: c.text, borderColor: c.text }
                      : { backgroundColor: c.panelSoft, borderColor: c.line },
                  ]}
                >
                  <Text
                    style={[
                      s.catalogCategoryText,
                      { color: provider === value.id ? c.bg : c.text },
                    ]}
                  >
                    {platformLabel(value.id)}
                  </Text>
                </StickyPressable>
              </React.Fragment>
            ))}
            {playlistSearchCluster}
          </ScrollView>
        </>
      }
    />
  );
}
export function PlaylistCatalogSurface({
  kind,
  title,
  active,
  generationKey,
  homeLayout,
  items,
  editorItems,
  moreItems,
  filters,
  onOpen,
  onMore,
  onEditorMore,
  hasMore,
  loading,
  error,
  eyebrow = 'COLLECTIONS',
  moreTitle = '更多歌单',
  firstItemLabel = '打开第一个歌单',
  loadingCopy = '正在读取真实在线目录…',
  onRetry,
}: {
  kind: string;
  title: string;
  active: boolean;
  generationKey: string;
  homeLayout: HomeLayoutMetrics;
  items: CatalogItem[];
  editorItems: CatalogItem[];
  moreItems: CatalogItem[];
  filters: React.ReactNode;
  onOpen: (item: CatalogItem) => void;
  onMore: () => void;
  onEditorMore: () => void;
  hasMore: boolean;
  loading: boolean;
  error: string;
  eyebrow?: string;
  moreTitle?: string;
  firstItemLabel?: string;
  loadingCopy?: string | null;
  onRetry?: () => void;
}) {
  const app = useApp(),
    c = useTheme(),
    layout = useLayout();
  const [playlistFiltersStuck, setPlaylistFiltersStuck] = useState(false);
  const playlistFiltersOffset = useRef<number | null>(null);
  const featuredItems = items.slice(1, 6);
  const editorCardWidth = Math.round(
    Math.max(132, Math.min(188, homeLayout.playlistCardWidth * 0.72)),
  );
  const featuredCardWidth = Math.round(
    Math.max(280, Math.min(440, homeLayout.playlistCardWidth * 1.35)),
  );
  const featuredImageHeight = Math.round(featuredCardWidth * 0.58);
  return (
    <OrderedCoverScope active={active} generationKey={generationKey}>
      <OrderedCoverBatch
        candidates={[...items.slice(0, 6), ...editorItems, ...moreItems].map(
          value => [value.cover, ...(value.coverCandidates ?? [])],
        )}
        moduleKey="all-playlists"
        sectionOrder={0}
      />
      <View style={[s.root, { backgroundColor: c.bg }]}>
        <StickyBackgroundExtension
          active={active && playlistFiltersStuck}
          color={c.bg}
        />
        <View
          testID="catalog-playlist-top-gradient-viewport"
          pointerEvents="none"
          style={[
            s.playlistDetailTopGradientViewport,
            playlistFiltersStuck ? s.hiddenDetailTopGradientViewport : null,
          ]}
        >
          <PlaylistInformationTopGradient />
        </View>
        <ScrollView
          testID={`catalog-${kind}`}
          stickyHeaderIndices={[1]}
          style={s.root}
          contentContainerStyle={s.catalogPageContent}
          onScroll={({ nativeEvent }) => {
            if (!active) return;
            if (playlistFiltersOffset.current !== null) {
              const nextStuck =
                nativeEvent.contentOffset.y >= playlistFiltersOffset.current;
              setPlaylistFiltersStuck(current =>
                current === nextStuck ? current : nextStuck,
              );
            }
            if (reachedListBottom(nativeEvent) && !loading && hasMore) {
              onMore();
            }
          }}
          scrollEventThrottle={100}
          showsHorizontalScrollIndicator
          showsVerticalScrollIndicator
        >
          <View testID="catalog-hero" style={s.catalogHero}>
            <ResilientHomeCover
              clipToImageStyle
              uri={items[0]?.cover}
              uris={items[0]?.coverCandidates}
              fallback={covers.train}
              resizeMethod="resize"
              visualOrder={[0, 0]}
              testID="catalog-hero-cover"
              moduleKey={catalogCoverModuleKey(0)}
              remotePending={!items[0]}
              style={StyleSheet.absoluteFill}
              imageStyle={s.catalogHeroImage}
            />
            <View style={s.catalogHeroShade} />
            <Svg
              testID="catalog-hero-edge-gradient"
              pointerEvents="none"
              width="100%"
              height="100%"
              style={StyleSheet.absoluteFill}
            >
              <Defs>
                <LinearGradient
                  id="catalogHeroTopEdge"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <Stop offset="0" stopColor={c.bg} stopOpacity="1" />
                  <Stop offset="1" stopColor={c.bg} stopOpacity="0" />
                </LinearGradient>
                <LinearGradient
                  id="catalogHeroBottomEdge"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <Stop offset="0" stopColor={c.bg} stopOpacity="0" />
                  <Stop offset="0.7" stopColor={c.bg} stopOpacity="0.18" />
                  <Stop offset="1" stopColor={c.bg} stopOpacity="1" />
                </LinearGradient>
              </Defs>
              <Rect
                x="0"
                y="0"
                width="100%"
                height="28"
                fill="url(#catalogHeroTopEdge)"
              />
              <Rect
                x="0"
                y="148"
                width="100%"
                height="104"
                fill="url(#catalogHeroBottomEdge)"
              />
            </Svg>
            <View
              style={[s.catalogHeroTop, { minHeight: layout.headerHeight }]}
            >
              <Pressable
                accessibilityLabel="返回"
                onPress={app.back}
                style={s.catalogHeroButton}
              >
                <Glyph color="#fff" size={31}>
                  ‹
                </Glyph>
              </Pressable>
            </View>
            <View style={s.catalogHeroCopy}>
              <Text style={s.catalogHeroEyebrow}>{eyebrow}</Text>
              <View style={s.catalogHeroTitleRow}>
                <Text style={s.catalogHeroTitle}>{title}</Text>
                <Pressable
                  accessibilityLabel={firstItemLabel}
                  disabled={!items[0]}
                  onPress={() => items[0] && onOpen(items[0])}
                  style={s.catalogHeroPlay}
                >
                  <Glyph color="#fff" size={18}>
                    ▶
                  </Glyph>
                </Pressable>
              </View>
            </View>
          </View>
          <View
            testID="catalog-playlist-filters"
            onLayout={({ nativeEvent }) => {
              playlistFiltersOffset.current = nativeEvent.layout.y;
            }}
            style={[s.catalogStickyFilters, { backgroundColor: c.bg }]}
          >
            {playlistFiltersStuck ? <PlaylistInformationTopGradient /> : null}
            {filters}
          </View>
          {loading && loadingCopy ? (
            <Text style={s.catalogState}>{loadingCopy}</Text>
          ) : null}
          {error ? (
            onRetry ? (
              <Pressable testID="catalog-media-retry" onPress={onRetry}>
                <Text style={s.errorText}>{error}，点击重试</Text>
              </Pressable>
            ) : (
              <Text style={s.errorText}>{error}</Text>
            )
          ) : null}
          {featuredItems.length ? (
            <ScrollView
              testID={`catalog-${kind}-featured`}
              horizontal
              nestedScrollEnabled
              directionalLockEnabled
              pagingEnabled
              showsHorizontalScrollIndicator
              contentContainerStyle={s.catalogFeaturedRail}
              scrollEventThrottle={100}
              showsVerticalScrollIndicator
            >
              {featuredItems.map((value, index) => (
                <Pressable
                  key={`${value.provider}:${value.id}`}
                  onPress={() => onOpen(value)}
                  testID="catalog-featured-card"
                  style={[
                    s.catalogFeatured,
                    {
                      width: featuredCardWidth,
                      backgroundColor: c.panelSoft,
                      borderColor: c.line,
                    },
                  ]}
                >
                  <View
                    testID="catalog-featured-image"
                    style={[
                      s.catalogFeaturedImage,
                      { height: featuredImageHeight },
                    ]}
                  >
                    <ResilientHomeCover
                      clipToImageStyle
                      uri={value.cover}
                      uris={value.coverCandidates}
                      fallback={covers.train}
                      resizeMethod="resize"
                      visualOrder={[0, index + 1]}
                      testID="catalog-featured-cover"
                      moduleKey={catalogCoverModuleKey(index + 1)}
                      style={StyleSheet.absoluteFill}
                      imageStyle={s.catalogFeaturedImageRadius}
                    />
                    <View style={s.catalogFeaturedImageShade} />
                    <View style={s.catalogFeaturedOverlay}>
                      <Text
                        style={[s.catalogFeaturedTitle, { color: '#fff' }]}
                        numberOfLines={1}
                      >
                        {value.title}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          {editorItems.length ? (
            <View testID="catalog-editor-section">
              <Text style={[s.catalogSectionTitle, { color: c.text }]}>
                编辑精选
              </Text>
              <ScrollView
                testID="catalog-collection-rail"
                horizontal
                nestedScrollEnabled
                directionalLockEnabled
                showsHorizontalScrollIndicator
                onScroll={({ nativeEvent }) => {
                  if (!active) return;
                  if (
                    nativeEvent.contentOffset.x +
                      nativeEvent.layoutMeasurement.width >=
                      nativeEvent.contentSize.width - 24 &&
                    !loading
                  ) {
                    onEditorMore();
                  }
                }}
                scrollEventThrottle={100}
                contentContainerStyle={s.catalogEditorGrid}
                showsVerticalScrollIndicator
              >
                {editorItems.map((value, index) => (
                  <Pressable
                    key={`${value.provider}:${value.id}`}
                    onPress={() => onOpen(value)}
                    style={[s.catalogEditorCard, { width: editorCardWidth }]}
                    testID="catalog-editor-card"
                  >
                    <View>
                      <ResilientHomeCover
                        clipToImageStyle
                        uri={value.cover}
                        uris={value.coverCandidates}
                        fallback={covers.train}
                        resizeMethod="resize"
                        visualOrder={[0, index + 6]}
                        testID="catalog-editor-cover"
                        moduleKey={catalogCoverModuleKey(index + 6)}
                        style={[
                          s.catalogEditorCover,
                          { width: editorCardWidth, height: editorCardWidth },
                        ]}
                        imageStyle={s.catalogEditorCoverRadius}
                      />
                    </View>
                    <Text
                      style={[s.catalogEditorTitle, { color: c.text }]}
                      numberOfLines={1}
                    >
                      {value.title}
                    </Text>
                    <Text
                      style={[s.catalogEditorMeta, { color: c.muted }]}
                      numberOfLines={1}
                    >
                      {platformLabel(value.provider)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
          <View style={s.catalogSectionHeading}>
            <Text style={[s.catalogSectionTitle, { color: c.text }]}>
              {moreTitle}
            </Text>
          </View>
          <View testID="catalog-collection-rail" style={s.catalogMoreList}>
            {moreItems.map((value, index) => (
              <View
                key={`more-${value.provider}:${value.id}`}
                testID="catalog-more-row"
                style={[
                  s.catalogMoreRow,
                  { borderColor: c.line },
                  kind === 'playlists' && s.catalogMoreRowWithoutDivider,
                ]}
              >
                <Pressable
                  onPress={() => onOpen(value)}
                  style={s.catalogMoreMain}
                >
                  <ResilientHomeCover
                    clipToImageStyle
                    uri={value.cover}
                    uris={value.coverCandidates}
                    fallback={covers.train}
                    resizeMethod="resize"
                    visualOrder={[0, index + 6 + editorItems.length]}
                    testID="catalog-more-cover"
                    moduleKey={catalogCoverModuleKey(index + 16)}
                    style={s.catalogMoreCover}
                    imageStyle={s.catalogMoreCoverRadius}
                  />
                  <View style={s.catalogMoreCopy}>
                    <Text
                      style={[s.catalogMoreTitle, { color: c.text }]}
                      numberOfLines={1}
                    >
                      {value.title}
                    </Text>
                    <Text
                      style={[s.catalogMoreDescription, { color: c.muted }]}
                      numberOfLines={1}
                    >
                      {platformCaption(value.description, value.provider)}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityLabel={
                    app.isCollectionFavorite(value)
                      ? '取消收藏合集'
                      : '收藏合集'
                  }
                  onPress={() => app.toggleCollectionFavorite(value)}
                  style={s.catalogMoreAction}
                >
                  <TrackActionIcon
                    kind="favorite"
                    active={app.isCollectionFavorite(value)}
                    color={app.isCollectionFavorite(value) ? c.accent : c.muted}
                    size={22}
                  />
                </Pressable>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </OrderedCoverScope>
  );
}
export function DetailStyleCatalogList({
  context,
}: {
  context: DetailCatalogListContext;
  onOpen?: (item: CatalogItem) => void;
}) {
  if (context.source) return <CollectionDetail item={context.source} />;
  return <CollectionDetail item={null} listContext={context} />;
}
async function loadDetailTrackPage(
  context: DetailCatalogListContext,
  page: number,
  platforms: PlatformSetting[],
  _cursor: MediaCursor<Track>,
) {
  const result = await loadCategoryFeedPage(
    (context.query || '新歌') as '新歌',
    page,
    platforms,
  );
  if (result.retryable) throw new Error('歌曲目录请求失败，请重试');
  return { items: result.tracks, hasMore: result.hasMore };
}
function useDetailTrackPages(
  context?: DetailCatalogListContext,
  provider: OnlineProvider | 'all' = 'all',
  originReturn?: MediaOriginReturn<Track>,
) {
  const app = useApp();
  const platforms = context
    ? (app.recommendationPlatforms ?? []).filter(
        value => provider === 'all' || value.id === provider,
      )
    : [];
  const providerKey = platforms
    .filter(item => item.enabled)
    .map(item => item.id)
    .join('|');
  const data = useMediaItems<Track>(
    async (page, cursor) => {
      return context
        ? loadDetailTrackPage(context, page, platforms, cursor)
        : { items: [], hasMore: false };
    },
    Boolean(context),
    `detail-tracks:${context?.mediaKind}:${context?.query}:${provider}:${providerKey}`,
    app.pageRefreshToken,
    item => `${item.provider}:${item.providerId ?? item.id}`,
    provider === 'all' ? context?.initialSnapshot : undefined,
    true,
    true,
    originReturn,
  );
  return {
    ...data,
    tracks: data.items,
    offset: data.items.length,
    kind: 'playlists' as const,
  };
}
export function nextAvailableProvider(
  providers: readonly PlatformSetting[],
  failed: readonly OnlineProvider[],
  current?: OnlineProvider | null,
): OnlineProvider | null {
  const candidates = providers.filter(value => !failed.includes(value.id));
  if (!candidates.length) return null;
  const currentIndex = current
    ? candidates.findIndex(value => value.id === current)
    : -1;
  return candidates[currentIndex >= 0 ? currentIndex : 0]?.id ?? null;
}
export function CollectionDetail({
  item: initialItem,
  listContext,
  libraryAppearance = false,
  searchAppearance = false,
  homeReferenceAppearance = false,
}: {
  item: CatalogItem | null;
  listContext?: DetailCatalogListContext;
  libraryAppearance?: boolean;
  searchAppearance?: boolean;
  homeReferenceAppearance?: boolean;
}) {
  const app = useApp(),
    layout = useLayout();
  const c = useTheme();
  // Keep Library's playback history origin while using Home's presentation.
  const libraryVisualAppearance = libraryAppearance && !homeReferenceAppearance;
  const originDetailIdentity = `${app.tab}:${initialItem?.provider}:${initialItem?.id}:${listContext?.mediaKind}:${listContext?.title}:${listContext?.query}`;
  const originDetailView = app.catalogViewState?.get(
    'queue-origin-detail-view',
  ) as
    | {
        identity: string;
        provider?: OnlineProvider | 'all' | null;
      }
    | undefined;
  const [unpinReturnVersion, setUnpinReturnVersion] = useState(-1);
  const savedDetailView =
    app.catalogRestore?.originKey !== undefined &&
    unpinReturnVersion !== app.catalogRestore.version &&
    originDetailView?.identity === originDetailIdentity
      ? originDetailView
      : undefined;
  const originReturnPinned = Boolean(savedDetailView);
  const detailRestoreVersion = useRef(app.catalogRestore?.version);
  const restoreDetailView =
    detailRestoreVersion.current !== app.catalogRestore?.version &&
    Boolean(savedDetailView);
  detailRestoreVersion.current = app.catalogRestore?.version;
  const [todayProviderState, setTodayProvider] = useState<
    OnlineProvider | 'all'
  >('all');
  let todayProvider = todayProviderState;
  const todayProviders = [];
  const detailSource = initialItem?.metadata?.source;
  const providerIndependentSongRail =
    detailSource === 'home-new-releases' || detailSource === 'home-live';
  const homeSongRailDetail =
    (providerIndependentSongRail ||
      detailSource === 'home-rising-chart' ||
      detailSource === 'home-hot-chart') &&
    initialItem?.metadata?.collectionKind === 'charts';
  const chartDetailUsesCollectionCover =
    detailSource === 'home-rising-chart' || detailSource === 'home-hot-chart';
  const chartPlatformIdentity = `${detailSource}:${initialItem?.provider}:${initialItem?.id}`;
  const [additionalChartPlatforms, setAdditionalChartPlatforms] = useState({
    identity: chartPlatformIdentity,
    items: [] as CatalogItem[],
  });
  const chartPlatformItems = useMemo(() => {
    if (providerIndependentSongRail || !initialItem?.metadata) return [];
    const values = initialItem.metadata.platformItems;
    const items = (Array.isArray(values) ? values : []).filter(
      (value): value is CatalogItem => {
        if (!value || typeof value !== 'object') return false;
        const candidate = value as {
          id?: unknown;
          provider?: unknown;
        };
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.provider === 'string' &&
          candidate.provider !== 'custom'
        );
      },
    );
    if (additionalChartPlatforms.identity === chartPlatformIdentity)
      for (const item of additionalChartPlatforms.items)
        if (!items.some(value => value.provider === item.provider))
          items.push(item);
    return items;
  }, [
    initialItem?.metadata,
    providerIndependentSongRail,
    additionalChartPlatforms,
    chartPlatformIdentity,
  ]);
  const chartPlatformItemsRef = useRef(chartPlatformItems);
  chartPlatformItemsRef.current = chartPlatformItems;
  // Home's initial catalog may precede slower passing platforms. Complete only
  // the missing matching charts here, without restarting Home or its song rail.
  const chartProviderKey =
    chartDetailUsesCollectionCover && homeSongRailDetail
      ? (app.recommendationPlatforms ?? [])
          .filter(value => value.enabled)
          .map(value => value.id)
          .join('|')
      : '';
  useEffect(() => {
    if (!chartProviderKey) return;
    let active = true;
    const providers = (chartProviderKey.split('|') as OnlineProvider[]).filter(
      provider =>
        !chartPlatformItemsRef.current.some(
          value => value.provider === provider,
        ),
    );
    if (!providers.length) return;
    const section = homeChartSections.find(
      value => detailSource === `home-${value.key}-chart`,
    );
    if (!section) return;
    Promise.allSettled(
      providers.map(async provider => {
        const charts = await getCatalog(provider, 'charts');
        return charts.find(
          value =>
            value.provider === provider &&
            value.kind === 'charts' &&
            (provider === 'migu' && section.key === 'hot'
              ? value.id === miguHotChart.id
              : section.match.test(value.title)),
        );
      }),
    ).then(results => {
      if (!active) return;
      const items = results.flatMap(result =>
        result.status === 'fulfilled' && result.value ? [result.value] : [],
      );
      setAdditionalChartPlatforms(current => ({
        identity: chartPlatformIdentity,
        items: [
          ...(current.identity === chartPlatformIdentity ? current.items : []),
          ...items,
        ],
      }));
      console.info(
        '[home-chart-platforms]',
        JSON.stringify({
          source: detailSource,
          requested: providers,
          added: items.map(value => value.provider),
          errors: results.filter(value => value.status === 'rejected').length,
        }),
      );
    });
    return () => {
      active = false;
    };
  }, [
    chartPlatformIdentity,
    chartProviderKey,
    detailSource,
    app.pageRefreshToken,
  ]);
  const releaseProviders = homeSongRailDetail
    ? byStartupPassOrder(
        (app.recommendationPlatforms ?? []).filter(
          value =>
            providerIndependentSongRail ||
            chartPlatformItems.some(item => item.provider === value.id),
        ),
        app.startupHealth,
      )
    : [];
  const defaultReleaseProvider = homeSongRailDetail
    ? releaseProviders[0]?.id ?? initialItem?.provider ?? null
    : initialItem?.provider ?? null;
  const savedReleaseProvider =
    savedDetailView?.provider && savedDetailView.provider !== 'all'
      ? savedDetailView.provider
      : undefined;
  const [releaseProviderState, setReleaseProvider] =
    useState<OnlineProvider | null>(
      savedReleaseProvider ??
        (homeSongRailDetail
          ? defaultReleaseProvider
          : initialItem?.provider ?? null),
    );
  let releaseProvider = releaseProviderState;
  if (restoreDetailView && savedReleaseProvider) {
    releaseProvider = savedReleaseProvider;
    setReleaseProvider(releaseProvider);
  }
  const [failedReleaseProviders, setFailedReleaseProviders] = useState<
    OnlineProvider[]
  >([]);
  const releaseResetProvider = useRef(
    savedReleaseProvider ??
      (homeSongRailDetail
        ? defaultReleaseProvider
        : initialItem?.provider ?? null),
  );
  releaseResetProvider.current =
    savedReleaseProvider ??
    (homeSongRailDetail
      ? defaultReleaseProvider
      : initialItem?.provider ?? null);
  useEffect(() => {
    setFailedReleaseProviders([]);
    setReleaseProvider(releaseResetProvider.current);
  }, [
    detailSource,
    homeSongRailDetail,
    initialItem?.id,
    initialItem?.provider,
    app.catalogRestore?.version,
  ]);
  const usableReleaseProviders = releaseProviders.filter(
    value => !failedReleaseProviders.includes(value.id),
  );
  const activeReleaseProvider = homeSongRailDetail
    ? originReturnPinned && savedReleaseProvider
      ? savedReleaseProvider
      : nextAvailableProvider(usableReleaseProviders, [], releaseProvider)
    : null;
  const selectedChart =
    !providerIndependentSongRail && activeReleaseProvider
      ? chartPlatformItems.find(
          value => value.provider === activeReleaseProvider,
        )
      : undefined;
  const item = useMemo(() => {
    if (!initialItem || !homeSongRailDetail || !activeReleaseProvider)
      return initialItem;
    if (activeReleaseProvider === initialItem.provider) return initialItem;
    if (providerIndependentSongRail) {
      return {
        ...initialItem,
        id:
          detailSource === 'home-live'
            ? 'live'
            : newSongChart(activeReleaseProvider),
        provider: activeReleaseProvider,
      };
    }
    if (!selectedChart) return initialItem;
    return {
      ...initialItem,
      ...selectedChart,
      provider: activeReleaseProvider,
      metadata: {
        ...initialItem.metadata,
        ...selectedChart.metadata,
        collectionKind: 'charts',
        detailLayout: 'playlist',
        detailTopGradient: true,
        source: detailSource,
        // Collection cursor identity includes metadata. Capture these options
        // when selecting a chart, so later platforms cannot reset its cursor.
        platformItems: chartPlatformItemsRef.current,
      },
    };
  }, [
    activeReleaseProvider,
    detailSource,
    homeSongRailDetail,
    initialItem,
    providerIndependentSongRail,
    selectedChart,
  ]);
  const importedPlaylist =
    !listContext &&
    !homeSongRailDetail &&
    item &&
    collectionEntityKind(item) === 'playlist' &&
    app.state
      ? savedPlaylistReference(app.state, item)
      : undefined;
  const detailTitle =
    importedPlaylist?.title ?? item?.title ?? listContext?.title ?? '';
  const shareItem =
    !listContext && item && collectionEntityKind(item) === 'playlist'
      ? {
          ...item,
          title: detailTitle,
          cover: importedPlaylist?.cover ?? item.cover,
        }
      : undefined;
  const detailIconStyle = [
    s.playlistIconAction,
    importedPlaylist && playlistManagementLayout.icon,
  ];
  const catalogStateKey = `detail:${originDetailIdentity}:${item?.provider}:${
    app.catalogConfigurationKey ?? ''
  }`;
  const ownerReturnVersion = originReturnPinned
    ? app.catalogRestore!.version
    : undefined;
  const catalogOwner = useRef({
    key: catalogStateKey,
    returnVersion: ownerReturnVersion,
    token: {},
  });
  if (
    catalogOwner.current.key !== catalogStateKey ||
    catalogOwner.current.returnVersion !== ownerReturnVersion
  ) {
    catalogOwner.current = {
      key: catalogStateKey,
      returnVersion: ownerReturnVersion,
      token: {},
    };
  }
  const owner = catalogOwner.current.token;
  const restoredDirectory = useRef<{
    key: string;
    version: number | undefined;
    snapshot?: unknown;
  }>({ key: '', version: undefined });
  if (!originReturnPinned)
    restoredDirectory.current = { key: '', version: undefined };
  else if (
    restoredDirectory.current.key !== catalogStateKey ||
    restoredDirectory.current.version !== ownerReturnVersion
  ) {
    restoredDirectory.current = {
      key: catalogStateKey,
      version: ownerReturnVersion,
      snapshot: app.queueOriginCatalog?.read(
        catalogStateKey,
        owner,
        app.catalogRestore?.originKey,
      ),
    };
  }
  const restoredCollection = restoredDirectory.current.snapshot as
    | CollectionPageSnapshot
    | undefined;
  const restoredMedia = restoredDirectory.current.snapshot as
    | (MediaSurfaceSnapshot<Track> & {
        identity: string;
      })
    | undefined;
  const pinnedProviderAvailable =
    !originReturnPinned ||
    !item ||
    app.recommendationPlatforms.some(platform => platform.id === item.provider);
  // These chart APIs use the selected chart/provider; only Live needs the full
  // platform list. Late health additions must not reset this chart's paging.
  const collectionPages = useCollectionPages(
    pinnedProviderAvailable ? item : null,
    chartDetailUsesCollectionCover ? undefined : app.recommendationPlatforms,
    {
      version: app.catalogRestore?.version ?? 0,
      state: restoredCollection,
      requested: originReturnPinned,
      onChange: snapshot => {
        if (!listContext)
          app.queueOriginCatalog?.update(catalogStateKey, snapshot, owner);
      },
    },
  );
  const listPages = useDetailTrackPages(listContext, 'all', {
    version: app.catalogRestore?.version ?? 0,
    state: restoredMedia,
    requested: originReturnPinned,
    onChange: snapshot => {
      if (listContext)
        app.queueOriginCatalog?.update(catalogStateKey, snapshot, owner);
    },
  });
  const pages = listContext ? listPages : collectionPages;
  const detailPrefetch = useListPrefetch(pages.loadMore, pages);
  const hasDetail = Boolean(item || listContext);
  const observedReleaseProvider = useRef<OnlineProvider | null>(
    activeReleaseProvider,
  );
  const notifyOriginUnavailable = app.notify;
  useEffect(() => {
    if (originReturnPinned) {
      if (
        !pinnedProviderAvailable ||
        (!pages.loading &&
          (pages.error || (!pages.tracks.length && !pages.hasMore)))
      )
        notifyOriginUnavailable('播放列表来源已不可用');
      return;
    }
    if (!homeSongRailDetail || !activeReleaseProvider || pages.loading) return;
    if (observedReleaseProvider.current !== activeReleaseProvider) {
      observedReleaseProvider.current = activeReleaseProvider;
      return;
    }
    const unavailable =
      Boolean(pages.error) || (!pages.tracks.length && !pages.hasMore);
    if (!unavailable) return;
    setFailedReleaseProviders(current =>
      current.includes(activeReleaseProvider)
        ? current
        : [...current, activeReleaseProvider],
    );
  }, [
    activeReleaseProvider,
    homeSongRailDetail,
    observedReleaseProvider,
    pages.error,
    pages.hasMore,
    pages.loading,
    pages.tracks.length,
    originReturnPinned,
    pinnedProviderAvailable,
    notifyOriginUnavailable,
  ]);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [todayDownload, setTodayDownload] = useState<{
    tracks: Track[];
    offset: number;
    hasMore: boolean;
    loadPage: (
      offset: number,
      size: number,
      signal: AbortSignal,
    ) => Promise<{
      tracks: Track[];
      hasMore: boolean;
    }>;
  } | null>(null);
  const [loadedCover, setLoadedCover] = useState({ identity: '', uri: '' });
  const downloading = useRef(new Set<string>());
  const pageTracks = pages.tracks;
  const loadMore = pages.loadMore;
  const prewarmTracks = pageTracks.filter(
    track => !app.isTrackBlocked?.(track),
  );
  const detailVisiblePrewarm = useVisibleTrackPrewarm({
    identity: `${catalogStateKey}:${
      app.prewarmContextKey ?? app.state?.settings.quality
    }:${app.pageRefreshToken ?? 0}`,
    enabled:
      hasDetail &&
      pinnedProviderAvailable &&
      (
        [
          'playlist-detail',
          'search-playlist',
          'new-songs',
          'new-albums',
          'catalog-list',
        ] as AppPage[]
      ).includes(app.page),
    tracks: prewarmTracks,
    prewarm: app.prewarmDetailTracks,
    release: app.releaseDetailPrewarm,
  });
  const tracks = prewarmTracks.filter(
    track => !detailVisiblePrewarm.failedKeys.has(trackQueueKey(track)),
  );
  const todayFavorite =
    tracks.length > 0 && tracks.every(track => app.isFavorite(track));
  const toggleTodayFavorite = () => {
    for (const track of tracks)
      if (todayFavorite || !app.isFavorite(track)) app.toggleFavorite(track);
  };
  const openDownload = () => {
    setDownloadOpen(true);
  };
  const detailPlatforms: Array<{
    id: OnlineProvider | 'all';
  }> = usableReleaseProviders;
  const detailProvider = activeReleaseProvider;
  const detailPlatformOrder = detailPlatforms.map(value => value.id).join('|');
  const platformSnap = usePlaylistPlatformSnap(
    originDetailIdentity,
    detailPlatformOrder,
    detailProvider,
    index => {
      const selected = detailPlatforms[index];
      if (!selected || selected.id === detailProvider) return;
      if (selected.id !== 'all') setReleaseProvider(selected.id);
      setUnpinReturnVersion(app.catalogRestore?.version ?? 0);
    },
  );
  const detailPlatformLabel = (id: OnlineProvider | 'all') =>
    id === 'all' ? '全部平台' : platformLabel(id);
  const detailPageIdentity = listContext
    ? `list:${listContext.mediaKind}:${listContext.query}`
    : `${item?.provider ?? ''}:${item?.id ?? ''}`;
  const detailScrollRef = useRef<ScrollView | null>(null);
  const detailScrollOffset = useRef({ identity: catalogStateKey, y: 0 });
  if (detailScrollOffset.current.identity !== catalogStateKey)
    detailScrollOffset.current = { identity: catalogStateKey, y: 0 };
  const detailViewport = useRef<{
    identity: string;
    event?: NativeScrollEvent;
  }>({ identity: catalogStateKey });
  if (detailViewport.current.identity !== catalogStateKey)
    detailViewport.current = { identity: catalogStateKey };
  const restoredScrollVersion = useRef(-1);
  const restoredScrollTarget = useRef<number | null>(null);
  const restorePagingMetrics = detailPrefetch.onScroll;
  useLayoutEffect(() => {
    if (
      !originReturnPinned ||
      restoredScrollVersion.current === app.catalogRestore?.version
    )
      return;
    const returnOriginKey = app.catalogRestore?.originKey;
    const y = app.queueOriginCatalog?.read<number>(
      `${catalogStateKey}:scroll`,
      owner,
      returnOriginKey,
    );
    const viewport = app.queueOriginCatalog?.read<NativeScrollEvent>(
      `${catalogStateKey}:viewport`,
      owner,
      returnOriginKey,
    );
    restoredScrollVersion.current = app.catalogRestore!.version;
    detailViewport.current.event = viewport;
    // Replace B's metrics before the shared hook's passive viewport lead runs.
    // Unknown A dimensions stay zero until native A layout/scroll supplies them.
    restorePagingMetrics(
      viewport ??
        ({
          contentOffset: { x: 0, y: y ?? 0 },
          layoutMeasurement: { width: 0, height: 0 },
          contentSize: { width: 0, height: 0 },
        } as NativeScrollEvent),
    );
    if (y !== undefined) {
      restoredScrollTarget.current = y;
      detailScrollOffset.current.y = y;
      detailScrollRef.current?.scrollTo({ y, animated: false });
    }
    if (returnOriginKey !== undefined)
      app.queueOriginCatalog?.finishReturn(returnOriginKey);
  }, [
    app.catalogRestore,
    app.queueOriginCatalog,
    catalogStateKey,
    originReturnPinned,
    owner,
    restorePagingMetrics,
    detailScrollRef,
  ]);
  const observeDetailScroll = (event: NativeScrollEvent) => {
    const y = event.contentOffset.y;
    detailScrollOffset.current.y = Math.max(0, y);
    app.queueOriginCatalog?.update(
      `${catalogStateKey}:scroll`,
      detailScrollOffset.current.y,
      owner,
    );
    detailViewport.current.event = {
      contentOffset: { ...event.contentOffset },
      layoutMeasurement: { ...event.layoutMeasurement },
      contentSize: { ...event.contentSize },
    } as NativeScrollEvent;
    app.queueOriginCatalog?.update(
      `${catalogStateKey}:viewport`,
      detailViewport.current.event,
      owner,
    );
    const target = restoredScrollTarget.current;
    restoredScrollTarget.current = null;
    const matchedRestore = target !== null && Math.abs(target - y) < 1;
    if (matchedRestore) restorePagingMetrics(event);
    return matchedRestore;
  };
  const [loadedDetailPageIdentity, setLoadedDetailPageIdentity] =
    useState(detailPageIdentity);
  useEffect(() => {
    setLoadedDetailPageIdentity(detailPageIdentity);
  }, [detailPageIdentity]);
  const firstDetailTrack =
    homeSongRailDetail &&
    loadedDetailPageIdentity === detailPageIdentity &&
    tracks[0]?.provider === item?.provider
      ? tracks[0]
      : undefined;
  const libraryHero = libraryCollectionArtwork(
    item,
    loadedDetailPageIdentity === detailPageIdentity ? tracks[0] : undefined,
  );
  const detailHeroCover =
    libraryVisualAppearance || searchAppearance
      ? libraryHero.cover
      : listContext
      ? tracks[0]?.cover
      : chartDetailUsesCollectionCover
      ? item?.cover
      : firstDetailTrack?.cover ?? item?.cover;
  const detailHeroCoverCandidates =
    libraryVisualAppearance || searchAppearance
      ? libraryHero.coverCandidates
      : listContext
      ? tracks[0]
        ? trackCoverCandidates(tracks[0])
        : []
      : chartDetailUsesCollectionCover
      ? item?.coverCandidates
      : firstDetailTrack
      ? Array.from(
          new Set([
            ...trackCoverCandidates(firstDetailTrack),
            ...(item?.coverCandidates ?? []),
          ]),
        )
      : item?.coverCandidates;
  const detailHasRemoteCover = [
    detailHeroCover,
    ...(detailHeroCoverCandidates ?? []),
  ].some(value => /^https?:\/\//i.test(String(value ?? '').trim()));
  // Collection details often render once before their first page settles. Do
  // not reveal bundled artwork during that metadata gap: start remote artwork
  // as soon as a candidate exists, and only allow the bundled fallback after
  // an empty/error result or an exhausted remote request.
  const detailRemotePending =
    hasDetail &&
    !detailHasRemoteCover &&
    (loadedDetailPageIdentity !== detailPageIdentity ||
      (tracks.length === 0 && !pages.error && pages.hasMore));
  const coverIdentity = `${item?.provider}:${item?.id}:${
    detailHeroCover ?? ''
  }:${(detailHeroCoverCandidates ?? []).join('|')}`;
  useEffect(() => {
    if (
      prewarmTracks.length < pageTracks.length &&
      pages.hasMore &&
      !pages.loading
    )
      loadMore().catch(() => undefined);
  }, [
    app.trackBlacklistVersion,
    loadMore,
    pages.hasMore,
    pages.loading,
    pageTracks.length,
    prewarmTracks.length,
  ]);
  const legacyAudioVisual = false;
  const playlistStyleCollection =
    Boolean(listContext) ||
    item?.kind === 'playlists' ||
    item?.metadata?.detailLayout === 'playlist';
  const fullHomeAppearance =
    playlistStyleCollection &&
    (homeReferenceAppearance || detailSource === 'home-new-releases');
  const showDetailTopGradient =
    homeReferenceAppearance ||
    searchAppearance ||
    (libraryVisualAppearance && playlistStyleCollection) ||
    (!libraryVisualAppearance &&
      (Boolean(listContext) || item?.metadata?.detailTopGradient === true));
  const scrollGradient = usePlaylistDetailScrollGradient(
    `${detailPageIdentity}:${item?.metadata?.collectionKind ?? item?.kind}`,
  );
  const playlistColor = usePlaylistInformationColor(
    playlistStyleCollection && !fullHomeAppearance,
    coverIdentity,
    loadedCover.identity === coverIdentity
      ? loadedCover.uri
      : libraryVisualAppearance
      ? Image.resolveAssetSource(covers.vinyl)?.uri ?? ''
      : '',
    libraryVisualAppearance ? sampleLibraryCoverEdgeColor : undefined,
  );
  const download = async (track: Track, resolved?: DownloadPreview) => {
    if (downloading.current.has(track.id)) return;
    downloading.current.add(track.id);
    try {
      await app.downloadTrack(track, { useLaunchBinding: true, resolved });
    } catch (error) {
      app.notify(error instanceof Error ? error.message : '下载失败，请重试');
    } finally {
      downloading.current.delete(track.id);
    }
  };
  const play = (track: Track, index: number, bulkPlay = false) => {
    const queueOrigin = app.captureQueueOrigin?.(detailTitle, {
      item: initialItem,
      detailView: {
        identity: originDetailIdentity,
        provider: activeReleaseProvider ?? item?.provider,
      },
    });
    if (queueOrigin) {
      app.queueOriginCatalog?.stage(
        queueOrigin,
        catalogStateKey,
        listContext ? listPages.snapshot() : collectionPages.snapshot(),
        owner,
      );
      app.queueOriginCatalog?.stage(
        queueOrigin,
        `${catalogStateKey}:scroll`,
        detailScrollOffset.current.y,
        owner,
      );
      app.queueOriginCatalog?.stage(
        queueOrigin,
        `${catalogStateKey}:viewport`,
        detailViewport.current.event,
        owner,
      );
    }
    return listContext
      ? app
          .playTrack(track, tracks, index, {
            queueOrigin,
            ...(bulkPlay
              ? {
                  bulkPlay: true,
                  onUnavailableTrack: detailVisiblePrewarm.rejectTrack,
                }
              : {}),
            queueSource: catalogSnapshotQueueSource(
              listPages.snapshot(),
              (page, cursor) =>
                loadDetailTrackPage(
                  listContext,
                  page,
                  (app.recommendationPlatforms ?? []).filter(platform => true),
                  cursor,
                ),
            ),
          })
          .catch(() => undefined)
      : app
          .playTrack(track, tracks, index, {
            queueOrigin,
            ...(bulkPlay
              ? {
                  bulkPlay: true,
                  onUnavailableTrack: detailVisiblePrewarm.rejectTrack,
                }
              : {}),
            ...(libraryAppearance && item ? { historyOrigin: { item } } : {}),
            queueSource: item
              ? {
                  kind: 'collection',
                  collectionKind: pages.kind,
                  provider: item.provider,
                  id: item.id,
                  metadata: collectionPages.requestMetadata ?? item?.metadata,
                  offset: pages.offset,
                  hasMore: pages.hasMore,
                  buffered: collectionPages.buffered,
                  remoteHasMore: collectionPages.remoteHasMore,
                }
              : undefined,
          })
          .catch(() => undefined);
  };
  if (!playlistStyleCollection) {
    return (
      <OrderedCoverScope generationKey={`detail:${item?.provider}:${item?.id}`}>
        <OrderedCoverBatch
          candidates={[
            [detailHeroCover, ...(detailHeroCoverCandidates ?? [])],
            ...pages.tracks.map(trackCoverCandidates),
          ]}
          moduleKey="collection-detail"
        />
        <ScrollView
          testID="playlist-detail"
          ref={detailScrollRef}
          onScroll={({ nativeEvent }) => {
            if (observeDetailScroll(nativeEvent)) return;
            detailPrefetch.onScroll(nativeEvent);
          }}
          onLayout={detailPrefetch.onLayout}
          onContentSizeChange={detailPrefetch.onContentSizeChange}
          scrollEventThrottle={100}
          style={[s.root, { backgroundColor: c.bg }]}
          contentContainerStyle={[
            s.playlistContent,
            { paddingBottom: layout.scrollBottomPadding },
          ]}
          showsHorizontalScrollIndicator
          showsVerticalScrollIndicator
        >
          <View
            style={[
              s.subHeader,
              {
                minHeight: layout.headerHeight,
                paddingHorizontal: layout.pageHorizontalPadding,
              },
            ]}
          >
            <Pressable
              accessibilityLabel="返回"
              onPress={app.back}
              style={[
                s.backButton,
                {
                  width: layout.headerButtonSize,
                  height: layout.headerButtonSize,
                },
              ]}
            >
              <Glyph color={c.text} size={31}>
                ‹
              </Glyph>
            </Pressable>
            <Text style={[s.subTitle, { color: c.text }]}>
              {item?.kind === 'charts' ? '榜单详情' : '专辑详情'}
            </Text>
          </View>
          {item ? (
            <>
              <ResilientHomeCover
                clipToImageStyle
                uri={detailHeroCover}
                uris={detailHeroCoverCandidates}
                fallback={covers.train}
                remotePending={detailRemotePending}
                testID="legacy-collection-detail-cover"
                style={[
                  s.detailHeroLegacy,
                  { height: layout.collectionHeroHeight },
                ]}
                imageStyle={s.detailHeroRadius}
              />
              <Text style={[s.detailTitleLegacy, { color: c.text }]}>
                {detailTitle}
              </Text>
              <Text style={[s.detailStats, { color: c.muted }]}>
                {platformLabel(item.provider)}
              </Text>
              {item.description ? (
                <Text style={[s.detailCopyLegacy, { color: c.muted }]}>
                  {platformDisplayText(item.description)}
                </Text>
              ) : null}
              <Pressable
                disabled={!tracks.length}
                onPress={() => tracks[0] && play(tracks[0], 0, true)}
                style={[s.playAllLegacy, { backgroundColor: c.text }]}
              >
                <Glyph color={c.bg}>▶</Glyph>
                <Text style={[s.playAllText, { color: c.bg }]}>
                  播放已加载歌曲 ({tracks.length})
                </Text>
              </Pressable>
              <View style={[s.detailList, { backgroundColor: c.bg }]}>
                {tracks.map((track, index) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    showProvider={true}
                    index={index + 1}
                    darkMode
                    active={app.current?.id === track.id}
                    favorite={app.isFavorite(track)}
                    onFavorite={() => app.toggleFavorite(track)}
                    onPlay={() => play(track, index)}
                  />
                ))}
              </View>
              <ListPagingFooter {...pages} onRetry={pages.loadMore} />
            </>
          ) : (
            <Text style={s.catalogState}>正在加载详情…</Text>
          )}
        </ScrollView>
      </OrderedCoverScope>
    );
  }
  const playlistActions = hasDetail ? (
    <View
      testID="playlist-detail-actions"
      style={[
        s.playlistActions,
        importedPlaylist && playlistManagementLayout.row,
      ]}
    >
      {item ? (
        <>
          <StickyPressable
            testID="playlist-detail-favorite"
            accessibilityRole="button"
            accessibilityLabel={
              app.isCollectionFavorite(item!) ? '取消收藏合集' : '收藏合集'
            }
            disabled
            onPress={() => app.toggleCollectionFavorite(item!)}
            style={detailIconStyle}
          >
            <TrackActionIcon
              kind="favorite"
              size={24}
              active={app.isCollectionFavorite(item!)}
              color={app.isCollectionFavorite(item!) ? c.accent : c.text}
            />
          </StickyPressable>
          <StickyPressable
            testID="playlist-select-download"
            accessibilityRole="button"
            accessibilityLabel={'选择下载歌曲'}
            onPress={openDownload}
            style={detailIconStyle}
          >
            <TrackActionIcon kind="download" size={24} color={c.text} />
          </StickyPressable>
        </>
      ) : null}
      <PlaybackModePicker style={detailIconStyle} sticky />
      {importedPlaylist ? (
        <PlaylistManagementActions
          title={detailTitle}
          style={detailIconStyle}
          onRename={title =>
            app.renameImportedPlaylist(importedPlaylist, title)
          }
          onDelete={() => app.deleteImportedPlaylist(importedPlaylist)}
          onDeleted={() => {
            app.setTab('library');
            app.catalogViewState.set('library-mode', 'music');
            app.catalogViewState.set('library-playlist-opened', null);
            app.open('playlists');
          }}
        />
      ) : null}
      {null}
      {homeSongRailDetail && detailPlatforms.length > 0 ? (
        <View
          testID="playlist-detail-platform-switcher"
          accessibilityLabel={`当前平台：${detailPlatformLabel(
            detailProvider ?? detailPlatforms[0]!.id,
          )}，可左右滑动切换`}
          style={[
            s.playlistPlatformPicker,
            { backgroundColor: c.panelSoft, borderColor: c.line },
          ]}
        >
          <ScrollView
            ref={platformSnap.scrollRef}
            testID="playlist-detail-platform-picker"
            onContentSizeChange={platformSnap.syncPicker}
            onLayout={platformSnap.syncPicker}
            horizontal
            pagingEnabled
            scrollEnabled={detailPlatforms.length > 1}
            showsHorizontalScrollIndicator
            snapToInterval={PLAYLIST_PLATFORM_WIDTH}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="fast"
            contentOffset={platformSnap.contentOffset}
            onScrollBeginDrag={platformSnap.onScrollBeginDrag}
            onScrollEndDrag={platformSnap.onScrollEndDrag}
            onMomentumScrollEnd={platformSnap.onMomentumScrollEnd}
            style={s.playlistPlatformPickerScroll}
            contentContainerStyle={s.playlistPlatformPickerContent}
            showsVerticalScrollIndicator
          >
            {detailPlatforms.map(value => (
              <View
                key={value.id}
                testID={`playlist-detail-platform-${value.id}`}
                accessible
                accessibilityRole="text"
                accessibilityState={{
                  selected: detailProvider === value.id,
                }}
                style={s.playlistPlatformOption}
              >
                <Text
                  style={{
                    color: detailProvider === value.id ? c.text : c.muted,
                    fontSize: 13,
                    fontWeight: detailProvider === value.id ? '600' : '400',
                  }}
                >
                  {detailPlatformLabel(value.id)}
                </Text>
              </View>
            ))}
          </ScrollView>
          {detailPlatforms.length > 1 ? (
            <PlaylistPlatformSwipeHints color={c.muted} />
          ) : null}
        </View>
      ) : null}
      <StickyPressable
        testID="playlist-play-all"
        accessibilityRole="button"
        accessibilityLabel="全部播放"
        disabled={!tracks.length}
        onPress={() => tracks[0] && play(tracks[0], 0, true)}
        style={[
          s.playlistPlayAll,
          importedPlaylist && playlistManagementLayout.playAll,
          { backgroundColor: c.text },
        ]}
      >
        <Glyph color={c.bg} size={18}>
          ▶
        </Glyph>
        <Text style={[s.playAllText, { color: c.bg }]}>全部播放</Text>
      </StickyPressable>
    </View>
  ) : null;
  const playlistRows = hasDetail
    ? tracks.map((track, index) => {
        const row = (
          <TrackRow
            key={track.id}
            track={track}
            index={undefined}
            rowPress={true}
            showPlayButton={legacyAudioVisual}
            showQuality={legacyAudioVisual}
            showProvider={true}
            showDivider={!playlistStyleCollection}
            darkMode
            active={app.current?.id === track.id}
            favorite={app.isFavorite(track)}
            onFavorite={undefined}
            trailing={
              <QueueTrackActions
                track={track}
                scope="playlist-detail"
                showRemove
                scale={1.25}
                onDownload={download}
              />
            }
            onPlay={() => play(track, index)}
          />
        );
        return (
          <View
            key={trackQueueKey(track)}
            testID={`collection-visible-row-${trackQueueKey(track)}`}
            onLayout={event => {
              detailVisiblePrewarm.onRowLayout(trackQueueKey(track), event);
            }}
          >
            {row}
          </View>
        );
      })
    : null;
  const playlistFooter = hasDetail ? (
    <>
      <ListPagingFooter {...pages} onRetry={pages.loadMore} />
      {downloadOpen && item ? (
        <PlaylistDownloadPicker
          key={`${item.provider}:${item.id}${''}`}
          item={item!}
          kind={pages.kind}
          tracks={tracks}
          offset={pages.offset}
          hasMore={pages.hasMore}
          onClose={() => setDownloadOpen(false)}
        />
      ) : null}
    </>
  ) : null;
  if (fullHomeAppearance)
    return (
      <HomePlaylistDetail
        identity={detailPageIdentity}
        scrollRef={detailScrollRef}
        onTrackListLayout={event => {
          detailVisiblePrewarm.onListLayout(event);
        }}
        onControlsLayout={event => {
          detailVisiblePrewarm.onControlsLayout(event);
        }}
        onScrollBeginDrag={undefined}
        title={detailTitle}
        subtitle={
          !homeSongRailDetail && item ? platformLabel(item.provider) : undefined
        }
        description={!homeSongRailDetail ? item?.description : undefined}
        cover={detailHeroCover}
        coverCandidates={detailHeroCoverCandidates}
        remotePending={detailRemotePending}
        ready={hasDetail}
        onBack={app.back}
        headerActions={
          shareItem ? <PlaylistShareButton item={shareItem} /> : undefined
        }
        actions={playlistActions}
        footer={playlistFooter}
        onScroll={({ nativeEvent }) => {
          detailVisiblePrewarm.onScroll(nativeEvent);
          if (observeDetailScroll(nativeEvent)) return;
          detailPrefetch.onScroll(nativeEvent);
        }}
        onLayout={event => {
          detailPrefetch.onLayout(event);
          detailVisiblePrewarm.onLayout(event);
        }}
        onContentSizeChange={(width, height) => {
          detailPrefetch.onContentSizeChange(width, height);
        }}
      >
        {hasDetail ? (
          playlistRows
        ) : (
          <Text style={s.catalogState}>正在加载详情…</Text>
        )}
      </HomePlaylistDetail>
    );
  return (
    <View style={[s.root, { backgroundColor: c.bg }]}>
      <StickyBackgroundExtension
        active={hasDetail && scrollGradient.stuck}
        color={showDetailTopGradient ? c.bg : playlistColor}
      />
      {showDetailTopGradient ? (
        <PlaylistDetailGradientViewport stuck={scrollGradient.stuck} />
      ) : null}
      <ScrollView
        testID="playlist-detail"
        ref={detailScrollRef}
        stickyHeaderIndices={hasDetail ? [1] : undefined}
        removeClippedSubviews
        onScroll={({ nativeEvent }) => {
          detailVisiblePrewarm.onScroll(nativeEvent);
          if (observeDetailScroll(nativeEvent)) return;
          scrollGradient.onScroll(nativeEvent.contentOffset.y);
          detailPrefetch.onScroll(nativeEvent);
        }}
        onLayout={event => {
          detailPrefetch.onLayout(event);
          detailVisiblePrewarm.onLayout(event);
        }}
        onContentSizeChange={detailPrefetch.onContentSizeChange}
        scrollEventThrottle={100}
        style={s.root}
        contentContainerStyle={[
          s.playlistContent,
          { paddingBottom: layout.scrollBottomPadding },
        ]}
        showsHorizontalScrollIndicator
        showsVerticalScrollIndicator
      >
        <PlaylistInformationSurface
          color={playlistColor}
          style={{ paddingBottom: 10 }}
          showGradient
          showTopGradient
          enabled={true}
          identity={coverIdentity}
          coverUri={
            loadedCover.identity === coverIdentity ? loadedCover.uri : ''
          }
        >
          {null}
          <View
            testID="collection-detail-header"
            style={[
              s.subHeader,
              {
                minHeight: 56,
                paddingHorizontal: layout.pageHorizontalPadding,
              },
            ]}
          >
            <Pressable
              accessibilityLabel="返回"
              onPress={app.back}
              style={[
                s.backButton,
                {
                  width: layout.headerButtonSize,
                  height: layout.headerButtonSize,
                },
              ]}
            >
              <Glyph color={c.text} size={31}>
                ‹
              </Glyph>
            </Pressable>
            {shareItem ? <PlaylistShareButton item={shareItem} /> : null}
            {null}
          </View>
          {hasDetail ? (
            <>
              <View style={[s.detailHeroStage, s.playlistDetailHeroStage]}>
                <ResilientHomeCover
                  clipToImageStyle
                  uri={detailHeroCover}
                  uris={detailHeroCoverCandidates}
                  fallback={covers.train}
                  remotePending={detailRemotePending}
                  testID="collection-detail-cover"
                  onLoadedUri={uri =>
                    setLoadedCover({ identity: coverIdentity, uri })
                  }
                  style={[
                    s.detailHero,
                    {
                      height: Math.min(layout.collectionHeroHeight, 300),
                      borderColor: c.line,
                    },
                    s.playlistDetailHero,
                  ]}
                  imageStyle={s.detailHeroRadius}
                />
              </View>
              <Text
                testID="collection-detail-title"
                numberOfLines={2}
                style={[
                  s.detailTitle,
                  { color: c.text },
                  s.playlistDetailTitle,
                ]}
              >
                {detailTitle}
              </Text>
              {!homeSongRailDetail && item ? (
                <Text
                  testID="collection-detail-stats"
                  style={[
                    s.detailStats,
                    { color: c.muted },
                    s.playlistDetailStats,
                  ]}
                >
                  {item ? platformLabel(item.provider) : ''}
                </Text>
              ) : null}
              {!homeSongRailDetail && item?.description ? (
                <Text
                  testID="playlist-detail-description"
                  style={[
                    s.detailCopy,
                    s.playlistDetailCopy,
                    { color: c.muted },
                  ]}
                  numberOfLines={2}
                >
                  {platformDisplayText(item.description)}
                </Text>
              ) : null}
              {null}
              {null}
            </>
          ) : null}
        </PlaylistInformationSurface>
        {hasDetail ? (
          <View
            testID="playlist-sticky-actions"
            onLayout={event => {
              scrollGradient.onStickyLayout(event);
              detailVisiblePrewarm.onControlsLayout(event);
            }}
            style={{
              height: 72,
              marginBottom: searchAppearance ? 0 : 8,
              backgroundColor: playlistColor,
            }}
          >
            {showDetailTopGradient && scrollGradient.stuck ? (
              <PlaylistInformationTopGradient />
            ) : null}
            <PlaylistInformationGradient />
            {playlistActions}
          </View>
        ) : null}
        {hasDetail ? (
          <>
            <View
              testID="playlist-detail-track-list"
              onLayout={detailVisiblePrewarm.onListLayout}
              style={[
                s.detailList,
                { backgroundColor: c.bg },
                searchAppearance && { marginTop: 0 },
              ]}
            >
              {playlistRows}
            </View>
            {playlistFooter}
          </>
        ) : (
          <Text style={s.catalogState}>正在加载详情…</Text>
        )}
      </ScrollView>
    </View>
  );
}
function PlaylistPlatformSwipeHints({ color }: { color: string }) {
  const offset = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(offset, {
          toValue: 1,
          duration: 760,
          useNativeDriver: true,
        }),
        Animated.timing(offset, {
          toValue: 0,
          duration: 760,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [offset]);
  const topShift = offset.interpolate({
    inputRange: [0, 1],
    outputRange: [-5, 5],
  });
  const bottomShift = offset.interpolate({
    inputRange: [0, 1],
    outputRange: [5, -5],
  });
  return (
    <>
      <Animated.View
        testID="playlist-detail-platform-swipe-hint-top"
        pointerEvents="none"
        accessible
        style={[
          s.playlistPlatformSwipeHint,
          s.playlistPlatformSwipeHintTop,
          { transform: [{ translateX: topShift }] },
        ]}
      >
        <Text style={[s.playlistPlatformSwipeHintText, { color }]}>‹ ›</Text>
      </Animated.View>
      <Animated.View
        testID="playlist-detail-platform-swipe-hint-bottom"
        pointerEvents="none"
        accessible
        style={[
          s.playlistPlatformSwipeHint,
          s.playlistPlatformSwipeHintBottom,
          { transform: [{ translateX: bottomShift }] },
        ]}
      >
        <Text style={[s.playlistPlatformSwipeHintText, { color }]}>‹ ›</Text>
      </Animated.View>
    </>
  );
}
const surfaceShadow = {
  shadowColor: '#17305F',
  shadowOpacity: 0.08,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 5 },
  elevation: 3,
};
const s = createThemedStyles(
  StyleSheet.create({
    root: { flex: 1, backgroundColor: light.bg },
    homeContentVisible: { flex: 1 },
    homeContentHidden: { display: 'none' },
    mediaPageRoot: { backgroundColor: 'transparent' },
    playlistDetailTopGradientViewport: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 80,
      zIndex: 10,
      elevation: 1,
    },
    hiddenDetailTopGradientViewport: { opacity: 0 },
    catalogPageContent: { paddingBottom: 32 },
    catalogHero: { height: 252, justifyContent: 'space-between' },
    catalogHeroImage: { opacity: 0.9, borderRadius: 18 },
    catalogHeroShade: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(3, 9, 22, 0.46)',
    },
    catalogHeroTop: {
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    catalogHeroButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    catalogHeroPlay: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.18)',
    },
    catalogHeroCopy: { paddingHorizontal: 22, paddingBottom: 24 },
    catalogHeroTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    catalogHeroEyebrow: {
      color: 'rgba(255,255,255,0.72)',
      fontSize: 11,
      letterSpacing: 1.1,
    },
    catalogHeroTitle: {
      flex: 1,
      color: '#fff',
      fontFamily: serif,
      fontSize: 31,
      lineHeight: 38,
      marginTop: 7,
    },
    catalogCategoryScroller: { flexGrow: 0, height: 62 },
    catalogCategoryRow: { paddingHorizontal: 18, paddingVertical: 12, gap: 8 },
    catalogCategory: {
      minHeight: 36,
      paddingHorizontal: 16,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center',
    },
    catalogCategoryActive: {
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 2 },
    },
    catalogCategoryText: { fontSize: 13 },
    catalogSearchCluster: {
      flexDirection: 'row',
      alignItems: 'center',
      overflow: 'hidden',
    },
    catalogSearchInputWrap: {
      height: 36,
      overflow: 'hidden',
      justifyContent: 'center',
    },
    catalogSearchInput: {
      height: 36,
      minWidth: 0,
      width: '100%',
      paddingHorizontal: 14,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: light.line,
      backgroundColor: light.panelSoft,
      fontSize: 13,
    },
    catalogSearchConfirm: {
      height: 36,
      minWidth: 48,
      paddingHorizontal: 10,
      borderRadius: 18,
      backgroundColor: light.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    catalogSearchConfirmText: { fontSize: 12, fontWeight: '600' },
    catalogStickyFilters: {
      zIndex: 4,
      elevation: 4,
      flexDirection: 'column-reverse',
    },
    catalogFeaturedRail: { paddingHorizontal: 18, gap: 12 },
    catalogFeatured: {
      marginHorizontal: 0,
      marginTop: 10,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
      position: 'relative',
    },
    catalogFeaturedImage: { justifyContent: 'flex-end' },
    catalogFeaturedImageRadius: { borderRadius: 18 },
    catalogFeaturedImageShade: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(4, 10, 24, 0.18)',
    },
    catalogFeaturedOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      minHeight: 64,
      paddingHorizontal: 14,
      paddingBottom: 12,
      flexDirection: 'row',
      alignItems: 'flex-end',
      backgroundColor: 'rgba(4, 10, 24, 0.56)',
    },
    catalogFeaturedCopy: { padding: 16 },
    catalogFeaturedEyebrow: { fontSize: 12, letterSpacing: 0.6 },
    catalogFeaturedTitle: {
      flex: 1,
      fontSize: 22,
      lineHeight: 28,
      fontWeight: '400',
    },
    catalogFeaturedDescription: { fontSize: 13, lineHeight: 19, marginTop: 6 },
    catalogSectionHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginHorizontal: 18,
      marginTop: 22,
      marginBottom: 9,
    },
    catalogSectionTitle: {
      fontSize: 20,
      marginHorizontal: 18,
      marginTop: 22,
      marginBottom: 9,
      fontWeight: '400',
    },
    catalogSectionMore: { fontSize: 13, marginTop: 16 },
    catalogEditorGrid: { flexDirection: 'row', gap: 12, paddingHorizontal: 18 },
    catalogEditorCard: { width: 164 },
    catalogEditorCover: { width: 164, height: 164 },
    catalogEditorCoverRadius: { borderRadius: 13 },
    catalogEditorTitle: { fontSize: 14, marginTop: 7 },
    catalogEditorMeta: { fontSize: 12, marginTop: 3 },
    catalogMoodGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      paddingHorizontal: 18,
    },
    catalogMoodCard: {
      width: '48%',
      minHeight: 106,
      borderRadius: 15,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
    },
    catalogMoodCover: { ...StyleSheet.absoluteFill },
    catalogMoodRadius: { borderRadius: 15 },
    catalogMoodShade: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(8, 15, 30, 0.46)',
    },
    catalogMoodCopy: { flex: 1, minWidth: 0 },
    catalogMoodTitle: { color: '#fff', fontSize: 16 },
    catalogMoodDescription: {
      color: 'rgba(255,255,255,0.82)',
      fontSize: 12,
      marginTop: 5,
    },
    catalogMoreList: { paddingHorizontal: 18 },
    catalogMoreRow: {
      minHeight: 82,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    catalogMoreRowWithoutDivider: { borderBottomWidth: 0 },
    catalogMoreMain: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
    },
    catalogMoreCover: { width: 62, height: 62 },
    catalogMoreCoverRadius: { borderRadius: 10 },
    catalogMoreCopy: { flex: 1, minWidth: 0, marginLeft: 12 },
    catalogMoreTitle: { fontSize: 15 },
    catalogMoreDescription: { fontSize: 12, marginTop: 5 },
    catalogMoreAction: {
      width: 42,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: { paddingBottom: 86 },
    otherChartsTitle: { marginTop: 18 },
    roundAction: {
      width: 41,
      height: 41,
      borderRadius: 20.5,
      backgroundColor: light.panelSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    homeNavRoot: { height: HOME_TOP_NAV_HEIGHT, zIndex: 20 },
    homeNavBar: {
      height: HOME_TOP_NAV_HEIGHT,
      paddingHorizontal: 26,
      flexDirection: 'row',
      alignItems: 'center',
    },
    homeMenuButton: {
      width: 49,
      height: 49,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
    },
    homeSearchAction: {
      marginLeft: 'auto',
      width: 49,
      height: 49,
      borderRadius: 24.5,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    homeSearchGlyph: {
      color: light.text,
      fontSize: 32,
      lineHeight: 36,
      fontWeight: '400',
      includeFontPadding: false,
      textAlign: 'center',
      textAlignVertical: 'center',
    },
    menuLine: {
      width: 23,
      height: 2.9,
      borderRadius: 1.5,
      backgroundColor: light.blue,
    },
    homeMediaNav: {
      flex: 1,
      minWidth: 0,
      marginLeft: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    homeMediaTarget: {
      height: 49,
      justifyContent: 'center',
    },
    homeMediaText: {
      color: light.text,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: '400',
    },
    homeMediaTextActive: { color: light.text },
    homeMediaLine: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 2.9,
      borderRadius: 1.5,
      backgroundColor: light.blue,
    },
    homeSectionTitle: { marginTop: 8 },
    playlistScroller: { flexGrow: 0, height: 122 },
    playlistRail: { paddingHorizontal: 18, paddingBottom: 0, gap: 8 },
    homePlaylistRail: { paddingTop: 8 },
    homeChartsRail: { paddingTop: 8 },
    verticalPlaylistList: {
      paddingTop: HOME_VERTICAL_SECTION_GAP,
      paddingHorizontal: 18,
      gap: HOME_VERTICAL_CARD_GAP,
    },
    verticalPlaylistCard: {
      height: HOME_VERTICAL_CARD_HEIGHT,
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 14,
      paddingHorizontal: 14,
    },
    verticalPlaylistImage: {
      width: 112,
      height: 112,
      flexShrink: 0,
    },
    verticalPlaylistImageRadius: { borderRadius: 7 },
    verticalPlaylistCoverButton: {
      width: 112,
      height: 112,
    },
    verticalPlaylistCopy: {
      flex: 1,
      height: 112,
      minWidth: 0,
      paddingLeft: 15,
    },
    verticalPlaylistTitle: {
      color: light.text,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '400',
    },
    verticalPlaylistSub: {
      color: light.muted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 4,
    },
    verticalPlaylistFavorite: {
      minWidth: 82,
      height: 36,
      borderRadius: 18,
      borderWidth: 0,
      paddingHorizontal: 11,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      marginTop: 'auto',
      alignSelf: 'flex-end',
    },
    verticalPlaylistFavoriteSelected: {
      backgroundColor: light.selectedSurface,
    },
    verticalPlaylistFavoriteText: { fontSize: 12, fontWeight: '400' },
    verticalPlaylistFavoriteTextActive: { color: light.accent },
    verticalPlaylistFavoriteTextInactive: { color: light.text },
    playlistCard: {
      width: 292,
      borderRadius: 18,
      backgroundColor: light.panel,
      overflow: 'hidden',
      ...surfaceShadow,
    },
    playlistImage: { height: 82 },
    playlistRadius: { borderTopLeftRadius: 18, borderTopRightRadius: 18 },
    playlistFooter: {
      height: 48,
      paddingHorizontal: 13,
      flexDirection: 'row',
      alignItems: 'center',
    },
    playlistCopy: { flex: 1, minWidth: 0 },
    playlistTitle: { color: light.text, fontSize: 15, fontWeight: '400' },
    playlistSub: { color: light.muted, fontSize: 12, marginTop: 3 },
    platformStrip: {
      height: 25,
      marginHorizontal: 10,
      marginTop: 2,
      paddingHorizontal: 10,
      borderRadius: 12,
      backgroundColor: light.panel,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    platformLabel: { color: light.muted, fontSize: 12 },
    platformName: { color: light.text, fontSize: 12, fontWeight: '400' },
    errorText: {
      color: '#B74848',
      fontSize: 13,
      lineHeight: 19,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    subHeader: {
      minHeight: 76,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    subHeaderCopy: { flex: 1, minWidth: 0 },
    subHeaderAction: {
      minHeight: 44,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    subHeaderActionText: {
      color: light.accent,
      fontSize: 13,
      fontWeight: '400',
    },
    backButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    subTitle: { color: light.text, fontSize: 26, fontWeight: '400' },
    subCopy: { color: light.muted, fontSize: 12, marginTop: 2 },
    feedTabs: { paddingHorizontal: 14, paddingBottom: 10, gap: 7 },
    feedTab: {
      minHeight: 40,
      paddingHorizontal: 14,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: light.line,
      backgroundColor: light.panel,
      justifyContent: 'center',
    },
    feedTabActive: {
      backgroundColor: light.selectedSurface,
    },
    feedTabText: { color: light.muted, fontSize: 13 },
    feedTabTextActive: { color: light.accent, fontWeight: '400' },
    list: { paddingBottom: 10 },
    pager: {
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: light.line,
      backgroundColor: light.panel,
    },
    pageButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pageText: { color: light.muted, fontSize: 13 },
    playlistContent: { paddingBottom: 28 },
    detailTopBar: {
      minHeight: 76,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    detailTopActions: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    detailHeroStage: {
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingTop: 12,
    },
    detailHero: {
      width: '76%',
      maxWidth: 330,
      aspectRatio: 1,
      marginHorizontal: 18,
      borderWidth: StyleSheet.hairlineWidth,
    },
    detailHeroRadius: { borderRadius: 22 },
    playlistDetailHeroStage: { paddingTop: 4 },
    playlistDetailHero: {
      width: 168,
      height: 168,
      maxWidth: 168,
      borderRadius: 22,
    },
    playlistDetailTitle: { fontSize: 20, lineHeight: 26, marginTop: 12 },
    playlistDetailStats: { fontSize: 12 },
    playlistDetailCopy: { fontSize: 11, lineHeight: 16, marginTop: 8 },
    playlistIconAction: {
      width: 48,
      height: 64,
      minWidth: 48,
      minHeight: 64,
      paddingHorizontal: 0,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    detailHeroLegacy: { marginHorizontal: 18 },
    detailTitleLegacy: {
      color: light.text,
      fontFamily: serif,
      fontSize: 30,
      fontWeight: '400',
      margin: 18,
      marginBottom: 6,
    },
    detailCopyLegacy: {
      color: light.muted,
      margin: 18,
      marginTop: 10,
      lineHeight: 21,
      fontSize: 14,
    },
    playAllLegacy: {
      marginHorizontal: 18,
      height: 50,
      borderRadius: 25,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    detailTitle: {
      color: light.text,
      fontFamily: serif,
      fontSize: 30,
      fontWeight: '400',
      marginHorizontal: 18,
      marginTop: 20,
      marginBottom: 6,
      textAlign: 'center',
    },
    detailStats: {
      color: light.muted,
      marginHorizontal: 18,
      fontSize: 13,
      textAlign: 'center',
    },
    detailCopy: {
      color: light.muted,
      marginHorizontal: 30,
      marginTop: 12,
      lineHeight: 21,
      fontSize: 14,
      textAlign: 'center',
    },
    playlistActions: {
      height: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginHorizontal: 12,
    },
    playlistPlatformPicker: {
      width: PLAYLIST_PLATFORM_WIDTH,
      height: 48,
      borderRadius: 24,
      borderWidth: StyleSheet.hairlineWidth,
      position: 'relative',
      overflow: 'hidden',
    },
    playlistPlatformPickerScroll: {
      width: PLAYLIST_PLATFORM_WIDTH,
      height: 48,
    },
    playlistPlatformPickerContent: {
      alignItems: 'center',
    },
    playlistPlatformOption: {
      width: PLAYLIST_PLATFORM_WIDTH,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    playlistPlatformSwipeHint: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 12,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    playlistPlatformSwipeHintTop: { top: 1 },
    playlistPlatformSwipeHintBottom: { bottom: 1 },
    playlistPlatformSwipeHintText: {
      fontSize: 10,
      lineHeight: 11,
      fontWeight: '600',
      letterSpacing: 2,
    },
    playlistPlayAll: {
      width: 132,
      minWidth: 132,
      marginLeft: 'auto',
      height: 48,
      borderRadius: 24,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    detailActions: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 14,
      marginTop: 18,
      marginBottom: 16,
    },
    detailAction: {
      width: 62,
      height: 62,
      borderRadius: 31,
      alignItems: 'center',
      justifyContent: 'center',
    },
    detailActionLabel: { fontSize: 11, marginTop: 2 },
    playAll: {
      marginHorizontal: 28,
      height: 50,
      borderRadius: 25,
      backgroundColor: light.blue,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    playAllText: { color: '#fff', fontWeight: '400' },
    detailList: { marginTop: 12 },
    detailPager: {
      height: 64,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
    },
    catalogProviderScroller: { flexGrow: 0, height: 58 },
    catalogProviders: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
    catalogProvider: {
      minHeight: 38,
      paddingHorizontal: 15,
      borderRadius: 19,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: light.line,
      justifyContent: 'center',
      backgroundColor: light.panel,
    },
    catalogProviderActive: {
      backgroundColor: light.selectedSurface,
    },
    catalogProviderText: { color: light.muted, fontSize: 13 },
    catalogProviderTextActive: { color: light.accent, fontWeight: '400' },
    catalogList: { paddingHorizontal: 16, paddingBottom: 18 },
    mediaList: { paddingHorizontal: 16, paddingBottom: 86 },
    mediaWarning: {
      marginTop: 10,
      color: light.muted,
      fontSize: 11,
      lineHeight: 16,
    },
    catalogState: {
      color: light.muted,
      textAlign: 'center',
      paddingVertical: 40,
      fontSize: 14,
    },
    catalogRow: {
      minHeight: 88,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: light.line,
    },
    catalogCover: { width: 68, height: 68 },
    catalogCoverRadius: { borderRadius: 13 },
    catalogCopy: { flex: 1, minWidth: 0 },
    catalogTitle: { color: light.text, fontSize: 15, fontWeight: '400' },
    catalogDescription: {
      color: light.muted,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 5,
    },
  }),
);
