import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  BackHandler,
  DeviceEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
  StatusBar,
  View,
} from 'react-native';
import {
  readStartupAppearance,
  STARTUP_PALETTES,
  StartupSplashView,
} from '../components/StartupSplash';
import { catalog } from '../data/catalog';
import type {
  AppSettings,
  CatalogItem,
  DiscoveryCategory,
  EqualizerPreset,
  EqualizerPresetCategory,
  LibraryMediaKind,
  MusicHistoryOrigin,
  NativePlayerState,
  PersistedState,
  PlatformSetting,
  PlaybackMode,
  Playlist,
  SourceSetting,
  Track,
} from '../domain/types';
import {
  equalizerPresetLabels,
  playbackModeSettings,
  settingsQualityLabel,
  trackQueueKey,
} from '../domain/types';
import type { AdvancedEffects } from '../services/audioEffectState';
import { AudioEffectStateManager } from '../services/audioEffectState';
import { audioQuality } from '../services/audioQuality';
import { forgetClearedLocalArtwork } from '../services/cacheCleanup';
import { holdQueuePageTask } from '../services/carLibraryTasks';
import { collectionFavoriteKey } from '../services/collectionIdentity';
import {
  downloadTrackKey,
  playbackDownloadSource,
  positiveBytes,
  type DownloadActivity,
  type DownloadPreview,
} from '../services/downloadPresentation';
import type { EffectEditTarget } from '../services/effectEditing';
import {
  effectEditingTarget,
  effectTargetMatches,
  normalizeEffectUserOverrides,
  savedEffectHasScope,
} from '../services/effectEditing';
import type {
  EffectApplyOptions,
  EffectScope,
} from '../services/effectIsolation';
import {
  commitEffects,
  effectScope,
  forgetSavedEffect,
  readEffects,
  restoreLaunchEffects,
} from '../services/effectIsolation';
import { gtoScenes, presetTuning, zeusScenes } from '../services/effectScenes';
import {
  deleteEqualizerPreset,
  storeEqualizerPreset,
  validEqualizerGains,
} from '../services/equalizer';
import { EqualizerUpdates } from '../services/equalizerUpdates';
import {
  loadHomeMenuFirstBatch,
  type HomeMenuCursor,
} from '../services/homeMenuDiscovery';
import {
  advanceExhaustedMenuRound,
  menuProgressEntry,
  mergeMenuProgress,
} from '../services/homeMenuProgress';
import {
  libraryLocalPlaybackFailure,
  localPlaybackReference,
  resolveLocalPlaybackReference,
  validateLocalPlaybackAudio,
} from '../services/libraryPlayback';
import { getLibraryTrackArtwork } from '../services/libraryTrackArtwork';
import {
  deleteLinkedPlaylist,
  renameLinkedPlaylist,
  savedPlaylistReference,
} from '../services/linkedPlaylist';
import {
  constituentArtists,
  detectHealthyPlatforms,
  loadCategoryFeed,
  loadDesktopHealthSample,
  orderedHealthyProviders,
  startPlatformHealthDetection,
  type PlatformHealthResult,
} from '../services/liveDiscovery';
import {
  localMusicFileReferences,
  removeDownloadedMusic,
  resolveLocalMusicArtwork,
  syncDownloadedMusic,
} from '../services/localMusicLibrary';
import {
  recoverMissingMusicDownload,
  replaceRecoveredMusicDownload,
} from '../services/localMusicRecovery';
import { hasExternalMediaOrigin } from '../services/mediaDiscoveryPaging';
import {
  allDownloads,
  collectionMediaKind,
  mediaDownloads,
  trackMediaKind,
} from '../services/mediaLibrary';
import {
  mergeMusicEntityHistory,
  MusicEntityHistoryRecorder,
} from '../services/musicEntityHistory';
import {
  rememberMusicHistory,
  retainRecentMusicState,
} from '../services/musicHistoryRetention';
import {
  accumulateMusicStatistics,
  favoriteStatisticsFor,
  memoryStatisticsFor,
} from '../services/musicPreferenceStatistics';
import { nativePlayer } from '../services/nativePlayer';
import {
  downloadNetworkQuality,
  isWifiNetwork,
  playbackNetworkQuality,
  readWifiNetwork,
  subscribeWifiNetwork,
} from '../services/networkQuality';
import {
  resolvePlayback,
  resolvePlaybackAddress,
  resolvePlaybackPrewarm,
  resolvePlaybackWithQuality,
  searchOnline,
  searchOnlinePlaylists,
  type PlaybackTimingObserver,
} from '../services/onlineMusic';
import { commitPersonalPlaylistImport } from '../services/personalPlaylistShare';
import { platformLabel } from '../services/platformPresentation';
import {
  prepareValidatedTracks,
  selectFirstResolvableTrack,
} from '../services/playbackPreparation';
import {
  isSourceBindingUnavailable,
  PLATFORM_UNBOUND_MESSAGE,
  SourceBindingUnavailableError,
} from '../services/playbackSourceAvailability';
import { PlayerQueuePreparation } from '../services/playerQueuePreparation';
import {
  automaticPlayerTarget,
  manualPlayerTarget,
  PlayerRequestCancelled,
  waitForPlayerRequest,
} from '../services/playerRequest';
import {
  commitPlaylistImport,
  type PlaylistClipboardSource,
  type PlaylistImportOptions,
  type PlaylistImportResult as PlaylistImportPreview,
  type PlaylistReference,
} from '../services/playlistImport';
import { queueAheadTarget } from '../services/queueAhead';
import { extendOrderedQueue, queueIndexForKey } from '../services/queueOrder';
import {
  isStartupQueueSource,
  nextQueuePage,
  QUEUE_BATCH_SIZE,
  QUEUE_PAGE_TIMEOUT_MS,
  queueSourceProgressKey,
  sourceWithSeenKeys,
  withQueueRemainder,
  type QueueSource,
} from '../services/queuePaging';
import { learn } from '../services/recommendation';
import { clearSafeRuntimeCaches } from '../services/runtimeCache';
import {
  isMenuSceneQueue,
  scenePlaybackFailure,
  type ScenePlaybackStage,
} from '../services/scenePlaybackPolicy';
import { isCurrentSourceHealthGeneration } from '../services/sourceHealthGeneration';
import { isSourceAuthorized, isSourceEnabled } from '../services/sourcePolicy';
import {
  clearResolvedSourceCache,
  hasValidatedPlaybackPrewarm,
  probeManualSource,
  resetLaunchBackendPools,
  resolveWithImportedSourcePrewarm,
  sourceAddressCacheKey,
  sourceResolutionCacheToken,
} from '../services/sourceRuntime';
import {
  allCacheCleanupParts,
  chooseDownloadDirectory,
  clearNativeCache,
  deleteLocalFile,
  downloadAudio,
  downloadAudioWithProgress,
  exportStateBackup,
  getStateStorageStatus,
  importSourceScript,
  importStateBackup,
  loadState,
  pickLocalAudioFiles,
  probeLocalAudio,
  queryDownloadHeaders,
  queryDownloadStatus,
  queryLocalFileIdentities,
  queryLocalFileSize,
  readLocalAudioArtwork,
  saveState,
  scanAllLocalMusic,
  scanLocalMusicDirectory,
  subscribeStateStorageStatus,
  testImportedSourceScript,
  type CacheCleanupPart,
} from '../services/storage';
import { removeTrackPlaylistMembership } from '../services/trackActionState';
import {
  filterPlayableCandidates,
  isRuntimeTrackBlocked,
  isTrackPlaybackRejected,
  subscribeRuntimeTrackBlacklist,
} from '../services/trackPlaybackPolicy';
import {
  UrlPrewarmScheduler,
  type UrlPrewarmLane,
  type UrlPrewarmOutcome,
} from '../services/urlPrewarmScheduler';
import { DesktopLyricsBridge } from './useDesktopLyrics';
export type AppTab = 'discovery' | 'search' | 'library' | 'settings';
export interface PlayTrackOptions {
  openPlayer?: boolean;
  queueSource?: QueueSource;
  /** Process-only entry provenance, independent of the continuation cursor. */
  queueOrigin?: QueueOrigin;
  /** Descriptive provenance only; never changes queue construction or playback. */
  historyOrigin?: MusicHistoryOrigin | null;
  /** Internal bounded fallback depth used by the player after a failed start. */
  fallbackDepth?: number;
  /** Process-only visited entries for a single menu-scene failure chain. */
  sceneFailedKeys?: string[];
  /** Startup/manual navigation may advance after a failed target; cold taps may not. */
  allowFailureFallback?: boolean;
  /** Explicit loaded-list bulk action; ordinary song taps never set this. */
  bulkPlay?: boolean;
  onUnavailableTrack?: (key: string) => void;
  /** Internal launch handoff; only the launch-marked default-mode queue may use this policy. */
  startupPlayback?: {
    sourceGeneration: number;
    failedKeys?: string[];
    beforeNativeLoad: () => Promise<void>;
  };
  quality?: PersistedState['settings']['quality'];
  /** Re-resolve a prepared target after the global quality preference changes. */
  forceQualityRefresh?: boolean;
  /** Internal token used by the high-priority previous/next dispatcher. */
  navigationToken?: number;
  providerAlreadyStopped?: boolean;
  failureDirection?: -1 | 1;
}
export type AppPage =
  | 'root'
  | 'home-menu'
  | 'feed'
  | 'playlist'
  | 'playlist-detail'
  | 'catalog-list'
  | 'new-songs'
  | 'new-albums'
  | 'radio'
  | 'video'
  | 'live'
  | 'history'
  | 'playlists'
  | 'personal-playlist'
  | 'downloads'
  | 'local'
  | 'favorites'
  | 'search-playlist'
  | 'library-browse'
  | 'player'
  | 'lyrics'
  | 'effects'
  | 'queue'
  | 'appearance'
  | 'playback'
  | 'sources'
  | 'data'
  | 'shortcuts'
  | 'experiments'
  | 'about';
function sanitizeStartupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/音源|后端|脚本|无数据|播放链路|HTTP|所有后端均失败/i.test(message))
    return '启动推荐暂时不可用：当前歌曲没有可播放的在线音源';
  return '启动推荐暂时不可用';
}
export type SearchCategory = 'song' | 'artist' | 'album' | 'playlist';
export interface SearchState {
  query: string;
  category: SearchCategory;
  provider: 'all' | PlatformSetting['id'];
  page: number;
  hasNext: boolean;
  /** Remote continuation for playback, independent of visible search count. */
  queueHasMore?: boolean;
  queueProviderPages?: Partial<Record<PlatformSetting['id'], number>>;
  loading: boolean;
  tracks: Track[];
  errors: string[];
  playlists: CatalogItem[];
}
export interface QueueOrigin {
  catalogKey: number;
  label: string;
  tab: AppTab;
  page: AppPage;
  stack: AppPage[];
  homeMenuOrigin: 'home' | 'player' | null;
  navigation: Array<[string, unknown]>;
  search?: SearchState;
  category?: DiscoveryCategory;
  feedPage?: number;
  personalPlaylistId?: string;
}
interface QueueOriginTarget {
  tab?: AppTab;
  page?: AppPage;
  item?: CatalogItem | null;
  personalPlaylistId?: string;
  menuChoiceId?: string;
  detailView?: {
    identity: string;
    provider?: string | null;
  };
}
// Only navigation selectors belong to provenance. Catalog data, generations,
// page cursors, request functions and playback URLs stay in their own services.
const queueOriginNavigationDefaults: Record<
  AppTab,
  Array<[string, unknown]>
> = {
  discovery: [
    ['home-selected', null],
    [
      'home-playlist-browser-context',
      { mediaKind: 'music', title: '歌单推荐' },
    ],
    ['home-detail-catalog-list', null],
    ['home-origin-scroll-y', 0],
    ['home-menu-choice', 'mode-default'],
  ],
  search: [['search-detail', null]],
  library: [
    ['library-mode', 'music'],
    ['library-music-list', 'history'],
    ['library-playlist-tab', 'curated'],
    ['library-detail', null],
    ['library-detail-home-reference', false],
    ['library-playlist-opened', null],
    ['library-record-filters', {}],
  ],
  settings: [],
};
const originPageLabels: Partial<Record<AppPage, string>> = {
  root: '首页',
  'home-menu': '歌曲分类',
  feed: '综合推荐',
  'new-songs': '新歌首发',
  radio: '电台',
  live: 'Live 现场',
  history: '最近播放',
  favorites: '我的收藏',
  downloads: '已下载',
  local: '本地文件',
  playlists: '我的歌单',
  'personal-playlist': '我的歌单',
  playlist: '歌单推荐',
  'catalog-list': '歌曲列表',
};
// Retained directory data owns its cursor and metadata; audio bindings remain
// exclusively in the existing process playback caches, including buffered rows.
function copyOriginCatalogMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyOriginCatalogMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'playUrl')
      .map(([key, nested]) => [key, copyOriginCatalogMetadata(nested)]),
  );
}
export interface Controller {
  rememberHomeMenuBatch?: (cursor: HomeMenuCursor, tracks: Track[]) => void;
  catalogViewState: Map<string, unknown>;
  catalogRestore: {
    version: number;
    keys: string[];
    originKey?: number;
  };
  catalogConfigurationKey: string;
  queueOriginCatalog: {
    stage: (
      origin: QueueOrigin,
      key: string,
      snapshot: unknown,
      owner?: object,
    ) => void;
    read: <T>(
      key: string,
      owner?: object,
      returnOriginKey?: number,
    ) => T | undefined;
    update: (key: string, snapshot: unknown, owner?: object) => void;
    finishReturn: (originKey: number) => void;
  };
  queueOrigin: QueueOrigin | null;
  captureQueueOrigin: (
    label?: string,
    target?: QueueOriginTarget,
  ) => QueueOrigin;
  returnToQueueOrigin: () => void;
  startupHealth: PlatformHealthResult | null;
  ready: boolean;
  startup: {
    visible: boolean;
    label: string;
    progress: number;
  };
  tab: AppTab;
  page: AppPage;
  homeMenuOrigin: 'home' | 'player' | null;
  navigationDepth: number;
  setTab: (tab: AppTab) => void;
  homeRefreshToken: number;
  homeRefreshing: boolean;
  finishHomeRefresh: (token: number) => void;
  homeCatalogLaunchPage: number;
  refreshHome: () => void;
  pageRefreshToken: number;
  refreshPage: () => void;
  open: (page: AppPage) => void;
  back: () => void;
  state: PersistedState;
  recommendationPlatforms: PlatformSetting[];
  category: DiscoveryCategory;
  setCategory: (value: DiscoveryCategory) => void;
  feedPage: number;
  setFeedPage: (value: number) => void;
  feed: Track[];
  queue: Track[];
  queuePage: {
    loading: boolean;
    hasMore: boolean;
    error: string;
  };
  loadMoreQueue: () => Promise<void>;
  prefetchQueueAt: (
    index: number,
    options?: {
      gesture?: boolean;
    },
  ) => Promise<void>;
  removeQueueTrack: (trackId: string, keyHint?: string) => Promise<void>;
  current: Track | null;
  player: NativePlayerState;
  playerOverlayOpen: boolean;
  setPlayerOverlayOpen: (open: boolean) => void;
  setQueueListOpen: (open: boolean) => void;
  queueListOpen: boolean;
  queueReversed: boolean;
  queueOrderVersion: number;
  queueOrderChanging: boolean;
  reverseQueue: () => Promise<void>;
  busy: boolean;
  message: string;
  stateStorageError: string;
  notify: (message: string) => void;
  clearMessage: () => void;
  clearStateStorageError: () => void;
  playTrack: (
    track: Track,
    tracks?: Track[],
    index?: number,
    options?: PlayTrackOptions,
  ) => Promise<void>;
  playDefaultTrack: () => Promise<void>;
  prewarmHomeTracks: (tracks: Track[]) => void;
  prewarmContextKey: string;
  prewarmDetailTracks: (
    tracks: Track[],
    owner: object,
    onResult?: (result: { key: string; outcome: UrlPrewarmOutcome }) => void,
  ) => Promise<void>;
  releaseDetailPrewarm: (owner: object) => void;
  waitForQueuePrewarm: () => Promise<void>;
  trackBlacklistVersion: number;
  isTrackBlocked: (track: Track) => boolean;
  togglePlay: () => Promise<void>;
  setPlaybackPlaying: (playing: boolean) => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (value: number) => Promise<void>;
  changeQuality: (
    quality: PersistedState['settings']['quality'],
  ) => Promise<void>;
  applyEqualizer: (preset: EqualizerPreset) => Promise<void>;
  applyCustomEqualizer: (
    gains: number[],
    savedId?: string,
    options?: EffectApplyOptions,
  ) => Promise<boolean>;
  flushEqualizerUpdates: () => void;
  commitEqualizerEdit: (
    target: EffectEditTarget,
    gains: number[],
    advanced?: AdvancedEffects,
    part?: 'equalizer' | 'advanced',
  ) => Promise<boolean>;
  saveEqualizerDraft: (
    name: string,
    gains: number[],
    category: EqualizerPresetCategory,
    scope?: EffectScope,
    advanced?: AdvancedEffects,
  ) => Promise<boolean>;
  saveCustomEqualizer: (
    name: string,
    gains: number[],
    category?: EqualizerPresetCategory,
    scope?: EffectScope,
  ) => Promise<boolean>;
  deleteCustomEqualizer: (id: string) => Promise<boolean>;
  setPlaybackMode: (mode: PlaybackMode) => Promise<void>;
  toggleFavorite: (track: Track, favorite?: boolean) => void;
  dislikeTrack: (track: Track) => Promise<void>;
  isFavorite: (track: Track) => boolean;
  toggleCollectionFavorite: (item: CatalogItem) => void;
  isCollectionFavorite: (item: CatalogItem) => boolean;
  search: SearchState;
  runSearch: (
    query: string,
    provider?: 'all' | PlatformSetting['id'],
    page?: number,
    category?: SearchCategory,
    append?: boolean,
  ) => Promise<void>;
  clearSearchHistory: () => void;
  resetSearch: () => void;
  removeSearchHistory: (query: string) => void;
  clearHistory: (kind?: LibraryMediaKind) => void;
  clearCache: (parts?: CacheCleanupPart[]) => Promise<void>;
  chooseDownloadDirectory: () => Promise<void>;
  backupData: () => Promise<void>;
  restoreData: () => Promise<void>;
  importLocalMusic: () => Promise<void>;
  addLocalMusicDirectory: () => Promise<void>;
  scanLocalMusic: () => Promise<void>;
  refreshLocalMusicArtwork: () => Promise<void>;
  removeLocalTrack: (
    trackId: string,
    removeFromPlaylists: boolean,
    deleteFile?: boolean,
    kind?: LibraryMediaKind,
  ) => Promise<void>;
  removeDownload: (
    trackId: string,
    deleteFile: boolean,
    kind?: LibraryMediaKind,
  ) => Promise<void>;
  downloadTrack: (
    track: Track,
    options?: {
      useLaunchBinding?: boolean;
      usePlaybackUrl?: boolean;
      resolved?: DownloadPreview;
    },
  ) => Promise<void>;
  downloadsFor: (kind: LibraryMediaKind) => ReturnType<typeof mediaDownloads>;
  downloadActivities: DownloadActivity[];
  downloadDestination: {
    kind: LibraryMediaKind;
    version: number;
  } | null;
  consumeDownloadDestination: (version: number) => void;
  prepareDownloadPreview: (
    track: Track,
    signal: AbortSignal,
    options?: {
      useLaunchBinding?: boolean;
      usePlaybackUrl?: boolean;
    },
  ) => Promise<DownloadPreview>;
  beginUserDownloads: (
    tracks: Track[],
    options?: {
      onDownload?: (track: Track, resolved?: DownloadPreview) => Promise<void>;
      preferredQuality?: AppSettings['quality'];
      usePlaybackUrl?: boolean;
      resolved?: Record<string, DownloadPreview>;
    },
  ) => void;
  refreshDownloadFileSizes: (
    entries: ReturnType<typeof mediaDownloads>,
  ) => Promise<void>;
  addTrackToPlaylist: (track: Track, playlistId?: string) => void;
  removeTrackFromPlaylist: (track: Track, playlistId: string) => void;
  createPlaylist: (title?: string) => void;
  importPlaylist: (
    preview: PlaylistImportPreview,
    options?: PlaylistImportOptions,
  ) => Promise<void>;
  isPlaylistSaved: (preview: PlaylistImportPreview) => boolean;
  openPersonalPlaylist: (id: string) => void;
  openLinkedPlaylist: (item: CatalogItem) => void;
  playlistImportRequest: {
    id: number;
    input: string;
    autoRead: boolean;
    clipboard?: PlaylistClipboardSource;
  } | null;
  openPlaylistImport: (
    input?: string,
    autoRead?: boolean,
    clipboard?: PlaylistClipboardSource,
  ) => void;
  closePlaylistImport: () => void;
  cancelPlaylistImport: () => void;
  renamePlaylist: (id: string, title: string) => void;
  renameImportedPlaylist: (item: CatalogItem, title: string) => void;
  deleteImportedPlaylist: (item: CatalogItem) => void;
  deletePlaylist: (id: string) => void;
  setSetting: <K extends keyof PersistedState['settings']>(
    key: K,
    value: PersistedState['settings'][K],
  ) => void;
  togglePlatform: (id: PlatformSetting['id']) => void;
  toggleSource: (id: string) => void;
  reorderSources: (ids: string[]) => void;
  removeSources: (ids: string[]) => Promise<void>;
  importSource: () => Promise<boolean>;
  testSource: (id: string) => Promise<string>;
  setSleepTimer: (mode: 'minutes' | 'track', minutes?: number) => Promise<void>;
  cancelSleepTimer: () => Promise<void>;
}
const Context = createContext<Controller | null>(null);
export const EXIT_HINT_MESSAGE = '再按一次回到桌面';
const EXIT_CONFIRM_WINDOW_MS = 2000;
// Only coalesce same-frame/re-entrant back events.  A longer debounce would
// swallow a legitimate back immediately after the animated Home menu closes.
const NAVIGATION_GUARD_MS = 32;
const PLAYER_FAILURE_FALLBACK_LIMIT = 6;
// Background final-URL audio validation is deliberately one song at a time.
// Playback actions can pause the queue without competing with a group of
// background source requests.
const URL_PREWARM_CONCURRENCY = 2;
const STARTUP_READY_HOLD_MS = 350;
const STARTUP_CROSSFADE_SETTLE_MS = 440;
const STARTUP_FIRST_RESOLVE_BUDGET_MS = 30000;
const STARTUP_FIRST_RESOLVE_ATTEMPT_MS = 5000;
const initialPlayer: NativePlayerState = {
  playing: false,
  index: 0,
  position: 0,
  duration: 0,
  volume: 0.72,
  sleepMode: 'off',
};
const platformSourceKeys: Record<PlatformSetting['id'], string> = {
  netease: 'wy',
  qq: 'tx',
  kugou: 'kg',
  kuwo: 'kw',
  migu: 'mg',
  qishui: 'qs',
};
const rememberTrack = (tracks: Track[], track: Track) => [
  track,
  ...tracks.filter(item => trackQueueKey(item) !== trackQueueKey(track)),
];
export function AppProvider({ children }: { children: React.ReactNode }) {
  const catalogViewState = useRef(new Map<string, unknown>()).current;
  const [catalogRestore, setCatalogRestore] = useState<{
    version: number;
    keys: string[];
    originKey?: number;
  }>({ version: 0, keys: [] });
  const [queueOrigin, setQueueOrigin] = useState<QueueOrigin | null>(null);
  const queueOriginRef = useRef<QueueOrigin | null>(null);
  const originCatalogSequence = useRef(0);
  const originCatalogState = useRef<{
    active: {
      origin: QueueOrigin;
      states: Map<
        string,
        {
          metadata: unknown;
          owner?: object;
        }
      >;
    } | null;
    candidate: {
      origin: QueueOrigin;
      states: Map<
        string,
        {
          metadata: unknown;
          owner?: object;
        }
      >;
    } | null;
    returning: {
      origin: QueueOrigin;
      states: Map<
        string,
        {
          metadata: unknown;
          owner?: object;
        }
      >;
    } | null;
  }>({ active: null, candidate: null, returning: null });
  const queueOriginCatalog = useMemo<Controller['queueOriginCatalog']>(
    () => ({
      stage: (origin, key, snapshot, owner) => {
        const cache = originCatalogState.current;
        const retained = {
          metadata: copyOriginCatalogMetadata(snapshot),
          owner,
        };
        if (cache.active?.origin.catalogKey === origin.catalogKey) {
          cache.active.states.set(key, retained);
          return;
        }
        if (cache.candidate?.origin.catalogKey !== origin.catalogKey) {
          if (
            cache.candidate?.origin.catalogKey ===
            queueOriginRef.current?.catalogKey
          )
            cache.active = cache.candidate;
          cache.candidate = { origin, states: new Map() };
        }
        cache.candidate.states.set(key, retained);
      },
      read: <T,>(key: string, owner?: object, returnOriginKey?: number) => {
        const cache = originCatalogState.current;
        const requestedOriginKey =
          returnOriginKey ?? queueOriginRef.current?.catalogKey;
        const entry =
          returnOriginKey !== undefined &&
          cache.returning?.origin.catalogKey === returnOriginKey
            ? cache.returning
            : cache.candidate?.origin.catalogKey === requestedOriginKey
            ? cache.candidate
            : cache.active?.origin.catalogKey === requestedOriginKey
            ? cache.active
            : null;
        const retained = entry?.states.get(key);
        if (retained && owner) retained.owner = owner;
        return retained?.metadata as T | undefined;
      },
      update: (key, snapshot, owner) => {
        for (const entry of [
          originCatalogState.current.active,
          originCatalogState.current.candidate,
        ]) {
          const retained = entry?.states.get(key);
          if (retained && retained.owner === owner)
            retained.metadata = copyOriginCatalogMetadata(snapshot);
        }
      },
      finishReturn: originKey => {
        if (
          originCatalogState.current.returning?.origin.catalogKey === originKey
        )
          originCatalogState.current.returning = null;
      },
    }),
    [],
  );
  const pendingFeedRestore = useRef<{
    category: DiscoveryCategory;
    page: number;
    tracks: Track[];
    config: string;
  } | null>(null);
  const searchGeneration = useRef(0);
  const [playlistImportRequest, setPlaylistImportRequest] =
    useState<Controller['playlistImportRequest']>(null);
  const playlistImportRequestRef = useRef(playlistImportRequest);
  const playlistImportSequence = useRef(0);
  const importedPlaylistDestination = useRef<
    | PlaylistReference
    | {
        personalPlaylistId: string;
      }
    | null
  >(null);
  const playlistImportInFlight = useRef(false);
  const openPlaylistImport = useCallback(
    (input = '', autoRead = false, clipboard?: PlaylistClipboardSource) => {
      const request = {
        id: ++playlistImportSequence.current,
        input,
        autoRead,
        clipboard,
      };
      playlistImportRequestRef.current = request;
      setPlaylistImportRequest(request);
    },
    [],
  );
  const closePlaylistImport = useCallback(() => {
    playlistImportRequestRef.current = null;
    setPlaylistImportRequest(null);
  }, []);
  const [ready, setReady] = useState(false),
    [startup, setStartup] = useState({
      visible: true,
      label: '正在加载音乐库',
      progress: 0.12,
    }),
    [tab, setTabState] = useState<AppTab>('discovery'),
    [homeRefreshToken, setHomeRefreshToken] = useState(0),
    [homeRefreshing, setHomeRefreshing] = useState(false),
    [pageRefreshToken, setPageRefreshToken] = useState(0),
    [page, setPage] = useState<AppPage>('root'),
    [homeMenuOrigin, setHomeMenuOrigin] = useState<'home' | 'player' | null>(
      null,
    ),
    [stack, setStack] = useState<AppPage[]>([]),
    [state, setState] = useState<PersistedState | null>(null),
    [healthyProviderIds, setHealthyProviderIds] = useState<
      PlatformSetting['id'][] | null
    >(null),
    [startupHealth, setStartupHealth] = useState<PlatformHealthResult | null>(
      null,
    ),
    [sourceHealthRevision, setSourceHealthRevision] = useState(0),
    [category, setCategory] = useState<DiscoveryCategory>('综合'),
    [feedPage, setFeedPage] = useState(1),
    [feed, setFeed] = useState<Track[]>([]),
    [queue, setQueue] = useState<Track[]>([]),
    [queuePage, setQueuePage] = useState({
      loading: false,
      hasMore: false,
      error: '',
    }),
    [player, setPlayer] = useState<NativePlayerState>(initialPlayer),
    [playerPreparationReadyKey, setPlayerPreparationReadyKey] = useState(''),
    [playerOverlayOpen, setPlayerOverlayOpen] = useState(false),
    [queueListOpen, setQueueListOpenState] = useState(false),
    [queueReversed, setQueueReversed] = useState(false),
    [queueOrderVersion, setQueueOrderVersion] = useState(0),
    [queueOrderChanging, setQueueOrderChanging] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [stateStorageStatus, setStateStorageStatus] = useState(
      () => getStateStorageStatus?.() ?? { readError: null, writeError: null },
    ),
    [stateStorageErrorDismissed, setStateStorageErrorDismissed] =
      useState(false),
    [trackBlacklistVersion, setTrackBlacklistVersion] = useState(0),
    [search, setSearch] = useState<SearchState>({
      query: '',
      category: 'song',
      provider: 'all',
      page: 1,
      hasNext: false,
      loading: false,
      tracks: [],
      errors: [],
      playlists: [],
    });
  const queueReversedRef = useRef(false);
  const clearSystemPlaylistClipboard = useCallback(async () => {
    const bridge = NativeModules.LiuliuMediaLibrary;
    if (!bridge?.clearPlaylistClipboard)
      throw new Error('Clipboard bridge unavailable');
    await bridge.clearPlaylistClipboard();
  }, []);
  const cancelPlaylistImport = useCallback(() => {
    if (!playlistImportRequestRef.current || playlistImportInFlight.current)
      return;
    closePlaylistImport();
    clearSystemPlaylistClipboard().catch(() =>
      setMessage('系统剪贴板未清空，请重试'),
    );
  }, [clearSystemPlaylistClipboard, closePlaylistImport]);
  const homeRefreshFlight = useRef<number | null>(null);
  const homeRefreshGeneration = useRef(0);
  const queueReverseRequest = useRef<Promise<void> | null>(null);
  const queueRef = useRef<Track[]>([]),
    navigationStackRef = useRef<AppPage[]>([]),
    pageRef = useRef<AppPage>('root'),
    homeMenuOriginRef = useRef<'home' | 'player' | null>(null),
    logicalQueueRef = useRef<Track[]>([]),
    queuePublishedRef = useRef<Track[] | null>(null),
    persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    exitArmedUntilRef = useRef(0),
    exitHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    navigationGuardUntilRef = useRef(0),
    queuePaging = useRef<{
      source: QueueSource;
      loading: boolean;
      desiredTotal?: number;
      publishedCount?: number;
      satisfiedAheadTotal?: number;
      error?: string;
      prefetchErrorKey?: string;
      aheadRequest?: Promise<void>;
      menuFirstBatchPlayed?: boolean;
    } | null>(null),
    queuePageRequest = useRef<Promise<void> | null>(null),
    queuePageAbort = useRef<AbortController | null>(null),
    queuePageReadyRequest = useRef<Promise<void> | null>(null),
    queueReadyRequest = useRef<Promise<void> | null>(null),
    queueProgressWaiters = useRef(new Set<() => void>()),
    catalogPlaybackGate = useRef<{
      generation: number;
      ready: boolean;
      key: string;
      preparedAccepted?: boolean;
    } | null>(null),
    playerQueuePreparation = useRef(new PlayerQueuePreparation()),
    preparedNeighbourContexts = useRef(new Map<string, string>()),
    playerPreparationCommit = useRef<Promise<void>>(Promise.resolve()),
    pendingTrackPreparations = useRef(
      new Map<
        string,
        Promise<
          Track & {
            playUrl: string;
          }
        >
      >(),
    ),
    queueGeneration = useRef(0),
    musicEntityRecorder = useRef(new MusicEntityHistoryRecorder()),
    musicEntityPlaylists = useRef<Playlist[]>([]),
    navigationVersion = useRef(0),
    navigationCursor = useRef(0),
    navigationPending = useRef(false),
    qualityRequestVersion = useRef(0),
    playbackFlight = useRef<Promise<void> | null>(null),
    playerRequestAbort = useRef<AbortController | null>(null),
    selectedPreparationGeneration = useRef<number | null>(null),
    onDemandPlayerQueue = useRef(false),
    queuePreparationVersion = useRef(0),
    handledPlayerEnd = useRef(''),
    advanceEndedPlayer = useRef<(index: number) => void>(() => undefined),
    actualPlayingKey = useRef(''),
    prefetchQueueRuntime = useRef<(index: number) => Promise<void>>(
      async () => undefined,
    ),
    supersededSceneKey = useRef(''),
    scenePlayback = useRef<{
      generation: number;
      key: string;
      started: boolean;
      paused: boolean;
      handled: boolean;
    } | null>(null),
    startMenuInitialCompletion = useRef<() => void>(() => undefined),
    advanceFailedScene = useRef<(index: number, error: string) => void>(
      () => undefined,
    ),
    expiredUrlRequest = useRef<{
      token: string;
      abort: AbortController;
    } | null>(null),
    handledExpiredUrls = useRef(new Set<string>()),
    recoverExpiredUrl = useRef<(value: NativePlayerState) => void>(
      () => undefined,
    ),
    pendingDisplay = useRef<{
      key: string;
      index: number;
    } | null>(null),
    queueListOpenRef = useRef(false),
    qualityPreferenceRef =
      useRef<PersistedState['settings']['quality']>('320k'),
    qualityRevision = useRef(0),
    startupHandled = useRef(false),
    startupAutoplayCancelled = useRef(false),
    messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    sourceSelectionGeneration = useRef(0),
    verifiedSourceIdsByProvider = useRef<Partial<
      Record<PlatformSetting['id'], string[]>
    > | null>(null),
    verifiedBackendByProvider = useRef<Partial<
      Record<PlatformSetting['id'], string>
    > | null>(null),
    feedRequest = useRef(0),
    feedLoadRef = useRef<Promise<Track[]> | null>(null),
    feedCatalogOwner = useRef({ config: '' }),
    homePrewarmDeferred = useRef(new Map<string, Track>()),
    startFeedRef = useRef<Controller['playTrack']>(async () => undefined);
  const [wifiConnected, setWifiConnected] = useState(false);
  const [downloadActivities, setDownloadActivities] = useState<
    DownloadActivity[]
  >([]);
  const downloadRecordStateRef = useRef(state);
  downloadRecordStateRef.current = state;
  const downloadActivityRef = useRef(new Map<string, DownloadActivity>());
  const [downloadDestination, setDownloadDestination] = useState<{
    kind: LibraryMediaKind;
    version: number;
  } | null>(null);
  const downloadNavigationVersion = useRef(0);
  const consumeDownloadDestination = useCallback(
    (version: number) =>
      setDownloadDestination(value =>
        value?.version === version ? null : value,
      ),
    [],
  );
  const publishDownloadActivity = useCallback((activity: DownloadActivity) => {
    downloadActivityRef.current.set(downloadTrackKey(activity.track), activity);
    setDownloadActivities([...downloadActivityRef.current.values()]);
  }, []);
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      'downloadProgress',
      event => {
        const task = [...downloadActivityRef.current.values()].find(
          item => item.id === event.requestId,
        );
        if (!task || task.phase === 'failed' || task.phase === 'downloaded')
          return;
        publishDownloadActivity({
          ...task,
          phase: 'downloading',
          bytesDownloaded: event.bytesDownloaded,
          totalBytes: positiveBytes(event.totalBytes),
          fileSize: positiveBytes(event.fileSize),
        });
      },
    );
    return () => subscription.remove();
  }, [publishDownloadActivity]);
  qualityPreferenceRef.current = state
    ? playbackNetworkQuality(state.settings, wifiConnected)
    : '320k';
  useEffect(() => subscribeWifiNetwork(setWifiConnected), []);
  musicEntityPlaylists.current = state?.playlists ?? [];
  const setQueueListOpen = useCallback((open: boolean) => {
    if (queueListOpenRef.current === open) return;
    queueListOpenRef.current = open;
    // Showing the list does not change the logical queue or its prepared window.
    if (queueRef.current.length === 1) onDemandPlayerQueue.current = true;
    setQueueListOpenState(open);
  }, []);
  const signalQueueProgress = useCallback(() => {
    const waiters = [...queueProgressWaiters.current];
    queueProgressWaiters.current.clear();
    waiters.forEach(resolve => resolve());
  }, []);
  useEffect(
    () => () => {
      queuePaging.current = null;
      queuePageAbort.current?.abort();
      queuePageAbort.current = null;
    },
    [],
  );
  const waitForQueueProgress = useCallback(
    () =>
      new Promise<void>(resolve => {
        queueProgressWaiters.current.add(resolve);
      }),
    [],
  );
  const urlPrewarmScheduler = useRef<UrlPrewarmScheduler | null>(null);
  if (!urlPrewarmScheduler.current)
    urlPrewarmScheduler.current = new UrlPrewarmScheduler(
      URL_PREWARM_CONCURRENCY,
      2,
    );
  const recommendationPlatforms = useMemo(
    () =>
      state?.platforms.filter(
        platform =>
          platform.enabled && healthyProviderIds?.includes(platform.id),
      ) ?? [],
    [healthyProviderIds, state?.platforms],
  );
  const enabledPlatforms =
    healthyProviderIds === null ? null : recommendationPlatforms;
  const catalogConfigurationKey = `${
    sourceSelectionGeneration.current
  }:${pageRefreshToken}:${recommendationPlatforms
    .map(platform => platform.id)
    .join('|')}`;
  const dislikedTrackIds = state?.disliked;
  const feedConfigurationKey = `${catalogConfigurationKey}:${
    dislikedTrackIds?.join('|') ?? ''
  }`;
  // Stamp loaded rows without making configuration changes new Feed triggers.
  const feedConfigurationRef = useRef(feedConfigurationKey);
  feedConfigurationRef.current = feedConfigurationKey;
  const autoNext = state?.settings.autoNext;
  const repeatMode = state?.settings.repeat;
  const partialQueueRepeatMode = useRef<'off' | 'one'>('off');
  partialQueueRepeatMode.current = repeatMode === 'one' ? 'one' : 'off';
  const shuffle = state?.settings.shuffle;
  const playbackSettings = useRef(state?.settings);
  playbackSettings.current = state?.settings;
  const normalizeVolume = state?.settings.normalizeVolume;
  const interruptPlayback = state?.settings.interruptPlayback;
  const equalizer = state?.settings.equalizer;
  const customEqualizerGains = state?.settings.customEqualizerGains;
  const customEqualizerAdvanced = state?.settings.customEqualizerAdvanced;
  const headphoneCalibration = state?.settings.headphoneCalibration;
  const equalizerState = useRef(state);
  const equalizerUpdates = useMemo(() => new EqualizerUpdates(), []);
  const appliedEqualizerKey = useRef<string | null>(null);
  useEffect(() => () => equalizerUpdates.dispose(), [equalizerUpdates]);
  equalizerState.current = state;
  useEffect(() => subscribeStateStorageStatus?.(setStateStorageStatus), []);
  useEffect(() => {
    setStateStorageErrorDismissed(false);
  }, [
    stateStorageStatus.readError?.code,
    stateStorageStatus.readError?.rawLength,
    stateStorageStatus.writeError?.code,
    stateStorageStatus.writeError?.rawLength,
  ]);
  useEffect(() => {
    loadState().then(async persisted => {
      const settings = restoreLaunchEffects(persisted.settings);
      const value = { ...persisted, settings };
      const gains =
        settings.equalizer === 'Custom'
          ? settings.customEqualizerGains
          : undefined;
      const configuration = AudioEffectStateManager.configuration(
        settings.customEqualizerAdvanced,
      );
      // Replace the native saved mirror before startup can prepare/play audio.
      // Failed updates remain eligible for the existing settings-sync retry.
      await equalizerUpdates.request(async () => {
        await nativePlayer.setEqualizer(
          settings.equalizer,
          gains,
          configuration,
        );
        appliedEqualizerKey.current = JSON.stringify([
          settings.equalizer,
          gains,
          configuration,
        ]);
        return true;
      });
      setWifiConnected(await readWifiNetwork());
      // Advance the Home catalog cursor exactly once per process launch. The
      // persisted cursor is consumed by both the horizontal recommendation
      // rail and the deferred vertical playlist list; re-renders and route
      // changes must not advance it again.
      setState({
        ...value,
        homeCatalogLaunchPage: value.homeCatalogLaunchPage + 1,
      });
      setReady(true);
    });
  }, [equalizerUpdates]);
  useEffect(() => {
    if (!state || !ready) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(
      () => saveState(state).catch(() => undefined),
      180,
    );
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [state, ready]);
  useEffect(() => {
    if (
      queuePublishedRef.current &&
      queue.length >= queuePublishedRef.current.length
    )
      queuePublishedRef.current = null;
    const published = logicalQueueRef.current;
    const isOlderStatePublication =
      published.length > queue.length &&
      queue.every(
        (track, index) =>
          trackQueueKey(track) === trackQueueKey(published[index]!),
      );
    if (!isOlderStatePublication) logicalQueueRef.current = queue;
  }, [queue]);
  const detailNavigationLog = useRef(page);
  useEffect(() => {
    const previous = detailNavigationLog.current;
    detailNavigationLog.current = page;
    if (
      previous !== page &&
      [previous, page].some(value =>
        (
          [
            'playlist-detail',
            'search-playlist',
            'catalog-list',
            'player',
          ] as AppPage[]
        ).includes(value),
      )
    )
      console.info('[detail-navigation]', JSON.stringify({ previous, page }));
    pageRef.current = page;
    if (page === 'player' || page === 'queue') {
      if (queuePaging.current && !queuePageRequest.current)
        queuePaging.current.loading = false;
      if (queueRef.current.length === 1) {
        onDemandPlayerQueue.current = true;
      }
    }
  }, [page]);
  useEffect(() => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    if (!message || message === EXIT_HINT_MESSAGE || message.startsWith('正在'))
      return undefined;
    const isFailure = /失败|不可用|错误|未配置|没有通过|暂时不可用/.test(
      message,
    );
    messageTimerRef.current = setTimeout(
      () => setMessage(current => (current === message ? '' : current)),
      isFailure ? 2500 : 1000,
    );
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, [message]);
  useEffect(
    () => () => {
      if (exitHintTimerRef.current) clearTimeout(exitHintTimerRef.current);
      playerRequestAbort.current?.abort();
    },
    [],
  );
  const patchState = useCallback(
    (update: (value: PersistedState) => PersistedState) =>
      setState(value =>
        value ? retainRecentMusicState(update(value)) : value,
      ),
    [],
  );
  const rememberTrackPlayback = useCallback(
    (track: Track) =>
      patchState(value => {
        const kind = trackMediaKind(track);
        return {
          ...value,
          history: rememberMusicHistory(value.history, track),
          profile: {
            ...value.profile,
            memoryStatistics: accumulateMusicStatistics(
              memoryStatisticsFor(value.profile, value.history),
              track,
            ),
          },
          savedTracks: rememberTrack(value.savedTracks, track),
        };
      }),
    [patchState],
  );
  const rememberHomeMenuBatch = useCallback(
    (cursor: HomeMenuCursor, tracks: Track[]) => {
      patchState(value => ({
        ...value,
        menuRecommendationProgress: mergeMenuProgress(
          value.menuRecommendationProgress,
          cursor,
          tracks,
        ),
      }));
    },
    [patchState],
  );
  const lastHistoryPlayback = useRef('');
  useEffect(() => {
    const publishNativeState = (
      value: NativePlayerState,
      forceProgress = false,
    ) => {
      const nativeTrack = queueRef.current[value.index];
      const nativeKey =
        value.mediaId ?? (nativeTrack ? trackQueueKey(nativeTrack) : '');
      const logicalIndex = nativeKey
        ? logicalQueueRef.current.findIndex(
            track => trackQueueKey(track) === nativeKey,
          )
        : -1;
      if (
        value.error &&
        nativeKey === supersededSceneKey.current &&
        actualPlayingKey.current !== nativeKey
      )
        return;
      const recovery = value.urlRecovery;
      const recovering =
        recovery?.mediaId === nativeKey && recovery.status !== 'failed';
      const displayedValue =
        recovering && recovery.resume ? { ...value, playing: true } : value;
      setPlayer(
        logicalIndex >= 0 && logicalIndex !== value.index
          ? { ...displayedValue, index: logicalIndex, mediaId: nativeKey }
          : displayedValue,
      );
      if (value.playing) {
        handledPlayerEnd.current = '';
        actualPlayingKey.current = nativeKey;
        setPlayerPreparationReadyKey(nativeKey);
        const gate = catalogPlaybackGate.current;
        if (
          gate?.preparedAccepted &&
          gate.generation === queueGeneration.current &&
          gate.key === nativeKey
        ) {
          gate.ready = true;
          urlPrewarmScheduler.current!.setPlaybackReady(true);
        }
        const menuInitialBatch =
          queuePaging.current?.source.kind === 'home-menu' &&
          Boolean(queuePaging.current.source.initialMenuBatch);
        if (
          logicalIndex >= 0 &&
          !navigationPending.current &&
          !menuInitialBatch
        )
          void prefetchQueueRuntime
            .current(logicalIndex)
            .catch(() => undefined);
        const scene = scenePlayback.current;
        if (
          scene?.generation === queueGeneration.current &&
          scene.key === nativeKey
        ) {
          scene.started = true;
        }
        startMenuInitialCompletion.current();
      }
      // A manual target is shown as soon as the old provider has stopped.
      // Media3 may still publish the old item while the new URL is resolving;
      // do not let that stale native snapshot put the old metadata back on
      // the player page.
      const pending = pendingDisplay.current;
      if (pending && nativeKey !== pending.key) {
        const pendingIndex = logicalQueueRef.current.findIndex(
          track => trackQueueKey(track) === pending.key,
        );
        if (pendingIndex >= 0) {
          const pendingTrack = logicalQueueRef.current[pendingIndex]!;
          setPlayer(current => ({
            ...current,
            index: pendingIndex,
            mediaId: pending.key,
            playing: false,
            position: 0,
            duration: pendingTrack.duration,
            error: null,
          }));
          return;
        }
      }
      if (pending && nativeKey === pending.key) pendingDisplay.current = null;
      if (value.playing && !recovering && !navigationPending.current) {
        const playedTrack = queueRef.current.find(
          track => trackQueueKey(track) === nativeKey,
        );
        if (playedTrack && logicalIndex >= 0) {
          const historyToken = `${queueGeneration.current}:${trackMediaKind(
            playedTrack,
          )}:${nativeKey}`;
          if (lastHistoryPlayback.current !== historyToken) {
            lastHistoryPlayback.current = historyToken;
            rememberTrackPlayback(playedTrack);
          }
          const entries = musicEntityRecorder.current.confirm(
            queueGeneration.current,
            nativeKey,
            playedTrack,
            musicEntityPlaylists.current,
          );
          if (entries.length)
            patchState(current => ({
              ...current,
              musicEntityHistory: mergeMusicEntityHistory(
                current.musicEntityHistory ?? [],
                entries,
              ),
            }));
        }
      }
      if (recovering) {
        if (recovery.status === 'pending' && recovery.resume)
          recoverExpiredUrl.current(value);
        return;
      }
      const scene = scenePlayback.current;
      if (
        value.error &&
        !value.playing &&
        scene?.started &&
        !scene.paused &&
        !scene.handled &&
        scene.generation === queueGeneration.current &&
        scene.key === nativeKey &&
        !navigationPending.current &&
        !playerRequestAbort.current &&
        logicalIndex >= 0 &&
        // Prepared neighbours already use Media3's existing bounded fallback.
        // JS bridges only the unresolved logical tail Media3 cannot see.
        value.index >= queueRef.current.length - 1 &&
        isMenuSceneQueue(queuePaging.current?.source)
      ) {
        scene.handled = true;
        advanceFailedScene.current(logicalIndex, value.error);
      }
      if (
        onDemandPlayerQueue.current &&
        value.ended &&
        !value.error &&
        value.sleepMode !== 'track' &&
        !navigationPending.current &&
        nativeTrack &&
        nativeKey === trackQueueKey(nativeTrack)
      ) {
        const endedKey = `${nativeKey}:${queueGeneration.current}`;
        if (handledPlayerEnd.current !== endedKey) {
          handledPlayerEnd.current = endedKey;
          advanceEndedPlayer.current(
            logicalIndex >= 0 ? logicalIndex : value.index,
          );
        }
      }
    };
    const unsubscribe = nativePlayer.subscribe(publishNativeState);
    const appStateSubscription = AppState.addEventListener('change', next => {
      if (next === 'active') return;
      nativePlayer
        .getState()
        .then(value => {
          publishNativeState(value, true);
        })
        .catch(() => undefined);
    });
    const timer = setInterval(
      () =>
        nativePlayer
          .getState()
          .then(publishNativeState)
          .catch(() => undefined),
      800,
    );
    return () => {
      unsubscribe();
      appStateSubscription.remove();
      clearInterval(timer);
      expiredUrlRequest.current?.abort.abort();
    };
  }, [patchState, rememberTrackPlayback]);
  useEffect(() => {
    if (!enabledPlatforms || !dislikedTrackIds) return;
    const revision = ++feedRequest.current;
    const config = feedConfigurationRef.current;
    const restored = pendingFeedRestore.current;
    pendingFeedRestore.current = null;
    if (
      restored?.category === category &&
      restored.page === feedPage &&
      restored.config === config
    ) {
      feedLoadRef.current = null;
      return;
    }
    const requestOwner = { config };
    const request = loadCategoryFeed(category, feedPage, enabledPlatforms);
    feedLoadRef.current = request;
    request
      .then(tracks => {
        if (revision === feedRequest.current) {
          const visible = tracks.filter(
            track => !dislikedTrackIds.includes(track.id),
          );
          feedCatalogOwner.current = requestOwner;
          setFeed(visible);
          queueOriginCatalog.update(
            `feed:${category}:${feedPage}`,
            {
              category,
              page: feedPage,
              tracks: visible.map(({ playUrl: _url, ...track }) => track),
              config,
            },
            requestOwner,
          );
        }
      })
      .catch(error => {
        if (revision === feedRequest.current) {
          setFeed([]);
          setMessage(
            error instanceof Error ? error.message : '发现内容加载失败',
          );
        }
      })
      .finally(() => {
        if (feedLoadRef.current === request) feedLoadRef.current = null;
      });
  }, [
    category,
    dislikedTrackIds,
    enabledPlatforms,
    feedPage,
    queueOriginCatalog,
  ]);
  const currentByMediaId = player.mediaId
    ? queue.find(track => trackQueueKey(track) === player.mediaId) ??
      logicalQueueRef.current.find(
        track => trackQueueKey(track) === player.mediaId,
      )
    : null;
  const current =
    currentByMediaId ??
    queue[player.index] ??
    logicalQueueRef.current[player.index] ??
    queue[0] ??
    logicalQueueRef.current[0] ??
    null;
  useEffect(() => {
    if (!state || !allDownloads(state).some(item => item.status === 'queued'))
      return;
    let polling = false;
    let cancelled = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const queued = allDownloads(state).filter(
          item => item.status === 'queued',
        );
        const results = await Promise.all(
          queued.map(async entry => {
            try {
              return [entry.id, await queryDownloadStatus(entry.id)] as const;
            } catch {
              return [entry.id, null] as const;
            }
          }),
        );
        const updates = new Map(results.filter(([, value]) => value));
        if (cancelled) return;
        for (const entry of queued) {
          const update = updates.get(entry.id);
          if (!update) continue;
          const latest = downloadRecordStateRef.current;
          if (
            !latest ||
            !mediaDownloads(latest, trackMediaKind(entry.track)).some(
              item =>
                item.id === entry.id &&
                downloadTrackKey(item.track) === downloadTrackKey(entry.track),
            )
          )
            continue;
          const existing = downloadActivityRef.current.get(
            downloadTrackKey(entry.track),
          );
          if (existing?.token && existing.token !== entry.id) continue;
          publishDownloadActivity({
            ...(existing ?? {
              id: entry.id,
              track: entry.track,
              createdAt: entry.createdAt,
            }),
            token: entry.id,
            phase:
              update.status === 'queued'
                ? update.bytesDownloaded
                  ? 'downloading'
                  : 'queued'
                : update.status,
            bytesDownloaded: update.bytesDownloaded,
            totalBytes: positiveBytes(update.totalBytes),
            fileSize: positiveBytes(update.fileSize),
            reason: update.reason,
            quality: existing?.quality ?? entry.quality,
          });
        }
        if ([...updates.values()].some(value => value?.status !== 'queued'))
          patchState(value => {
            const updateEntries = (entries: typeof value.downloads) =>
              entries.map(entry => {
                const update = updates.get(entry.id);
                if (!update || update.status === 'queued') return entry;
                return {
                  ...entry,
                  status: update.status,
                  fileSize: positiveBytes(update.fileSize) ?? entry.fileSize,
                  track: update.localUri
                    ? { ...entry.track, playUrl: update.localUri }
                    : entry.track,
                };
              });
            return {
              ...value,
              ...syncDownloadedMusic(
                value.localTracks,
                updateEntries(value.downloads),
              ),
            };
          });
      } finally {
        polling = false;
      }
    };
    refresh().catch(() => undefined);
    const timer = setInterval(refresh, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [patchState, publishDownloadActivity, state?.downloads]);
  const disarmExitHint = useCallback(() => {
    exitArmedUntilRef.current = 0;
    if (exitHintTimerRef.current) clearTimeout(exitHintTimerRef.current);
    exitHintTimerRef.current = null;
    setMessage(current => (current === EXIT_HINT_MESSAGE ? '' : current));
  }, []);
  const invalidateOriginReturn = useCallback(() => {
    originCatalogState.current.returning = null;
    pendingFeedRestore.current = null;
    setCatalogRestore(value =>
      value.originKey === undefined
        ? value
        : { version: value.version, keys: [], originKey: undefined },
    );
  }, []);
  const open = useCallback(
    (next: AppPage) => {
      invalidateOriginReturn();
      disarmExitHint();
      // Read the authoritative ref instead of the render-time page closure.
      // Rapid taps can otherwise push the same stale page several times before
      // React commits the preceding navigation update.
      const current = pageRef.current;
      if (current === next) return;
      const nextMenuOrigin =
        next === 'home-menu'
          ? (['player', 'lyrics', 'effects', 'queue'] as AppPage[]).includes(
              current,
            )
            ? 'player'
            : 'home'
          : null;
      homeMenuOriginRef.current = nextMenuOrigin;
      setHomeMenuOrigin(nextMenuOrigin);
      const nextStack = [...navigationStackRef.current, current];
      navigationStackRef.current = nextStack;
      setStack(nextStack);
      pageRef.current = next;
      setPage(next);
    },
    [disarmExitHint, invalidateOriginReturn],
  );
  const back = useCallback(() => {
    invalidateOriginReturn();
    const now = Date.now();
    if (
      navigationGuardUntilRef.current > now &&
      !(pageRef.current === 'root' && exitArmedUntilRef.current > now)
    )
      return;
    navigationGuardUntilRef.current = now + NAVIGATION_GUARD_MS;
    const currentStack = navigationStackRef.current;
    if (!currentStack.length) {
      if (pageRef.current !== 'root') {
        disarmExitHint();
        homeMenuOriginRef.current = null;
        setHomeMenuOrigin(null);
        pageRef.current = 'root';
        setPage('root');
        return;
      }
      if (exitArmedUntilRef.current > now) {
        disarmExitHint();
        void nativePlayer.stop().finally(() => BackHandler.exitApp());
        return;
      }
      exitArmedUntilRef.current = now + EXIT_CONFIRM_WINDOW_MS;
      setMessage(EXIT_HINT_MESSAGE);
      if (exitHintTimerRef.current) clearTimeout(exitHintTimerRef.current);
      exitHintTimerRef.current = setTimeout(() => {
        exitArmedUntilRef.current = 0;
        exitHintTimerRef.current = null;
        setMessage(current => (current === EXIT_HINT_MESSAGE ? '' : current));
      }, EXIT_CONFIRM_WINDOW_MS);
      return;
    }
    disarmExitHint();
    homeMenuOriginRef.current = null;
    setHomeMenuOrigin(null);
    const next = currentStack.slice(0, -1),
      previous = currentStack[currentStack.length - 1] ?? 'root';
    navigationStackRef.current = next;
    setStack(next);
    pageRef.current = previous;
    setPage(previous);
  }, [disarmExitHint, invalidateOriginReturn]);
  const setTab = useCallback(
    (next: AppTab) => {
      invalidateOriginReturn();
      disarmExitHint();
      navigationGuardUntilRef.current = 0;
      setTabState(next);
      homeMenuOriginRef.current = null;
      setHomeMenuOrigin(null);
      pageRef.current = 'root';
      setPage('root');
      navigationStackRef.current = [];
      setStack([]);
    },
    [disarmExitHint, invalidateOriginReturn],
  );
  const refreshHome = useCallback(() => {
    if (homeRefreshFlight.current !== null) return;
    const token = ++homeRefreshGeneration.current;
    homeRefreshFlight.current = token;
    setHomeRefreshing(true);
    setHomeRefreshToken(token);
  }, []);
  const finishHomeRefresh = useCallback((token: number) => {
    if (homeRefreshFlight.current !== token) return;
    homeRefreshFlight.current = null;
    setHomeRefreshing(false);
  }, []);
  const publishQueueOrigin = useCallback(
    (origin: QueueOrigin | null, accepted = true) => {
      const cache = originCatalogState.current;
      if (!origin) {
        cache.active = null;
        cache.candidate = null;
        cache.returning = null;
      } else if (
        accepted &&
        cache.active?.origin.catalogKey !== origin.catalogKey
      ) {
        cache.active =
          cache.candidate?.origin.catalogKey === origin.catalogKey
            ? cache.candidate
            : { origin, states: new Map() };
        cache.candidate = null;
      }
      queueOriginRef.current = origin;
      setQueueOrigin(origin);
    },
    [],
  );
  const captureQueueOrigin = useCallback(
    (label?: string, target?: QueueOriginTarget): QueueOrigin => {
      const originTab = target?.tab ?? tab;
      const originPage = target?.page ?? pageRef.current;
      const navigation = queueOriginNavigationDefaults[originTab].map(
        ([key, initial]): [string, unknown] => [
          key,
          catalogViewState.has(key) ? catalogViewState.get(key) : initial,
        ],
      );
      const context = new Map(navigation);
      if (target?.menuChoiceId)
        context.set('home-menu-choice', target.menuChoiceId);
      if (target?.detailView)
        context.set('queue-origin-detail-view', target.detailView);
      for (const key of [
        'home-playlist-browser-context',
        'home-detail-catalog-list',
      ]) {
        const value = context.get(key);
        if (value && typeof value === 'object') {
          const selector = Object.fromEntries(
            Object.entries(value).filter(
              ([name]) => name !== 'initialSnapshot' && name !== 'initialItems',
            ),
          );
          context.set(key, selector);
        }
      }
      const detailKey =
        originTab === 'search'
          ? 'search-detail'
          : originTab === 'library'
          ? 'library-detail'
          : 'home-selected';
      if (target?.item !== undefined) context.set(detailKey, target.item);
      const personalPlaylistId =
        target?.personalPlaylistId ??
        (originTab === 'library' && originPage === 'personal-playlist'
          ? (context.get('library-playlist-opened') as string | undefined)
          : undefined);
      if (personalPlaylistId) {
        context.set('library-playlist-opened', personalPlaylistId);
      }
      const item = context.get(detailKey) as CatalogItem | null | undefined;
      let sourceLabel = label;
      if (
        !sourceLabel &&
        (originPage === 'playlist-detail' || originPage === 'search-playlist')
      )
        sourceLabel = item?.title;
      if (!sourceLabel && personalPlaylistId)
        sourceLabel = state?.playlists.find(
          value => value.id === personalPlaylistId,
        )?.title;
      if (!sourceLabel && originTab === 'search') {
        const type = {
          song: '单曲',
          artist: '歌手',
          album: '专辑',
          playlist: '歌单',
          radio: '电台',
        }[search.category];
        const providerLabel =
          search.provider === 'all'
            ? '全部平台'
            : platformLabel(search.provider) || '自定义';
        sourceLabel = `搜索：${search.query} · ${type} · ${providerLabel}`;
      }
      if (!sourceLabel && originTab === 'library') {
        const mode = context.get('library-mode') as LibraryMediaKind;
        const mediaLists = context.get('library-media-list') as Record<
          string,
          string
        >;
        const list =
          originPage === 'root'
            ? mode === 'music'
              ? (context.get('library-music-list') as AppPage)
              : (mediaLists?.[mode] as AppPage)
            : originPage;
        sourceLabel = `${{ music: '音乐' }[mode] ?? '音乐'} · ${
          originPageLabels[list] ?? '媒体库'
        }`;
      }
      if (!sourceLabel && originPage === 'catalog-list')
        sourceLabel = (
          context.get('home-detail-catalog-list') as {
            title?: string;
          } | null
        )?.title;
      if (!sourceLabel && originPage === 'feed')
        sourceLabel = `${category}推荐`;
      const searchSnapshot =
        originTab === 'search'
          ? {
              ...search,
              loading: false,
              tracks: search.tracks.map(({ playUrl: _url, ...track }) => track),
              queueProviderPages: search.queueProviderPages
                ? { ...search.queueProviderPages }
                : undefined,
            }
          : undefined;
      const origin: QueueOrigin = {
        catalogKey: ++originCatalogSequence.current,
        label: sourceLabel || originPageLabels[originPage] || '当前列表',
        tab: originTab,
        page: originPage,
        homeMenuOrigin:
          originPage === 'home-menu' ? homeMenuOriginRef.current : null,
        stack:
          target?.page !== undefined
            ? originPage === 'root'
              ? []
              : ['root']
            : [...navigationStackRef.current],
        navigation: [...context],
        ...(searchSnapshot ? { search: searchSnapshot } : {}),
        ...(originPage === 'feed' || originPage === 'new-songs'
          ? { category, feedPage }
          : {}),
        ...(personalPlaylistId ? { personalPlaylistId } : {}),
      };
      if (origin.category)
        queueOriginCatalog.stage(
          origin,
          `feed:${category}:${feedPage}`,
          {
            category,
            page: feedPage,
            tracks: feed.map(({ playUrl: _url, ...track }) => track),
            config: feedCatalogOwner.current.config,
          },
          feedCatalogOwner.current,
        );
      return origin;
    },
    [
      catalogViewState,
      category,
      feed,
      feedPage,
      queueOriginCatalog,
      search,
      state?.playlists,
      tab,
    ],
  );
  const returnToQueueOrigin = useCallback(() => {
    const origin = queueOriginRef.current;
    setQueueListOpen(false);
    setPlayerOverlayOpen(false);
    const targetContext = new Map(origin?.navigation ?? []);
    const missingDetail =
      origin &&
      (origin.page === 'playlist-detail' ||
        origin.page === 'search-playlist') &&
      !targetContext.get(
        origin.tab === 'search'
          ? 'search-detail'
          : origin.tab === 'library'
          ? 'library-detail'
          : 'home-selected',
      );
    const missingList =
      origin?.page === 'catalog-list' &&
      !targetContext.get('home-detail-catalog-list');
    const detail = targetContext.get(
      origin?.tab === 'search'
        ? 'search-detail'
        : origin?.tab === 'library'
        ? 'library-detail'
        : 'home-selected',
    ) as CatalogItem | null;
    const view = targetContext.get('queue-origin-detail-view') as
      | {
          provider?: string | null;
        }
      | undefined;
    const detailTarget =
      origin?.page === 'playlist-detail' || origin?.page === 'search-playlist';
    const provider =
      view?.provider ??
      (detailTarget ? detail?.provider : undefined) ??
      origin?.search?.provider;
    const missingProvider =
      provider &&
      provider !== 'all' &&
      provider !== 'custom' &&
      !recommendationPlatforms.some(item => item.id === provider);
    const savedFeed =
      origin?.category && origin.feedPage !== undefined
        ? queueOriginCatalog.read<{
            category: DiscoveryCategory;
            page: number;
            tracks: Track[];
            config: string;
          }>(`feed:${origin.category}:${origin.feedPage}`)
        : undefined;
    const missingFeed =
      origin?.category && savedFeed?.config !== feedConfigurationKey;
    if (
      !origin ||
      missingDetail ||
      missingList ||
      missingProvider ||
      missingFeed ||
      (origin.personalPlaylistId &&
        !state?.playlists.some(item => item.id === origin.personalPlaylistId))
    ) {
      setMessage('播放列表来源已不可用');
      return;
    }
    // Hold only this click's directory entry until its first render/layout
    // consumes it; a pending play may publish another origin in the same batch.
    const cache = originCatalogState.current;
    cache.returning =
      origin.page === 'playlist-detail' ||
      origin.page === 'search-playlist' ||
      origin.page === 'catalog-list'
        ? cache.candidate?.origin.catalogKey === origin.catalogKey
          ? cache.candidate
          : cache.active?.origin.catalogKey === origin.catalogKey
          ? cache.active
          : null
        : null;
    disarmExitHint();
    for (const [key, value] of origin.navigation)
      catalogViewState.set(key, value);
    setCatalogRestore(value => ({
      version: value.version + 1,
      keys: origin.navigation.map(([key]) => key),
      originKey: origin.catalogKey,
    }));
    if (origin.search) {
      searchGeneration.current += 1;
      setSearch(origin.search);
    }
    if (origin.category) setCategory(origin.category);
    if (origin.feedPage !== undefined) setFeedPage(origin.feedPage);
    if (origin.category && origin.feedPage !== undefined && savedFeed) {
      const returnedOwner = { config: feedConfigurationKey };
      queueOriginCatalog.read(
        `feed:${origin.category}:${origin.feedPage}`,
        returnedOwner,
      );
      feedRequest.current += 1;
      feedCatalogOwner.current = returnedOwner;
      pendingFeedRestore.current =
        category !== origin.category || feedPage !== origin.feedPage
          ? savedFeed
          : null;
      setFeed(savedFeed.tracks);
    }
    navigationGuardUntilRef.current = 0;
    homeMenuOriginRef.current = origin.homeMenuOrigin;
    setHomeMenuOrigin(homeMenuOriginRef.current);
    navigationStackRef.current = [...origin.stack];
    setStack([...origin.stack]);
    pageRef.current = origin.page;
    setTabState(origin.tab);
    setPage(origin.page);
  }, [
    catalogViewState,
    category,
    disarmExitHint,
    feedConfigurationKey,
    feedPage,
    queueOriginCatalog,
    recommendationPlatforms,
    setQueueListOpen,
    state?.playlists,
  ]);
  const refreshPage = useCallback(
    () => setPageRefreshToken(value => value + 1),
    [],
  );
  const playbackSourcesFor = useCallback(
    (track: Track) => {
      if (!state) return [];
      const verifiedIds =
        track.provider === 'custom'
          ? null
          : verifiedSourceIdsByProvider.current?.[track.provider];
      return verifiedSourceIdsByProvider.current
        ? state.sources.map(source => ({
            ...source,
            healthy: Boolean(verifiedIds?.includes(source.id)),
            pinnedBackend:
              verifiedBackendByProvider.current?.[
                track.provider as Exclude<Track['provider'], 'custom'>
              ],
          }))
        : state.sources;
    },
    [state],
  );
  const assertPlaybackSourceBinding = useCallback(
    (track: Track) => {
      if (
        track.provider === 'custom' ||
        localPlaybackReference(track) ||
        !verifiedSourceIdsByProvider.current
      )
        return;
      if (
        !playbackSourcesFor(track).some(
          source => source.healthy === true && isSourceEnabled(source),
        )
      )
        throw new SourceBindingUnavailableError(
          platformSourceKeys[track.provider],
        );
    },
    [playbackSourcesFor],
  );
  const pendingLocalMusicRepairs = useRef(
    new Map<string, ReturnType<typeof recoverMissingMusicDownload>>(),
  );
  const restoreLogicalTailContinuation = useCallback(async () => {
    onDemandPlayerQueue.current = true;
    await nativePlayer.setRepeatMode(partialQueueRepeatMode.current);
  }, []);
  const discardFuturePreparation = useCallback(
    (allNeighbours = false) => {
      playerQueuePreparation.current.pause();
      const request = playerPreparationCommit.current
        .catch(() => undefined)
        .then(async () => {
          const native = await nativePlayer.getState();
          const key = native.mediaId ?? actualPlayingKey.current;
          const currentIndex = queueRef.current.findIndex(
            item => trackQueueKey(item) === key,
          );
          if (currentIndex < 0) return;
          if (
            queueRef.current.some(
              (_, index) =>
                index !== currentIndex &&
                (allNeighbours || index > currentIndex),
            )
          )
            await restoreLogicalTailContinuation();
          for (
            let index = queueRef.current.length - 1;
            index >= 0;
            index -= 1
          ) {
            if (
              index === currentIndex ||
              (!allNeighbours && index < currentIndex)
            )
              continue;
            const active = await nativePlayer.getState();
            if (
              (active.mediaId && active.mediaId !== key) ||
              (actualPlayingKey.current && actualPlayingKey.current !== key)
            )
              return;
            const removed = await nativePlayer.removePreparedQueueItem(
              key,
              trackQueueKey(queueRef.current[index]!),
              index,
            );
            if (!removed) return;
            queueRef.current = queueRef.current.filter(
              (_, itemIndex) => itemIndex !== index,
            );
          }
        });
      playerPreparationCommit.current = request.catch(() => undefined);
      return request;
    },
    [restoreLogicalTailContinuation],
  );
  const prepareTrack = useCallback(
    async (
      track: Track,
      preferredQuality: PersistedState['settings']['quality'] = qualityPreferenceRef.current,
      refreshExpiredUrl = false,
      timing?: PlaybackTimingObserver,
      recoverMissingDownload = false,
      cachedUrlOnly = false,
    ) => {
      if (!state) throw new Error('应用状态尚未就绪');
      const sourceGeneration = sourceSelectionGeneration.current;
      const localReference = localPlaybackReference(track);
      if (localReference) {
        const localStarted = Date.now();
        let uri: string;
        let audio: Awaited<ReturnType<typeof probeLocalAudio>>;
        let reference = localReference;
        try {
          uri = await resolveLocalPlaybackReference(
            localReference,
            queryDownloadStatus,
          );
          audio = await probeLocalAudio(uri);
          validateLocalPlaybackAudio(track, audio);
        } catch (error) {
          if (!recoverMissingDownload) throw error;
          const key = `${trackQueueKey(track)}:${localReference}`;
          let recovery = pendingLocalMusicRepairs.current.get(key);
          if (!recovery) {
            recovery = recoverMissingMusicDownload(track, state, error, {
              query: queryDownloadStatus,
              probe: probeLocalAudio,
              download: async input => {
                if (sourceGeneration !== sourceSelectionGeneration.current)
                  throw new Error('音源设置已变更，请重新点击播放');
                setMessage('正在恢复本地下载…');
                const sources = playbackSourcesFor(input);
                if (
                  input.provider === 'custom' ||
                  !verifiedSourceIdsByProvider.current?.[input.provider]
                    ?.length ||
                  !sources.some(
                    source =>
                      source.enabled &&
                      source.healthy === true &&
                      Boolean(source.script),
                  )
                )
                  throw new Error(
                    '该平台本次检测没有可用的绑定音源，无法恢复下载',
                  );
                const url = await resolvePlayback(
                  input,
                  sources,
                  downloadNetworkQuality(state.settings),
                );
                return downloadAudio(url, input.title, input.artist);
              },
              update: (previous, replacement) =>
                patchState(value =>
                  replaceRecoveredMusicDownload(value, previous, replacement),
                ),
            }).finally(() => pendingLocalMusicRepairs.current.delete(key));
            pendingLocalMusicRepairs.current.set(key, recovery);
          }
          const restored = await recovery;
          uri = restored.uri;
          audio = restored.audio;
          reference = restored.reference;
        }
        console.info(
          '[library-local-playback]',
          JSON.stringify({
            key: trackQueueKey(track),
            stage: 'validated',
            elapsedMs: Date.now() - localStarted,
            scheme: uri.split(':')[0],
          }),
        );
        return {
          ...track,
          playUrl: uri,
          metadata: {
            ...track.metadata,
            _libraryLocalFile: reference,
            _playbackAudio: audio,
            _playbackQuality: undefined,
            _playbackPreference: preferredQuality,
            _playerPreparationSource: sourceGeneration,
          },
        };
      }
      // Keep the launch binding authoritative even when there are no enabled
      // scripts left. Local files returned above retain their independent path.
      assertPlaybackSourceBinding(track);
      const playbackPreference = track.metadata?._playbackPreference;
      const shouldRefreshPreparedUrl =
        Boolean(track.playUrl) &&
        track.provider !== 'custom' &&
        (playbackPreference !== preferredQuality ||
          (track.metadata?._playerPreparationSource !== undefined &&
            track.metadata._playerPreparationSource !== sourceGeneration));
      const input =
        refreshExpiredUrl || shouldRefreshPreparedUrl
          ? { ...track, playUrl: undefined }
          : track;
      const requestKey = `${sourceGeneration}:${preferredQuality}:${trackQueueKey(
        input,
      )}:${input.playUrl ?? ''}:${refreshExpiredUrl}:${cachedUrlOnly}`;
      const pending = pendingTrackPreparations.current.get(requestKey);
      if (pending) return pending;
      const request = (async () => {
        if (pageRef.current === 'player')
          console.info(
            '[player-audio-prepare]',
            JSON.stringify({
              at: Date.now(),
              key: trackQueueKey(input),
              preference: preferredQuality,
            }),
          );
        const resolved = await resolvePlaybackWithQuality(
          input,
          playbackSourcesFor(input),
          preferredQuality,
          refreshExpiredUrl,
          timing,
          cachedUrlOnly,
        );
        return {
          ...input,
          metadata: {
            ...(input.metadata ?? {}),
            _prewarmedUrl: false,
            _prewarmedAt: undefined,
            _playbackQuality: resolved.quality,
            _playbackReportedQuality: resolved.reportedQuality,
            _playbackPreference: preferredQuality,
            _playerPreparationSource: sourceGeneration,
            ...('audio' in resolved && resolved.audio
              ? { _playbackAudio: resolved.audio }
              : {}),
          },
          playUrl: resolved.url,
        };
      })();
      pendingTrackPreparations.current.set(requestKey, request);
      try {
        return await request;
      } finally {
        if (pendingTrackPreparations.current.get(requestKey) === request)
          pendingTrackPreparations.current.delete(requestKey);
      }
    },
    [assertPlaybackSourceBinding, playbackSourcesFor, state, patchState],
  );
  recoverExpiredUrl.current = value => {
    const recovery = value.urlRecovery;
    if (
      !recovery ||
      recovery.status !== 'pending' ||
      !recovery.resume ||
      handledExpiredUrls.current.has(recovery.token)
    )
      return;
    const active = queueRef.current.find(
      item => trackQueueKey(item) === recovery.mediaId,
    );
    if (!active) return;
    expiredUrlRequest.current?.abort.abort();
    const abort = new AbortController();
    expiredUrlRequest.current = { token: recovery.token, abort };
    handledExpiredUrls.current.add(recovery.token);
    while (handledExpiredUrls.current.size > 64)
      handledExpiredUrls.current.delete(
        handledExpiredUrls.current.values().next().value!,
      );
    const generation = queueGeneration.current;
    const navigation = navigationVersion.current;
    const sourceGeneration = sourceSelectionGeneration.current;
    const qualityVersion = qualityRequestVersion.current;
    const nativeFallback =
      !navigationPending.current && !playerRequestAbort.current;
    const isCurrent = () =>
      !abort.signal.aborted &&
      queueGeneration.current === generation &&
      navigationVersion.current === navigation &&
      sourceSelectionGeneration.current === sourceGeneration &&
      qualityRequestVersion.current === qualityVersion;
    (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancelResolution: (() => void) | undefined;
      try {
        const prepared = await Promise.race([
          prepareTrack(active, qualityPreferenceRef.current, true),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('播放地址重新解析超时')),
              15000,
            );
            cancelResolution = () =>
              reject(new Error('Player request superseded'));
            abort.signal.addEventListener('abort', cancelResolution, {
              once: true,
            });
          }),
        ]);
        if (timer) clearTimeout(timer);
        if (cancelResolution)
          abort.signal.removeEventListener('abort', cancelResolution);
        if (!isCurrent()) return;
        await nativePlayer.replaceExpiredUrl(
          recovery.token,
          prepared,
          nativeFallback,
        );
        if (!isCurrent()) return;
        const replace = (item: Track) =>
          trackQueueKey(item) === recovery.mediaId ? prepared : item;
        queueRef.current = queueRef.current.map(replace);
        logicalQueueRef.current = logicalQueueRef.current.map(replace);
        if (queuePublishedRef.current)
          queuePublishedRef.current = queuePublishedRef.current.map(replace);
        setQueue(items => items.map(replace));
        await nativePlayer.waitForPlaybackStart(
          15000,
          recovery.mediaId,
          abort.signal,
        );
      } catch {
        if (!isCurrent()) return;
        await nativePlayer
          .failExpiredUrlRecovery(recovery.token, nativeFallback)
          .catch(() => undefined);
      } finally {
        if (timer) clearTimeout(timer);
        if (cancelResolution)
          abort.signal.removeEventListener('abort', cancelResolution);
        if (expiredUrlRequest.current?.token === recovery.token)
          expiredUrlRequest.current = null;
      }
    })();
  };
  const prepare = useCallback(
    async (
      tracks: Track[],
      preferredQuality: PersistedState['settings']['quality'] = qualityPreferenceRef.current,
    ) => {
      if (!state) throw new Error('应用状态尚未就绪');
      const playable = await prepareValidatedTracks(tracks, track =>
        prepareTrack(track, preferredQuality),
      );
      if (!playable.length) throw new Error('当前列表没有可播放的在线音源');
      return playable;
    },
    [prepareTrack, state],
  );
  useEffect(
    () =>
      subscribeRuntimeTrackBlacklist(() => {
        setTrackBlacklistVersion(value => value + 1);
        setFeed(value => filterPlayableCandidates(value));
        setSearch(value => ({
          ...value,
          tracks: filterPlayableCandidates(value.tracks),
        }));
      }),
    [],
  );
  const prewarmIdentity = useCallback(
    (track: Track) => {
      const sources = playbackSourcesFor(track);
      return typeof sourceAddressCacheKey === 'function'
        ? sourceAddressCacheKey(track, sources, qualityPreferenceRef.current)
        : trackQueueKey(track);
    },
    [playbackSourcesFor],
  );
  const bindPrewarmedTrack = useCallback(
    (
      track: Track,
      result: Awaited<ReturnType<typeof resolvePlaybackPrewarm>>,
    ) => {
      const key = trackQueueKey(track);
      const bind = (item: Track) => {
        if (
          trackQueueKey(item) !== key ||
          item.metadata?._playbackAudio ||
          (item.playUrl === result.url &&
            item.metadata?._prewarmedUrl === true &&
            item.metadata._prewarmedQuality === result.quality &&
            item.metadata._prewarmedReportedQuality ===
              result.reportedQuality &&
            item.metadata._prewarmedAudio === result.audio)
        )
          return item;
        return {
          ...item,
          playUrl: result.url,
          metadata: {
            ...item.metadata,
            _prewarmedUrl: true,
            _prewarmedAt: Date.now(),
            _prewarmedQuality: result.quality,
            _prewarmedReportedQuality: result.reportedQuality,
            _prewarmedAudio: result.audio,
          },
        };
      };
      const bindTracks = (items: Track[]) => {
        let changed = false;
        const next = items.map(item => {
          const value = bind(item);
          if (value !== item) changed = true;
          return value;
        });
        return changed ? next : items;
      };
      queueRef.current = bindTracks(queueRef.current);
      logicalQueueRef.current = bindTracks(logicalQueueRef.current);
      if (queuePublishedRef.current)
        queuePublishedRef.current = bindTracks(queuePublishedRef.current);
      setQueue(bindTracks);
      setFeed(bindTracks);
      setSearch(value => {
        const tracks = bindTracks(value.tracks);
        return tracks === value.tracks ? value : { ...value, tracks };
      });
    },
    [],
  );
  const dropUnavailableQueueTrack = useCallback((key: string) => {
    if (
      key === actualPlayingKey.current ||
      key === catalogPlaybackGate.current?.key
    )
      return;
    const logical = logicalQueueRef.current;
    if (!logical.some(track => trackQueueKey(track) === key)) return;
    const remaining = logical.filter(track => trackQueueKey(track) !== key);
    logicalQueueRef.current = remaining;
    queuePublishedRef.current = remaining;
    queuePreparationVersion.current += 1;
    setQueue(remaining);
    setPlayer(value => ({
      ...value,
      index: Math.max(
        0,
        remaining.findIndex(
          track => trackQueueKey(track) === actualPlayingKey.current,
        ),
      ),
    }));
    const generation = queueGeneration.current;
    if (queueRef.current.some(track => trackQueueKey(track) === key)) {
      const cleanup = playerPreparationCommit.current
        .catch(() => undefined)
        .then(async () => {
          if (
            queueGeneration.current !== generation ||
            key === actualPlayingKey.current ||
            key === catalogPlaybackGate.current?.key
          )
            return;
          const index = queueRef.current.findIndex(
            track => trackQueueKey(track) === key,
          );
          if (index < 0) return;
          await nativePlayer.removeQueueItem(index);
          if (queueGeneration.current === generation)
            queueRef.current = queueRef.current.filter(
              track => trackQueueKey(track) !== key,
            );
        });
      playerPreparationCommit.current = cleanup.catch(() => undefined);
    }
  }, []);
  const enqueueUrlPrewarm = useCallback(
    (
      lane: UrlPrewarmLane,
      tracks: Track[],
      owner?: object,
      onResult?: (result: { key: string; outcome: UrlPrewarmOutcome }) => void,
    ) => {
      if (!state) return;
      const healthy = new Set(recommendationPlatforms.map(item => item.id));
      if (lane === 'queue')
        urlPrewarmScheduler.current!.setQueueOrder(
          logicalQueueRef.current.map(prewarmIdentity),
        );
      const sourceGenerationAtEnqueue = sourceSelectionGeneration.current;
      const qualityAtEnqueue = qualityPreferenceRef.current;
      const cacheTokenAtEnqueue = sourceResolutionCacheToken();
      const outcomes: Promise<UrlPrewarmOutcome>[] = [];
      for (const track of tracks) {
        if (trackQueueKey(track) === actualPlayingKey.current) continue;
        if (
          track.provider === 'custom' ||
          localPlaybackReference(track) ||
          !healthy.has(track.provider)
        )
          continue;
        const key = prewarmIdentity(track);
        const onFailure =
          lane === 'queue'
            ? async (signal: AbortSignal) => {
                if (
                  signal.aborted ||
                  sourceSelectionGeneration.current !==
                    sourceGenerationAtEnqueue ||
                  qualityPreferenceRef.current !== qualityAtEnqueue ||
                  sourceResolutionCacheToken() !== cacheTokenAtEnqueue
                )
                  return;
                const failedTrack = logicalQueueRef.current.find(
                  item => prewarmIdentity(item) === key,
                );
                if (!failedTrack) return;
                const failedKey = trackQueueKey(failedTrack);
                if (
                  failedKey === actualPlayingKey.current ||
                  failedKey === catalogPlaybackGate.current?.key
                )
                  return;
                dropUnavailableQueueTrack(failedKey);
              }
            : undefined;
        const outcome = urlPrewarmScheduler.current!.enqueue(
          lane,
          key,
          async signal => {
            const startedAt = Date.now();
            const preferred = qualityPreferenceRef.current;
            const cacheToken = sourceResolutionCacheToken();
            const result =
              lane === 'queue'
                ? await resolveWithImportedSourcePrewarm(
                    track,
                    playbackSourcesFor(track),
                    preferred,
                    signal,
                  )
                : await resolvePlaybackPrewarm(
                    track,
                    playbackSourcesFor(track),
                    preferred,
                    signal,
                  );
            if (signal.aborted) throw new Error('URL prewarm interrupted');
            if (
              preferred !== qualityPreferenceRef.current ||
              cacheToken !== sourceResolutionCacheToken()
            )
              return;
            bindPrewarmedTrack(track, result);
            console.info(
              '[url-prewarm]',
              JSON.stringify({
                key: trackQueueKey(track),
                lane,
                ...(owner ? { surface: 'detail' } : {}),
                stage: 'bound',
                requestedQuality: preferred,
                quality: result.quality,
                audioValidated: Boolean(result.audio),
                elapsedMs: Date.now() - startedAt,
              }),
            );
          },
          owner,
          onFailure,
        );
        outcomes.push(outcome);
        if (onResult)
          void outcome.then(value =>
            onResult({ key: trackQueueKey(track), outcome: value }),
          );
      }
      return Promise.all(outcomes);
    },
    [
      bindPrewarmedTrack,
      dropUnavailableQueueTrack,
      playbackSourcesFor,
      prewarmIdentity,
      recommendationPlatforms,
      state,
    ],
  );
  const prewarmDetailTracks = useCallback(
    async (
      tracks: Track[],
      owner: object,
      onResult?: (result: { key: string; outcome: UrlPrewarmOutcome }) => void,
    ) => {
      const currentPage = pageRef.current;
      const detailVisible =
        (
          [
            'playlist-detail',
            'search-playlist',
            'new-songs',
            'new-albums',
            'catalog-list',
          ] as AppPage[]
        ).includes(currentPage) ||
        (currentPage === 'root' && tab === 'search') ||
        ((
          ['root', 'personal-playlist', 'favorites', 'history'] as AppPage[]
        ).includes(currentPage) &&
          tab === 'library');
      urlPrewarmScheduler.current!.retainOwner(
        owner,
        detailVisible ? tracks.map(prewarmIdentity) : [],
      );
      if (!detailVisible || startup.visible) return;
      await enqueueUrlPrewarm('home-visible', tracks, owner, result => {
        onResult?.(result);
        console.info(
          '[detail-url-prewarm-outcome]',
          JSON.stringify({ ...result, page: currentPage }),
        );
      });
    },
    [enqueueUrlPrewarm, prewarmIdentity, startup.visible, tab],
  );
  const releaseDetailPrewarm = useCallback((owner: object) => {
    urlPrewarmScheduler.current!.retainOwner(owner, []);
  }, []);
  const waitForQueuePrewarm = useCallback(
    () => urlPrewarmScheduler.current!.whenQueueIdle(),
    [],
  );
  const prewarmHomeTracks = useCallback(
    (tracks: Track[]) => {
      const isHomeSurface =
        tab === 'discovery' && (['root'] as AppPage[]).includes(page);
      const isSearchSurface =
        tab === 'search' &&
        (['root', 'search-playlist'] as AppPage[]).includes(page);
      if (!state || (!isHomeSurface && !isSearchSurface)) return;
      if (startup.visible) {
        if (isHomeSurface) {
          for (const track of tracks) {
            const key = `${track.provider}:${track.providerId ?? track.id}`;
            homePrewarmDeferred.current.set(key, track);
          }
          return;
        }
      }
      enqueueUrlPrewarm('home-visible', tracks);
    },
    [enqueueUrlPrewarm, page, startup.visible, state, tab],
  );
  useEffect(() => {
    if (startup.visible || !homePrewarmDeferred.current.size) return;
    const deferred = [...homePrewarmDeferred.current.values()];
    homePrewarmDeferred.current.clear();
    prewarmHomeTracks(deferred);
  }, [prewarmHomeTracks, startup.visible]);
  const setQueueSource = useCallback((source: QueueSource | null) => {
    // A previous queue's unresponsive request cannot own the new queue's lock.
    queuePageAbort.current?.abort();
    queuePageAbort.current = null;
    queuePageRequest.current = null;
    const context = source
      ? {
          source,
          loading: false,
          ...(source.kind === 'home-menu' && source.initialMenuBatch
            ? { menuFirstBatchPlayed: false }
            : {}),
        }
      : null;
    queuePaging.current = context;
    setQueuePage({
      loading: false,
      hasMore: source?.hasMore ?? false,
      error: '',
    });
    return context;
  }, []);
  const startupRuntime = useRef({
    state,
    playbackSourcesFor,
  });
  startupRuntime.current = {
    state,
    playbackSourcesFor,
  };
  const reverseQueue = useCallback(() => {
    if (queueReverseRequest.current) return queueReverseRequest.current;
    if (
      busy ||
      navigationPending.current ||
      (catalogPlaybackGate.current && !catalogPlaybackGate.current.ready)
    ) {
      setMessage('请等待当前播放准备完成后再倒序');
      return Promise.resolve();
    }
    const generation = queueGeneration.current;
    playerQueuePreparation.current.pause();
    const key = current ? trackQueueKey(current) : '';
    const previousNativeCommit = playerPreparationCommit.current;
    const request = (async () => {
      setQueueOrderChanging(true);
      try {
        await previousNativeCommit.catch(() => undefined);
        if (queueGeneration.current !== generation) return;
        const prepared = [...queueRef.current].reverse();
        if (prepared.length > 1)
          await nativePlayer.reorderQueue(key, prepared.map(trackQueueKey));
        queueRef.current = [...queueRef.current].reverse();
        if (queueGeneration.current !== generation) return;
        const logical = [
          ...(queuePublishedRef.current ?? logicalQueueRef.current),
        ].reverse();
        if (logical.length < 2) return;
        logicalQueueRef.current = logical;
        queuePublishedRef.current = logical;
        urlPrewarmScheduler.current!.setQueueOrder(
          logical.map(prewarmIdentity),
        );
        queueReversedRef.current = !queueReversedRef.current;
        setQueueReversed(queueReversedRef.current);
        setQueue(logical);
        const index = queueIndexForKey(logical, key, 0);
        navigationCursor.current = index;
        setPlayer(value => ({ ...value, index }));
        setQueueOrderVersion(value => value + 1);
      } catch (error) {
        if (queueGeneration.current === generation)
          setMessage(
            error instanceof Error ? error.message : '播放列表倒序失败',
          );
      } finally {
        setQueueOrderChanging(false);
      }
    })();
    queueReverseRequest.current = request;
    playerPreparationCommit.current = request.catch(() => undefined);
    void request.finally(() => {
      if (queueReverseRequest.current === request)
        queueReverseRequest.current = null;
    });
    return request;
  }, [busy, current, prewarmIdentity]);
  const publishQueueAdditions = useCallback((additions: Track[]) => {
    const previous = queuePublishedRef.current ?? logicalQueueRef.current;
    const next = extendOrderedQueue(
      previous,
      additions,
      queueReversedRef.current,
    );
    logicalQueueRef.current = next;
    queuePublishedRef.current = next;
    setQueue(next);
    const context = queuePaging.current;
    if (context)
      context.publishedCount = (context.publishedCount ?? 0) + additions.length;
    if (queueReversedRef.current)
      setPlayer(value => ({
        ...value,
        index: queueIndexForKey(
          next,
          value.mediaId ??
            (previous[value.index]
              ? trackQueueKey(previous[value.index]!)
              : ''),
          value.index,
        ),
      }));
  }, []);
  const loadMoreQueue = useCallback(() => {
    if (catalogPlaybackGate.current && !catalogPlaybackGate.current.ready)
      return Promise.resolve();
    const sceneContext = queuePaging.current;
    // Optimistic play state and queue-bottom events cannot admit the first
    // scene tail until the selected song passes the native PLAYING gate.
    if (
      sceneContext?.source.kind === 'home-menu' &&
      sceneContext.source.initialMenuBatch &&
      !sceneContext.menuFirstBatchPlayed
    )
      return Promise.resolve();
    if (queuePageRequest.current) return queuePageRequest.current;
    const controller = new AbortController();
    queuePageAbort.current = controller;
    let resolvePageReady!: () => void;
    let pageReadySettled = false;
    const pageReady = new Promise<void>(resolve => {
      resolvePageReady = resolve;
    });
    queuePageReadyRequest.current = pageReady;
    const markPageReady = () => {
      if (pageReadySettled) return;
      pageReadySettled = true;
      resolvePageReady();
      signalQueueProgress();
      if (queuePageReadyRequest.current === pageReady)
        queuePageReadyRequest.current = null;
    };
    let resolveReady!: () => void;
    let readySettled = false;
    const ready = new Promise<void>(resolve => {
      resolveReady = resolve;
    });
    queueReadyRequest.current = ready;
    const markReady = () => {
      if (readySettled) return;
      readySettled = true;
      resolveReady();
      if (queueReadyRequest.current === ready) queueReadyRequest.current = null;
      signalQueueProgress();
    };
    const releaseDataPriority = urlPrewarmScheduler.current!.hold();
    let dataPriorityReleased = false;
    const releaseDataPriorityOnce = () => {
      if (dataPriorityReleased) return;
      dataPriorityReleased = true;
      releaseDataPriority();
    };
    let request!: Promise<void>;
    request = (async () => {
      const context = queuePaging.current;
      if (!state || !context || context.loading || !context.source.hasMore) {
        releaseDataPriorityOnce();
        return markPageReady(), markReady();
      }
      context.loading = true;
      context.error = '';
      const targetPageSize =
        context.source.kind === 'home-menu' && context.source.initialMenuBatch
          ? context.source.initialMenuBatch.remaining
          : context.source.kind !== 'home-menu' &&
            context.desiredTotal &&
            !context.satisfiedAheadTotal &&
            logicalQueueRef.current.length < QUEUE_BATCH_SIZE
          ? QUEUE_BATCH_SIZE - logicalQueueRef.current.length
          : QUEUE_BATCH_SIZE;
      setQueuePage({ loading: true, hasMore: true, error: '' });
      let cursor = sourceWithSeenKeys(
        context.source,
        [...logicalQueueRef.current, ...queueRef.current].map(trackQueueKey),
      );
      let additions: Track[] = [];
      let publishedAdditions = 0;
      const deadline = Date.now() + QUEUE_PAGE_TIMEOUT_MS;
      let releaseTimerTask: () => void = () => undefined;
      try {
        releaseTimerTask = await holdQueuePageTask();
        // A single queue request may cross several remote pages when filtering
        // or de-duplication leaves the current page short.  This keeps the
        // logical list twenty items ahead of the user's viewport without an
        // artificial five-page business limit.
        const seen = new Set([
          ...logicalQueueRef.current.map(trackQueueKey),
          ...queueRef.current.map(trackQueueKey),
        ]);
        let previousProgress = queueSourceProgressKey(cursor);
        while (
          cursor.hasMore &&
          additions.length < targetPageSize &&
          queuePaging.current === context
        ) {
          const result = await nextQueuePage(
            cursor,
            recommendationPlatforms,
            targetPageSize - additions.length,
            { signal: controller.signal, timeoutMs: deadline - Date.now() },
          );
          if (queuePaging.current !== context) return;
          const progress = queueSourceProgressKey(result.source);
          if (progress === previousProgress)
            throw new Error('播放列表分页游标未推进，请稍后重试');
          previousProgress = progress;
          cursor = result.source;
          for (const track of result.tracks) {
            const key = trackQueueKey(track);
            if (seen.has(key)) continue;
            seen.add(key);
            additions.push(track);
          }
          if (cursor.kind === 'home-menu') {
            // Commit each advancing short page before trying another one, so
            // failure/cancellation cannot lose already published progress.
            const pageTracks = additions.slice(publishedAdditions);
            if (pageTracks.length) publishQueueAdditions(pageTracks);
            publishedAdditions = additions.length;
            context.source = cursor;
            rememberHomeMenuBatch(cursor.cursor, pageTracks);
            console.info(
              '[menu-batch]',
              JSON.stringify({
                choice: cursor.cursor.choiceId,
                stage: 'continuation',
                revision: cursor.cursor.batchRevision,
                added: pageTracks.length,
                total: logicalQueueRef.current.length,
                hasMore: cursor.hasMore,
                initialRemaining: cursor.initialMenuBatch?.remaining ?? 0,
                actualPlayingKey: actualPlayingKey.current,
              }),
            );
          }
          if (!result.tracks.length && !cursor.hasMore) break;
        }
        if (queuePaging.current !== context) return;
        if (additions.length > publishedAdditions) {
          publishQueueAdditions(additions.slice(publishedAdditions));
        }
        // Publish the fetched page and advance its cursor before any audio
        // URL resolution. Navigation can now select a logical entry and use
        // the existing selected-song cold path while hydration continues.
        context.source = cursor;
        markPageReady();
        setQueuePage({
          loading: false,
          hasMore: context.source.hasMore,
          error: '',
        });
        delete context.prefetchErrorKey;
        // Directory pagination is complete as soon as its logical page is
        // published. Do not hold the single-flight request lock while native
        // URL/duration validation hydrates the same page; a second scroll or
        // playback threshold must be able to request the following page.
        context.loading = false;
        if (queuePageRequest.current === request)
          queuePageRequest.current = null;
        // The logical page and continuation cursor are now available. Queue
        // entries enter the shared final-URL audio-validation lane; the
        // selected-song playback gate remains responsible for Media3 loading.
        if (additions.length && catalogPlaybackGate.current?.ready)
          enqueueUrlPrewarm(
            'queue',
            additions.filter(
              track => trackQueueKey(track) !== actualPlayingKey.current,
            ),
          );
        releaseDataPriorityOnce();
        markReady();
        if (queuePaging.current !== context) return;
      } catch (error) {
        if (queuePaging.current === context) {
          // Keep every successfully consumed remote page so a transient
          // failure on a later page retries from that exact cursor instead of
          // replaying or skipping the earlier page.
          const seen = new Set([
            ...logicalQueueRef.current.map(trackQueueKey),
            ...queueRef.current.map(trackQueueKey),
          ]);
          const partial = additions.filter(track => {
            const key = trackQueueKey(track);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (partial.length) {
            publishQueueAdditions(partial);
            if (catalogPlaybackGate.current?.ready)
              enqueueUrlPrewarm(
                'queue',
                partial.filter(
                  track => trackQueueKey(track) !== actualPlayingKey.current,
                ),
              );
          }
          context.source = cursor;
          context.error =
            error instanceof Error ? error.message : '播放列表加载失败';
          context.prefetchErrorKey = actualPlayingKey.current || undefined;
          setQueuePage({
            loading: false,
            hasMore: cursor.hasMore,
            error: error instanceof Error ? error.message : '播放列表加载失败',
          });
        }
        releaseDataPriorityOnce();
        markPageReady();
      } finally {
        releaseTimerTask();
        releaseDataPriorityOnce();
        context.loading = false;
        markPageReady();
        markReady();
        if (queuePageAbort.current === controller)
          queuePageAbort.current = null;
      }
    })();
    queuePageRequest.current = request;
    void request
      .finally(() => {
        if (queuePageRequest.current === request)
          queuePageRequest.current = null;
      })
      .catch(() => undefined);
    return request;
  }, [
    enqueueUrlPrewarm,
    publishQueueAdditions,
    recommendationPlatforms,
    rememberHomeMenuBatch,
    signalQueueProgress,
    state,
  ]);
  const prefetchQueueAt = useCallback(
    (
      index: number,
      options?: {
        gesture?: boolean;
      },
    ) => {
      const context = queuePaging.current;
      if (
        !context ||
        !catalogPlaybackGate.current?.ready ||
        catalogPlaybackGate.current.generation !== queueGeneration.current ||
        !actualPlayingKey.current ||
        navigationPending.current
      )
        return Promise.resolve();
      context.desiredTotal = Math.max(
        context.desiredTotal ?? 0,
        queueAheadTarget(
          index,
          logicalQueueRef.current.length,
          queueReversedRef.current,
        ),
      );
      if (context.aheadRequest) return context.aheadRequest;
      if (
        !options?.gesture &&
        (context.satisfiedAheadTotal ?? 0) >= context.desiredTotal
      )
        return Promise.resolve();
      if (
        context.error &&
        context.prefetchErrorKey === actualPlayingKey.current
      )
        return Promise.resolve();
      if (context.error) {
        context.error = '';
        context.prefetchErrorKey = actualPlayingKey.current;
        setQueuePage(value => ({ ...value, error: '' }));
      }
      const request = Promise.resolve().then(async () => {
        // Count supplied directory entries independently of later audio failures.
        // Those failures still remove the song, but cannot drain remote pages
        // forever while the same viewport/playing group remains stationary.
        let suppliedTotal = logicalQueueRef.current.length;
        let published = context.publishedCount ?? 0;
        while (
          queuePaging.current === context &&
          context.source.hasMore &&
          !context.error &&
          catalogPlaybackGate.current?.ready &&
          !navigationPending.current &&
          Math.max(suppliedTotal, logicalQueueRef.current.length) <
            (context.desiredTotal ?? 0)
        ) {
          const before = logicalQueueRef.current.length;
          const previousCursor = queueSourceProgressKey(context.source);
          const borrowedRequest = queuePageRequest.current;
          await loadMoreQueue();
          if (queuePaging.current !== context) return;
          suppliedTotal += (context.publishedCount ?? 0) - published;
          published = context.publishedCount ?? 0;
          if (
            context.source.kind === 'home-menu' &&
            context.source.initialMenuBatch
          )
            break;
          if (
            logicalQueueRef.current.length === before &&
            queueSourceProgressKey(context.source) === previousCursor
          ) {
            // The borrowed request may belong to a superseded queue. Its release
            // still leaves this queue's goal pending, so let this context load it.
            if (borrowedRequest) continue;
            break;
          }
        }
        if (
          !context.error &&
          Math.max(suppliedTotal, logicalQueueRef.current.length) >=
            (context.desiredTotal ?? 0)
        )
          context.satisfiedAheadTotal = context.desiredTotal;
      });
      context.aheadRequest = request;
      void request
        .finally(() => {
          if (context.aheadRequest === request)
            context.aheadRequest = undefined;
        })
        .catch(() => undefined);
      return request;
    },
    [loadMoreQueue],
  );
  prefetchQueueRuntime.current = prefetchQueueAt;
  startMenuInitialCompletion.current = () => {
    const context = queuePaging.current;
    const scene = scenePlayback.current;
    const gate = catalogPlaybackGate.current;
    if (
      !context ||
      context.source.kind !== 'home-menu' ||
      !context.source.initialMenuBatch ||
      context.menuFirstBatchPlayed ||
      !gate?.ready ||
      gate.generation !== queueGeneration.current ||
      (scene &&
        (!scene.started ||
          scene.paused ||
          scene.generation !== queueGeneration.current))
    )
      return;
    context.menuFirstBatchPlayed = true;
    const begin = () => {
      if (
        queuePaging.current === context &&
        context.source.kind === 'home-menu' &&
        context.source.initialMenuBatch
      )
        void loadMoreQueue().catch(() => undefined);
    };
    // A superseded queue may still own the global directory request. Wait for
    // its release, then kick this scene once instead of borrowing its result.
    const pending = queuePageRequest.current;
    if (pending) void pending.finally(begin).catch(() => undefined);
    else begin();
  };
  const removeQueueTrack = useCallback(
    async (trackId: string, keyHint?: string) => {
      playerQueuePreparation.current.pause();
      await playerPreparationCommit.current.catch(() => undefined);
      if (
        keyHint !== undefined ||
        pageRef.current === 'queue' ||
        queueListOpenRef.current ||
        logicalQueueRef.current.length > queueRef.current.length
      ) {
        const logical = logicalQueueRef.current;
        const logicalIndex = logical.findIndex(track =>
          keyHint !== undefined
            ? trackQueueKey(track) === keyHint
            : track.id === trackId,
        );
        if (logicalIndex < 0) return;
        const removeKey = trackQueueKey(logical[logicalIndex]!);
        const activeKey =
          player.mediaId ??
          (logical[player.index] ? trackQueueKey(logical[player.index]!) : '');
        const remaining = logical.filter(
          track => trackQueueKey(track) !== removeKey,
        );
        queuePreparationVersion.current += 1;
        const nativeIndex = queueRef.current.findIndex(
          track => trackQueueKey(track) === removeKey,
        );
        if (removeKey === activeKey) {
          const target = Math.min(logicalIndex, remaining.length - 1);
          if (target >= 0) {
            await nativePlayer.stop();
            if (nativeIndex >= 0)
              await nativePlayer.removeQueueItem(nativeIndex);
            queueRef.current = queueRef.current.filter(
              track => trackQueueKey(track) !== removeKey,
            );
            logicalQueueRef.current = remaining;
            queuePublishedRef.current = null;
            setQueue(remaining);
            await startFeedRef.current(remaining[target]!, remaining, target, {
              openPlayer: false,
              queueSource: queuePaging.current?.source,
            });
            return;
          }
          playerRequestAbort.current?.abort();
          queueGeneration.current += 1;
          await nativePlayer.stop();
        }
        if (nativeIndex >= 0) await nativePlayer.removeQueueItem(nativeIndex);
        queueRef.current = queueRef.current.filter(
          track => trackQueueKey(track) !== removeKey,
        );
        logicalQueueRef.current = remaining;
        queuePublishedRef.current = null;
        setQueue(remaining);
        if (!remaining.length) publishQueueOrigin(null);
        setPlayer(value => ({
          ...value,
          index: Math.max(
            0,
            remaining.findIndex(track => trackQueueKey(track) === activeKey),
          ),
          mediaId: remaining.length ? value.mediaId : null,
          playing: remaining.length ? value.playing : false,
        }));
        return;
      }
      const pending = [queuePageRequest.current].filter(
        (request): request is Promise<void> => Boolean(request),
      );
      if (pending.length)
        await Promise.all(
          pending.map(request => request.catch(() => undefined)),
        );
      const index = queueRef.current.findIndex(track =>
        keyHint !== undefined
          ? trackQueueKey(track) === keyHint
          : track.id === trackId,
      );
      if (index < 0) return;
      const currentKey = logicalQueueRef.current[player.index]
        ? trackQueueKey(logicalQueueRef.current[player.index]!)
        : queueRef.current[player.index]
        ? trackQueueKey(queueRef.current[player.index]!)
        : '';
      const removeKey = queueRef.current.find(track =>
        keyHint !== undefined
          ? trackQueueKey(track) === keyHint
          : track.id === trackId,
      )
        ? trackQueueKey(
            queueRef.current.find(track =>
              keyHint !== undefined
                ? trackQueueKey(track) === keyHint
                : track.id === trackId,
            )!,
          )
        : trackId;
      const wasCurrent = currentKey === removeKey;
      const nextQueue = queueRef.current.filter(
        track => trackQueueKey(track) !== removeKey,
      );
      if (wasCurrent) await nativePlayer.stop();
      await nativePlayer.removeQueueItem(index);
      queueRef.current = nextQueue;
      setQueue(nextQueue);
      if (!nextQueue.length) publishQueueOrigin(null);
      if (!nextQueue.length) {
        setPlayer(value => ({
          ...value,
          index: 0,
          playing: false,
          position: 0,
        }));
        setMessage('播放列表已为空');
        return;
      }
      if (wasCurrent) {
        const target = Math.min(index, nextQueue.length - 1);
        try {
          await nativePlayer.playIndex(target);
          setPlayer(value => ({
            ...value,
            index: target,
            playing: true,
            position: 0,
            error: null,
          }));
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : '下一首歌曲暂时无法播放',
          );
        }
        return;
      }
      setPlayer(value => ({
        ...value,
        index: index < value.index ? value.index - 1 : value.index,
      }));
    },
    [player.index, player.mediaId, publishQueueOrigin],
  );
  useEffect(() => {
    if (
      autoNext === undefined ||
      repeatMode === undefined ||
      shuffle === undefined
    )
      return;
    nativePlayer.setAutoNext(autoNext).catch(() => undefined);
    nativePlayer.setShuffle(shuffle).catch(() => undefined);
    nativePlayer
      .setRepeatMode(
        onDemandPlayerQueue.current && repeatMode !== 'one'
          ? 'off'
          : repeatMode,
      )
      .catch(() => undefined);
    nativePlayer.setNormalize(Boolean(normalizeVolume)).catch(() => undefined);
    nativePlayer
      // The setting describes whether this app's playback is protected from
      // other apps. Media3's handleAudioFocus=true enables automatic focus-loss
      // interruption, so pass the inverse of the persisted UI value.
      .setAudioFocus(!Boolean(interruptPlayback))
      .catch(() => undefined);
  }, [autoNext, interruptPlayback, normalizeVolume, repeatMode, shuffle, page]);
  useEffect(() => {
    if (!equalizer) return;
    const gains = equalizer === 'Custom' ? customEqualizerGains : undefined;
    const configuration = AudioEffectStateManager.configuration(
      customEqualizerAdvanced,
      headphoneCalibration,
    );
    const key = JSON.stringify([equalizer, gains, configuration]);
    if (appliedEqualizerKey.current === key || equalizerUpdates.busy) return;
    equalizerUpdates.request(async () => {
      // A preceding interactive update can already have synchronized this state.
      if (appliedEqualizerKey.current === key) return true;
      await nativePlayer.setEqualizer(equalizer, gains, configuration);
      appliedEqualizerKey.current = key;
      return true;
    });
  }, [
    equalizer,
    customEqualizerGains,
    customEqualizerAdvanced,
    headphoneCalibration,
    page,
    equalizerUpdates,
  ]);
  const applyPlatformHealth = useCallback(
    (platformHealth: PlatformHealthResult) => {
      setHealthyProviderIds(platformHealth.healthy);
      setStartupHealth(platformHealth);
      verifiedSourceIdsByProvider.current = platformHealth.sourceIdsByProvider;
      verifiedBackendByProvider.current = platformHealth.backendByProvider;
    },
    [],
  );
  // Source changes start a new probe generation. This refreshes the fixed
  // platform/backend bindings without replaying startup autoplay or rebuilding
  // the playback queue after the app is already visible.
  useEffect(() => {
    const refreshState = startupRuntime.current.state;
    if (!ready || !refreshState || sourceHealthRevision === 0) return;
    const capturedGeneration = sourceSelectionGeneration.current;
    let cancelled = false;
    (async () => {
      resetLaunchBackendPools();
      const platformHealth = await detectHealthyPlatforms(
        refreshState.platforms,
        refreshState.sources,
        playbackNetworkQuality(refreshState.settings),
        refreshState.settings.multiSourceDetection,
      );
      if (
        !isCurrentSourceHealthGeneration(
          capturedGeneration,
          sourceSelectionGeneration.current,
          cancelled,
        )
      )
        return;
      applyPlatformHealth(platformHealth);
      console.info(
        '[source-health-refresh]',
        JSON.stringify({
          generation: capturedGeneration,
          healthy: orderedHealthyProviders(platformHealth),
        }),
      );
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [applyPlatformHealth, ready, sourceHealthRevision]);
  const startupHomeCommit = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (startup.visible || !startupHomeCommit.current) return;
    const commit = startupHomeCommit.current;
    const frame = requestAnimationFrame(() => {
      if (startupHomeCommit.current === commit) {
        console.info(
          '[startup-sequence]',
          JSON.stringify({ stage: 'home-committed' }),
        );
        commit();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [startup.visible]);
  useEffect(() => {
    const runtime = startupRuntime.current;
    if (!ready || !runtime.state || startupHandled.current) return;
    let launchState = runtime.state;
    startupHandled.current = true;
    const sourceGeneration = sourceSelectionGeneration.current;
    let cancelled = false;
    const catalogAbort = new AbortController();
    const sourceGenerationIsCurrent = () =>
      isCurrentSourceHealthGeneration(
        sourceGeneration,
        sourceSelectionGeneration.current,
        cancelled,
      );
    let releaseStartupPrewarm: (() => void) | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const pendingWaits = new Set<() => void>();
    const schedule = (callback: () => void, milliseconds: number) => {
      const timer = setTimeout(callback, milliseconds);
      timers.push(timer);
      return timer;
    };
    const isTestRuntime =
      (
        globalThis as {
          process?: {
            env?: {
              NODE_ENV?: string;
            };
          };
        }
      ).process?.env?.NODE_ENV === 'test';
    // A user action may race the final splash crossfade (especially on a warm
    // restore). Preserve that explicit choice and do not let startup autoplay
    // replace it after the window becomes visible.
    const startupGeneration = queueGeneration.current;
    const keepStageVisible = (milliseconds: number) => {
      if (cancelled) return Promise.resolve();
      return new Promise<void>(resolve => {
        const finish = () => {
          pendingWaits.delete(finish);
          resolve();
        };
        pendingWaits.add(finish);
        schedule(finish, isTestRuntime ? 0 : milliseconds);
      });
    };
    let homeRevealed = false;
    const reveal = async (forPlayback = false) => {
      if (homeRevealed) return;
      if (!sourceGenerationIsCurrent()) return;
      setStartup(value => ({ ...value, progress: 1, label: '准备完成' }));
      await keepStageVisible(STARTUP_READY_HOLD_MS);
      if (!sourceGenerationIsCurrent()) return;
      const committed = forPlayback
        ? new Promise<void>(resolve => {
            const finish = () => {
              pendingWaits.delete(finish);
              if (startupHomeCommit.current === finish)
                startupHomeCommit.current = null;
              resolve();
            };
            pendingWaits.add(finish);
            startupHomeCommit.current = finish;
          })
        : null;
      setStartup(value => ({ ...value, visible: false }));
      homeRevealed = true;
      console.info(
        '[startup-sequence]',
        JSON.stringify({ stage: 'home-revealed' }),
      );
      if (committed) await committed;
      else await keepStageVisible(STARTUP_CROSSFADE_SETTLE_MS);
    };
    (async () => {
      try {
        setStartup({
          visible: true,
          label: '正在读取音乐平台',
          progress: 0.3,
        });
        await keepStageVisible(280);
        if (!sourceGenerationIsCurrent()) return;
        if (!launchState.sources.some(isSourceEnabled)) {
          setHealthyProviderIds([]);
          setStartupHealth({
            healthy: [],
            first: null,
            sourceIds: [],
            sourceIdsByProvider: {},
            backendByProvider: {},
            byProvider: {},
          });
          verifiedSourceIdsByProvider.current = {};
          verifiedBackendByProvider.current = {};
          setMessage('未配置可用音源，已跳过启动推荐');
          await reveal();
          return;
        }
        if (!homeRevealed)
          setStartup({
            visible: true,
            label: '正在检测可用平台',
            progress: 0.48,
          });
        resetLaunchBackendPools();
        if (homeRevealed)
          releaseStartupPrewarm = urlPrewarmScheduler.current!.hold();
        const healthSession = startPlatformHealthDetection(
          launchState.platforms,
          launchState.sources,
          '128k',
          launchState.settings.multiSourceDetection,
          health => {
            if (!sourceGenerationIsCurrent()) return;
            applyPlatformHealth(health);
            console.info(
              '[startup-health-progress]',
              JSON.stringify({
                healthy: health.healthy,
                first: health.first,
                pending: health.pending,
                completed: health.completed,
              }),
            );
          },
        );
        // The same probes publish bindings after reveal without replaying startup.
        healthSession.completed.catch(() => undefined);
        const [platformHealth] = await Promise.all([
          healthSession.firstPassed,
          keepStageVisible(420),
        ]);
        if (!sourceGenerationIsCurrent()) return;
        const startupProviders = platformHealth.first
          ? [platformHealth.first]
          : [];
        console.info(
          '[startup-health]',
          JSON.stringify({
            healthy: startupProviders,
            failed: Object.entries(platformHealth.byProvider)
              .filter(([, status]) => status?.passed !== true)
              .map(([providerId]) => providerId),
          }),
        );
        const provider = startupProviders[0] ?? null;
        if (!provider) {
          setMessage('没有通过播放链路检测的平台，已跳过启动推荐');
          await reveal();
          return;
        }
        if (
          !launchState.settings.startupAutoplay ||
          startupAutoplayCancelled.current
        ) {
          // With startup autoplay disabled there is no startup playback
          // session. Keep the logical/native queues empty so Home has no mini
          // player until the user explicitly selects a song.
          await reveal();
          return;
        }
        if (homeRevealed && queueGeneration.current !== startupGeneration)
          return;
        if (!homeRevealed)
          setStartup({
            visible: true,
            label: '正在生成默认模式推荐',
            progress: 0.66,
          });
        console.info(
          '[startup-sequence]',
          JSON.stringify({
            stage: 'mix-start',
            providers: startupProviders.length,
          }),
        );
        const [mix] = await Promise.all([
          loadHomeMenuFirstBatch(
            'mode-default',
            launchState.platforms
              .filter(platform => platform.id === provider)
              .map(platform => ({ ...platform, enabled: true })),
            {
              ...launchState.profile,
              favoriteStatistics: favoriteStatisticsFor(launchState),
            },
            launchState.history,
            {
              signal: catalogAbort.signal,
              progress: advanceExhaustedMenuRound(
                menuProgressEntry(
                  launchState.menuRecommendationProgress,
                  'mode-default',
                  provider,
                ),
              ),
            },
          ),
          keepStageVisible(520),
        ]);
        if (!sourceGenerationIsCurrent()) return;
        console.info(
          '[startup-sequence]',
          JSON.stringify({ stage: 'mix-ready', tracks: mix.tracks.length }),
        );
        if (startupAutoplayCancelled.current) {
          await reveal();
          return;
        }
        if (!mix.tracks[0]) throw new Error('默认模式没有可用歌曲');
        rememberHomeMenuBatch(mix.cursor, mix.tracks);
        // Preserve the original URL-only choice before shared selected-song
        // preparation. The splash never creates a native queue or starts audio.
        releaseStartupPrewarm ??= urlPrewarmScheduler.current!.hold();
        if (!homeRevealed)
          setStartup({
            visible: true,
            label: '正在为您准备歌曲',
            progress: 0.82,
          });
        const resolvedFirst = await selectFirstResolvableTrack(
          mix.tracks.slice(0, QUEUE_BATCH_SIZE),
          async track => {
            const playUrl = await resolvePlaybackAddress(
              track,
              startupRuntime.current.playbackSourcesFor(track),
              playbackNetworkQuality(launchState.settings),
            );
            // Keep this URL-only result in the shared process cache. The
            // selected-song path validates it before revealing Home and
            // admitting the one-song native queue.
            return { ...track, playUrl };
          },
          {
            budgetMs: STARTUP_FIRST_RESOLVE_BUDGET_MS,
            attemptTimeoutMs: STARTUP_FIRST_RESOLVE_ATTEMPT_MS,
          },
        );
        if (!sourceGenerationIsCurrent()) return;
        if (startupAutoplayCancelled.current) {
          await reveal();
          return;
        }
        let startupSource: QueueSource = {
          kind: 'home-menu',
          startup: true,
          cursor: mix.cursor,
          hasMore: mix.hasMore,
          ...(mix.hasMore
            ? {
                initialMenuBatch: {
                  remaining: QUEUE_BATCH_SIZE - resolvedFirst.tracks.length,
                  artists: [
                    ...new Set(
                      resolvedFirst.tracks.flatMap(item =>
                        constituentArtists(item.artist),
                      ),
                    ),
                  ],
                },
              }
            : {}),
        };
        const startupTracks: Track[] = resolvedFirst.tracks.slice(
          0,
          QUEUE_BATCH_SIZE,
        );
        if (startupSource.kind === 'home-menu') {
          startupSource = {
            ...startupSource,
            seenKeys: startupTracks.map(trackQueueKey),
          };
        }
        // A short catalog page still has a playable selected song. The shared
        // post-PLAYING pagination path fills it without blocking startup or
        // discarding this page when a later directory request fails.
        if (!sourceGenerationIsCurrent()) return;
        if (AppState.currentState !== 'active') {
          await reveal();
          return;
        }
        if (queueGeneration.current !== startupGeneration) return;
        // The shared selected-song path validates and retries while the splash
        // remains visible. Its native-load barrier reveals Home only after a
        // song is ready, then loads immediately after Home's display commit.
        await startFeedRef.current(resolvedFirst.selected, startupTracks, 0, {
          openPlayer: false,
          queueSource: startupSource,
          allowFailureFallback: true,
          startupPlayback: {
            sourceGeneration,
            beforeNativeLoad: () => reveal(true),
          },
        });
        if (!homeRevealed && sourceGenerationIsCurrent()) await reveal();
      } catch (error) {
        if (!sourceGenerationIsCurrent()) return;
        console.info(
          '[startup-sequence]',
          JSON.stringify({
            stage: 'failed',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        setMessage(sanitizeStartupError(error));
        await reveal();
      } finally {
        releaseStartupPrewarm?.();
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      catalogAbort.abort();
      timers.forEach(timer => clearTimeout(timer));
      pendingWaits.forEach(finish => finish());
    };
  }, [applyPlatformHealth, patchState, ready, rememberHomeMenuBatch]);
  const playTrack = useCallback(
    async (
      track: Track,
      tracks: Track[] = [track],
      index?: number,
      options?: PlayTrackOptions,
      source: QueueSource | null = null,
      preserveQueueOrder = false,
    ) => {
      const generation = ++queueGeneration.current;
      const resumePosition = undefined;
      expiredUrlRequest.current?.abort.abort();
      // A tap from the visible bottom-player queue may omit queueSource. Keep
      // that queue's continuation cursor when the supplied list is the current
      // logical catalog, so selecting a metadata-only entry cannot detach
      // pagination from playback.
      if (!source && !preserveQueueOrder) {
        const currentLogical = logicalQueueRef.current;
        const isCurrentLogicalQueue =
          tracks.length === currentLogical.length &&
          tracks.every(
            (item, itemIndex) =>
              trackQueueKey(item) === trackQueueKey(currentLogical[itemIndex]!),
          );
        if (isCurrentLogicalQueue) source = queuePaging.current?.source ?? null;
      }
      const initialMenuQueue =
        source?.kind === 'home-menu' && Boolean(source.initialMenuBatch);
      const onDemand =
        initialMenuQueue ||
        options?.bulkPlay === true ||
        (options?.navigationToken !== undefined &&
          options?.openPlayer === false) ||
        options?.openPlayer !== false ||
        pageRef.current === 'player' ||
        pageRef.current === 'queue' ||
        queueListOpenRef.current;
      if (!preserveQueueOrder) {
        playerQueuePreparation.current.reset();
        queueReversedRef.current = false;
        setQueueReversed(false);
      }
      playerRequestAbort.current?.abort();
      const startupPlayback = isStartupQueueSource(source)
        ? options?.startupPlayback
        : undefined;
      const requestAbort =
        onDemand || startupPlayback ? new AbortController() : null;
      playerRequestAbort.current = requestAbort;
      let startupPreparationSubscription = startupPlayback
        ? AppState.addEventListener('change', nextState => {
            if (nextState !== 'active') requestAbort?.abort();
          })
        : undefined;
      const releaseStartupPreparation = () => {
        startupPreparationSubscription?.remove();
        startupPreparationSubscription = undefined;
      };
      if (onDemand) qualityRequestVersion.current += 1;
      const requestIsCurrent = () =>
        queueGeneration.current === generation &&
        (!startupPlayback ||
          startupPlayback.sourceGeneration ===
            sourceSelectionGeneration.current) &&
        (options?.navigationToken === undefined ||
          navigationVersion.current === options.navigationToken);
      const selectedKey = trackQueueKey(track);
      const preserveHistoryOrigin =
        preserveQueueOrder &&
        (options?.navigationToken !== undefined ||
          pageRef.current === 'player' ||
          pageRef.current === 'queue' ||
          queueListOpenRef.current);
      const selectedOrigin =
        options?.historyOrigin !== undefined
          ? options.historyOrigin
          : preserveHistoryOrigin
          ? musicEntityRecorder.current.getOrigin()
          : null;
      const catalogGate = { generation, ready: false, key: selectedKey };
      catalogPlaybackGate.current = catalogGate;
      musicEntityRecorder.current.begin(
        generation,
        selectedKey,
        selectedOrigin,
      );
      const sceneQueue = isMenuSceneQueue(source);
      const observeSceneAttempt = sceneQueue && !preserveQueueOrder;
      const priorSceneFailures = new Set(
        sceneQueue
          ? options?.sceneFailedKeys ?? []
          : startupPlayback?.failedKeys ?? [],
      );
      if (scenePlayback.current)
        supersededSceneKey.current = scenePlayback.current.key;
      scenePlayback.current = sceneQueue
        ? {
            generation,
            key: selectedKey,
            started: false,
            paused: false,
            handled: false,
          }
        : null;
      const requestedIndex =
        index ?? tracks.findIndex(item => trackQueueKey(item) === selectedKey);
      const sourceIndex = requestedIndex >= 0 ? requestedIndex : 0;
      // A navigation within this logical queue owns the same directory
      // continuation, even if its selected-song native queue is replaced.
      const continuationContext = preserveQueueOrder
        ? queuePaging.current
        : null;
      const publishPlaybackSource = (nextSource: QueueSource | null) => {
        if (!requestIsCurrent()) return;
        publishQueueOrigin(options?.queueOrigin ?? queueOriginRef.current);
        if (
          continuationContext &&
          queuePaging.current === continuationContext
        ) {
          // A page may have advanced while this song was resolving. Never
          // overwrite that newer cursor with the song's captured source.
          if (
            continuationContext.source === source &&
            nextSource &&
            nextSource !== source
          ) {
            continuationContext.source = nextSource;
            setQueuePage(value => ({ ...value, hasMore: nextSource.hasMore }));
          }
          return;
        }
        setQueueSource(nextSource);
      };
      const retainPublishedTail = (items: Track[]) => {
        if (!continuationContext || queuePaging.current !== continuationContext)
          return items;
        const keys = new Set(items.map(trackQueueKey));
        const published = queuePublishedRef.current ?? logicalQueueRef.current;
        const additional = published.filter(
          item => !keys.has(trackQueueKey(item)),
        );
        return queueReversedRef.current
          ? [...additional, ...items]
          : [...items, ...additional];
      };
      if (options?.navigationToken === undefined) {
        navigationVersion.current += 1;
        navigationPending.current = false;
        navigationCursor.current = sourceIndex;
      }
      const fallbackDepth = options?.fallbackDepth ?? 0;
      let playbackStarted = false;
      let playbackStage: ScenePlaybackStage = 'stop';
      const sceneAttemptStartedAt = Date.now();
      let sceneStageStartedAt = sceneAttemptStartedAt;
      const logSceneStage = (
        stage: string,
        detail: Record<string, unknown> = {},
      ) => {
        console.info(
          '[track-playback-timing]',
          JSON.stringify({
            key: selectedKey,
            generation,
            stage,
            totalMs: Date.now() - sceneAttemptStartedAt,
            ...detail,
          }),
        );
        if (startupPlayback)
          console.info(
            '[startup-playback]',
            JSON.stringify({
              stage,
              provider: track.provider,
              id: track.providerId ?? track.id,
              attempt: fallbackDepth + 1,
              ...detail,
            }),
          );
        if (!observeSceneAttempt || source?.kind !== 'home-menu') return;
        console.info(
          '[menu-scene-timing]',
          JSON.stringify({
            choice: source.cursor.choiceId,
            provider: track.provider,
            stage,
            attempt: fallbackDepth + 1,
            ms: Date.now() - sceneStageStartedAt,
            totalMs: Date.now() - sceneAttemptStartedAt,
            ...detail,
          }),
        );
      };
      const sceneTiming: PlaybackTimingObserver = (stage, detail) =>
        logSceneStage(stage, detail);
      logSceneStage('selected');
      const markSceneStarted = () => {
        if (catalogPlaybackGate.current === catalogGate && !catalogGate.ready) {
          catalogGate.ready = true;
        }
        if (catalogPlaybackGate.current === catalogGate)
          urlPrewarmScheduler.current!.setPlaybackReady(true);
        const scene = scenePlayback.current;
        if (scene?.generation === generation && scene.key === selectedKey) {
          scene.started = true;
        }
        startMenuInitialCompletion.current();
      };
      const releasePrewarm = urlPrewarmScheduler.current!.hold();
      urlPrewarmScheduler.current!.setPlaybackReady(false);
      const backgroundReleased = urlPrewarmScheduler.current!.preemptExcept(
        prewarmIdentity(track),
      );
      if (!preserveQueueOrder)
        urlPrewarmScheduler.current!.setQueueOrder([prewarmIdentity(track)]);
      let prewarmReleased = false;
      const releasePrewarmOnce = () => {
        if (prewarmReleased) return;
        prewarmReleased = true;
        releasePrewarm();
      };
      const rememberPlayback = () => {
        if (startupPlayback) return;
        patchState(value => ({
          ...value,
          profile: learn(value.profile, track, 0, false, false),
        }));
      };
      if (options?.navigationToken === undefined && !preserveQueueOrder)
        setQueueSource(null);
      setBusy(true);
      selectedPreparationGeneration.current = generation;
      if (!startupPlayback) setMessage('正在解析可播放音源…');
      try {
        await playerPreparationCommit.current.catch(() => undefined);
        if (!requestIsCurrent()) return;
        if (!options?.providerAlreadyStopped) await nativePlayer.stop();
        if (!requestIsCurrent()) return;
        await backgroundReleased;
        if (!requestIsCurrent()) return;
        playbackStage = 'resolve';
        assertPlaybackSourceBinding(track);
        const remainingTracks = tracks.filter(
          (item, itemIndex) =>
            itemIndex !== sourceIndex &&
            trackQueueKey(item) !== selectedKey &&
            !priorSceneFailures.has(trackQueueKey(item)),
        );
        const pendingQueue = preserveQueueOrder
          ? retainPublishedTail(
              tracks.map((item, itemIndex) =>
                itemIndex === sourceIndex ? track : item,
              ),
            )
          : [track, ...remainingTracks].slice(0, QUEUE_BATCH_SIZE);
        const pendingIndex = preserveQueueOrder
          ? queueIndexForKey(pendingQueue, selectedKey, sourceIndex)
          : 0;
        if (pageRef.current === 'player') {
          pendingDisplay.current = { key: selectedKey, index: pendingIndex };
          const sameLogicalQueue =
            logicalQueueRef.current.length === pendingQueue.length &&
            logicalQueueRef.current.every(
              (item, itemIndex) =>
                trackQueueKey(item) === trackQueueKey(pendingQueue[itemIndex]!),
            );
          if (!sameLogicalQueue) {
            logicalQueueRef.current = pendingQueue;
            queuePublishedRef.current = pendingQueue;
            setQueue(pendingQueue);
            publishQueueOrigin(
              options?.queueOrigin ?? queueOriginRef.current,
              false,
            );
          }
          setPlayer(value => ({
            ...value,
            index: pendingIndex,
            mediaId: selectedKey,
            playing: false,
            position: resumePosition ?? 0,
            duration: track.duration,
            error: null,
          }));
        }
        playbackStage = 'resolve';
        logSceneStage('stop');
        sceneStageStartedAt = Date.now();
        const requestedQuality =
          options?.quality ?? qualityPreferenceRef.current;
        const preparedIndex = queueRef.current.findIndex(
          item =>
            trackQueueKey(item) === selectedKey &&
            Boolean(item.playUrl) &&
            (!localPlaybackReference(track) ||
              localPlaybackReference(item) === localPlaybackReference(track)) &&
            item.metadata?._playbackPreference === requestedQuality &&
            (item.metadata?._playerPreparationSource === undefined ||
              item.metadata._playerPreparationSource ===
                sourceSelectionGeneration.current),
        );
        if (preparedIndex >= 0) {
          playbackStage = 'load';
          if (resumePosition === undefined)
            await nativePlayer.playIndex(preparedIndex);
          else await nativePlayer.playIndex(preparedIndex, resumePosition);
          if (!requestIsCurrent()) return;
          musicEntityRecorder.current.accept(generation, selectedKey);
          pendingDisplay.current = null;
          publishPlaybackSource(source);
          setPlayer(value => ({
            ...value,
            index: queueIndexForKey(
              logicalQueueRef.current,
              selectedKey,
              sourceIndex,
            ),
            mediaId: selectedKey,
            playing: true,
            position: resumePosition ?? 0,
            duration: track.duration,
            error: null,
          }));
          setBusy(false);
          setMessage('');
          rememberPlayback();
          if (options?.openPlayer !== false) setPage('player');
          playbackStage = 'start';
          const playing = nativePlayer.waitForPlaybackStart(
            15000,
            selectedKey,
            requestAbort?.signal,
          );
          if (requestAbort)
            await waitForPlayerRequest(playing, requestAbort.signal);
          else await playing;
          if (!requestIsCurrent()) return;
          playbackStarted = true;
          markSceneStarted();
          actualPlayingKey.current = selectedKey;
          setPlayerPreparationReadyKey(selectedKey);
          return;
        }
        const isPreparedQueue =
          !onDemand &&
          !options?.forceQualityRefresh &&
          tracks.length === queueRef.current.length &&
          tracks.every(
            (item, itemIndex) =>
              trackQueueKey(item) ===
                trackQueueKey(queueRef.current[itemIndex]!) && item.playUrl,
          );
        if (isPreparedQueue) {
          const target = Math.max(
              0,
              index ??
                tracks.findIndex(item => trackQueueKey(item) === selectedKey),
            ),
            playable = await prepare(tracks, requestedQuality);
          if (queueGeneration.current !== generation) return;
          const playableIndex = Math.max(
            0,
            playable.findIndex(item => trackQueueKey(item) === selectedKey),
          );
          playbackStage = 'load';
          if (resumePosition === undefined)
            await nativePlayer.loadQueue(playable, playableIndex, true);
          else
            await nativePlayer.loadQueue(
              playable,
              playableIndex,
              true,
              resumePosition,
            );
          musicEntityRecorder.current.accept(generation, selectedKey);
          playbackStage = 'start';
          await nativePlayer.waitForPlaybackStart();
          playbackStarted = true;
          markSceneStarted();
          if (queueGeneration.current !== generation) return;
          publishPlaybackSource(source);
          queueRef.current = playable;
          setQueue(playable);
          setPlayer(value => ({
            ...value,
            index: playableIndex,
            playing: true,
            position: resumePosition ?? 0,
            duration: playable[playableIndex]?.duration ?? 0,
            error: null,
          }));
          setMessage(
            target !== playableIndex
              ? '部分音源不可用，已从首个可播放条目开始'
              : '',
          );
          rememberPlayback();
          if (options?.openPlayer !== false) setPage('player');
          return;
        }
        const mainPlayerSelection =
          onDemand && preserveQueueOrder && pageRef.current === 'player';
        const prepareSelected = () =>
          prepareTrack(
            track,
            requestedQuality,
            false,
            sceneTiming,
            options?.navigationToken === undefined,
          );
        const selectedRequest = mainPlayerSelection
          ? playerQueuePreparation.current.select(
              track,
              `${requestedQuality}:${
                sourceSelectionGeneration.current
              }:${sourceResolutionCacheToken()}`,
              prepareSelected,
            )
          : prepareSelected();
        const selected = requestAbort
            ? await waitForPlayerRequest(selectedRequest, requestAbort.signal)
            : await selectedRequest,
          keepCurrentOrder = preserveQueueOrder,
          logicalQueue = keepCurrentOrder
            ? retainPublishedTail(
                tracks.map((item, itemIndex) =>
                  itemIndex === sourceIndex ? selected : item,
                ),
              )
            : [selected, ...remainingTracks].slice(0, QUEUE_BATCH_SIZE),
          logicalSelectedIndex = keepCurrentOrder
            ? queueIndexForKey(logicalQueue, selectedKey, sourceIndex)
            : 0,
          queueSourceWithRemainder =
            !keepCurrentOrder && remainingTracks.length > QUEUE_BATCH_SIZE - 1
              ? withQueueRemainder(
                  source,
                  remainingTracks.slice(QUEUE_BATCH_SIZE - 1),
                )
              : source;
        if (!requestIsCurrent()) return;
        logSceneStage('selected-preparation');
        sceneStageStartedAt = Date.now();
        onDemandPlayerQueue.current = onDemand;
        if (onDemand)
          await nativePlayer.setRepeatMode(
            state?.settings.repeat === 'one' ? 'one' : 'off',
          );
        if (!requestIsCurrent()) return;
        if (startupPlayback) {
          if (
            AppState.currentState !== 'active' ||
            requestAbort?.signal.aborted
          )
            return;
          const homeReady = startupPlayback.beforeNativeLoad();
          if (requestAbort)
            await waitForPlayerRequest(homeReady, requestAbort.signal);
          else await homeReady;
          if (
            !requestIsCurrent() ||
            AppState.currentState !== 'active' ||
            requestAbort?.signal.aborted
          )
            return;
          releaseStartupPreparation();
        }
        playbackStage = 'load';
        if (resumePosition === undefined)
          await nativePlayer.loadQueue([selected], 0, true);
        else await nativePlayer.loadQueue([selected], 0, true, resumePosition);
        if (!requestIsCurrent()) return;
        musicEntityRecorder.current.accept(generation, selectedKey);
        logSceneStage('native-accepted');
        sceneStageStartedAt = Date.now();
        // Failed initial attempts may have removed catalog entries before
        // the first successful native acceptance. Size only this new scene's
        // initial remainder from the logical batch actually being published.
        const acceptedQueueSource =
          initialMenuQueue &&
          !preserveQueueOrder &&
          !continuationContext &&
          queueSourceWithRemainder?.kind === 'home-menu' &&
          queueSourceWithRemainder.initialMenuBatch
            ? {
                ...queueSourceWithRemainder,
                initialMenuBatch: {
                  ...queueSourceWithRemainder.initialMenuBatch,
                  remaining: QUEUE_BATCH_SIZE - logicalQueue.length,
                },
              }
            : queueSourceWithRemainder;
        pendingDisplay.current = null;
        // The bottom player is a logical catalog queue as well as a native
        // Media3 queue. Publish its metadata immediately after the selected
        // one-song queue accepts play, while keeping unresolved neighbours out
        // of Media3 until the existing post-PLAYING validation step completes.
        queueRef.current = [selected];
        setQueue(logicalQueue);
        logicalQueueRef.current = logicalQueue;
        queuePublishedRef.current = logicalQueue;
        // Publish the continuation cursor with the logical queue. A second
        // tap during native hydration must still be recognized as belonging
        // to this queue instead of losing its paging source.
        publishPlaybackSource(acceptedQueueSource);
        setPlayer(value => ({
          ...value,
          index: logicalSelectedIndex,
          mediaId: trackQueueKey(selected),
          playing: true,
          position: resumePosition ?? 0,
          duration: selected.duration,
          error: null,
        }));
        if (!startupPlayback)
          setMessage(
            options?.navigationToken === undefined ? '正在启动播放…' : '',
          );
        setBusy(false);
        rememberPlayback();
        if (options?.openPlayer !== false) setPage('player');
        playbackStage = 'start';
        if (onDemand && requestAbort) {
          await waitForPlayerRequest(
            nativePlayer.waitForPlaybackStart(
              15000,
              trackQueueKey(selected),
              requestAbort.signal,
            ),
            requestAbort.signal,
          );
          if (!requestIsCurrent()) return;
          playbackStarted = true;
          logSceneStage('actual-playing');
          markSceneStarted();
          setMessage('');
          actualPlayingKey.current = trackQueueKey(selected);
          setPlayerPreparationReadyKey(trackQueueKey(selected));
          enqueueUrlPrewarm(
            'queue',
            logicalQueueRef.current.filter(
              item => trackQueueKey(item) !== selectedKey,
            ),
          );
          releasePrewarmOnce();
          void prefetchQueueAt(logicalSelectedIndex).catch(() => undefined);
          return;
        }
        // Native loadQueue resolves after issuing prepare/play. Wait until
        // Media3 reports real playback before background audio validation may
        // compete with the selected track's initial buffering.
        if (startupPlayback && requestAbort)
          await waitForPlayerRequest(
            nativePlayer.waitForPlaybackStart(
              15000,
              selectedKey,
              requestAbort.signal,
            ),
            requestAbort.signal,
          );
        else await nativePlayer.waitForPlaybackStart();
        if (!requestIsCurrent()) return;
        playbackStarted = true;
        if (startupPlayback) logSceneStage('actual-playing');
        markSceneStarted();
        setMessage('');
        onDemandPlayerQueue.current = true;
        actualPlayingKey.current = trackQueueKey(selected);
        setPlayerPreparationReadyKey(trackQueueKey(selected));
        enqueueUrlPrewarm(
          'queue',
          logicalQueueRef.current.filter(
            item => trackQueueKey(item) !== selectedKey,
          ),
        );
        releasePrewarmOnce();
        void prefetchQueueAt(logicalSelectedIndex).catch(() => undefined);
      } catch (error) {
        if (error instanceof PlayerRequestCancelled || !requestIsCurrent())
          return;
        logSceneStage('failed', { failedStage: playbackStage });
        if (
          !startupPlayback &&
          !playbackStarted &&
          isSourceBindingUnavailable(error)
        ) {
          pendingDisplay.current = null;
          if (catalogPlaybackGate.current === catalogGate)
            catalogPlaybackGate.current = null;
          if (scenePlayback.current?.generation === generation)
            scenePlayback.current.handled = true;
          setMessage(PLATFORM_UNBOUND_MESSAGE);
          setPlayer(value => ({
            ...value,
            playing: false,
            error: PLATFORM_UNBOUND_MESSAGE,
          }));
          // A platform failure must not reject every song, advance the bulk
          // list, or clear its metadata. The original stop already completed.
          if (options?.navigationToken !== undefined) throw error;
          return;
        }
        const failedKeys = new Set(
          sceneQueue
            ? options?.sceneFailedKeys ?? []
            : startupPlayback?.failedKeys ?? [],
        );
        if (startupPlayback) failedKeys.add(selectedKey);
        if (sceneQueue) {
          failedKeys.add(selectedKey);
          console.warn(
            '[scene-playback-error]',
            JSON.stringify({
              scene: source?.kind === 'home-menu' ? source.cursor.choiceId : '',
              provider: track.provider,
              id: track.providerId ?? track.id,
              stage: playbackStage,
              attempt: fallbackDepth + 1,
              message: scenePlaybackFailure(playbackStage, error),
            }),
          );
        }
        if (options?.bulkPlay && !playbackStarted)
          options.onUnavailableTrack?.(selectedKey);
        if (
          queueGeneration.current === generation &&
          !playbackStarted &&
          (sceneQueue ||
            options?.bulkPlay === true ||
            options?.allowFailureFallback === true ||
            options?.navigationToken !== undefined) &&
          (options?.bulkPlay
            ? tracks.length > 1
            : fallbackDepth < PLAYER_FAILURE_FALLBACK_LIMIT)
        ) {
          const direction = options?.failureDirection ?? 1;
          let nextIndex = sourceIndex + direction;
          while (
            nextIndex >= 0 &&
            nextIndex < tracks.length &&
            (trackQueueKey(tracks[nextIndex]!) === selectedKey ||
              (sceneQueue &&
                failedKeys.has(trackQueueKey(tracks[nextIndex]!))) ||
              (startupPlayback &&
                failedKeys.has(trackQueueKey(tracks[nextIndex]!))) ||
              isRuntimeTrackBlocked(tracks[nextIndex]!))
          )
            nextIndex += direction;
          if (nextIndex >= tracks.length) nextIndex = -1;
          if (nextIndex >= 0) {
            const nextTrack = tracks[nextIndex]!;
            const nextTracks = options?.bulkPlay
              ? tracks.filter(item => trackQueueKey(item) !== selectedKey)
              : tracks;
            const nextSource = options?.queueSource ?? source ?? undefined;
            await startFeedRef.current(
              nextTrack,
              nextTracks,
              options?.bulkPlay
                ? nextTracks.findIndex(
                    item => trackQueueKey(item) === trackQueueKey(nextTrack),
                  )
                : nextIndex,
              {
                ...options,
                providerAlreadyStopped: false,
                fallbackDepth: fallbackDepth + 1,
                ...(sceneQueue ? { sceneFailedKeys: [...failedKeys] } : {}),
                ...(startupPlayback
                  ? {
                      startupPlayback: {
                        ...startupPlayback,
                        failedKeys: [...failedKeys],
                      },
                    }
                  : {}),
                queueSource:
                  options?.bulkPlay && nextSource
                    ? sourceWithSeenKeys(nextSource, [selectedKey])
                    : nextSource,
              },
            );
            return;
          }
        }
        if (queueGeneration.current === generation && !playbackStarted) {
          pendingDisplay.current = null;
          if (startupPlayback) {
            await nativePlayer.stop().catch(() => undefined);
            if (!requestIsCurrent()) return;
            queueRef.current = [];
            logicalQueueRef.current = [];
            queuePublishedRef.current = null;
            actualPlayingKey.current = '';
            onDemandPlayerQueue.current = false;
            catalogPlaybackGate.current = null;
            setPlayerPreparationReadyKey('');
            setQueue([]);
            publishQueueOrigin(null);
            setQueueSource(null);
            urlPrewarmScheduler.current!.setQueueOrder([]);
            // Startup has no selected queue left. Home-visible audio validation
            // retains its existing independent entry behaviour after reveal.
            urlPrewarmScheduler.current!.setPlaybackReady(true);
            setPlayer(value => ({
              ...value,
              index: 0,
              mediaId: '',
              playing: false,
              position: 0,
              duration: 0,
              error: null,
            }));
            throw error;
          }
          console.warn(
            '[track-playback-error]',
            JSON.stringify({
              provider: track.provider,
              id: track.providerId ?? track.id,
              message: error instanceof Error ? error.message : String(error),
            }),
          );
          setMessage(
            options?.bulkPlay
              ? '当前已加载歌曲均无法播放，请稍后重试'
              : sceneQueue
              ? `场景歌曲连续播放失败，已停止自动尝试（${scenePlaybackFailure(
                  playbackStage,
                  error,
                )}）`
              : isTrackPlaybackRejected(error)
              ? error instanceof Error
                ? error.message
                : '该歌曲无法播放，已从列表移除'
              : libraryLocalPlaybackFailure(track, error) ??
                '当前歌曲没有可播放的在线音源',
          );
          if (sceneQueue) {
            const failedScene = scenePlayback.current;
            if (failedScene?.generation === generation)
              failedScene.handled = true;
            setPlayer(value => ({
              ...value,
              playing: false,
              error: scenePlaybackFailure(playbackStage, error),
            }));
          } else if (options?.bulkPlay) {
            queueRef.current = [];
            logicalQueueRef.current = [];
            queuePublishedRef.current = null;
            setQueue([]);
            setQueueSource(null);
            publishQueueOrigin(null);
            setPlayer(value => ({
              ...value,
              playing: false,
              index: 0,
              position: 0,
              mediaId: null,
              error: '当前已加载歌曲均无法播放，请稍后重试',
            }));
          } else if (localPlaybackReference(track)) {
            setPlayer(value => ({
              ...value,
              playing: false,
              error: libraryLocalPlaybackFailure(track, error),
            }));
          }
          if (sceneQueue)
            throw new Error(
              `场景歌曲连续播放失败，已停止自动尝试（${scenePlaybackFailure(
                playbackStage,
                error,
              )}）`,
            );
          if (onDemand && options?.navigationToken !== undefined) throw error;
        }
      } finally {
        if (selectedPreparationGeneration.current === generation)
          selectedPreparationGeneration.current = null;
        releaseStartupPreparation();
        if (
          startupPlayback &&
          !playbackStarted &&
          requestIsCurrent() &&
          !queueRef.current.length &&
          catalogPlaybackGate.current === catalogGate
        ) {
          catalogPlaybackGate.current = null;
          urlPrewarmScheduler.current!.setPlaybackReady(true);
        }
        if (requestIsCurrent()) setBusy(false);
        if (playerRequestAbort.current === requestAbort)
          playerRequestAbort.current = null;
        releasePrewarmOnce();
      }
    },
    [
      assertPlaybackSourceBinding,
      patchState,
      prepare,
      prepareTrack,
      enqueueUrlPrewarm,
      prewarmIdentity,
      prefetchQueueAt,
      setQueueSource,
      publishQueueOrigin,
      state?.settings.repeat,
    ],
  );
  const setPlaybackPlaying = useCallback(
    async (shouldPlay: boolean) => {
      if (!shouldPlay) {
        startupAutoplayCancelled.current = true;
        expiredUrlRequest.current?.abort.abort();
        playerRequestAbort.current?.abort();
        playerQueuePreparation.current.pause();
        if (selectedPreparationGeneration.current !== null) {
          selectedPreparationGeneration.current = null;
          queueGeneration.current += 1;
          navigationVersion.current += 1;
          navigationPending.current = false;
          pendingDisplay.current = null;
          setBusy(false);
        }
      }
      if (scenePlayback.current) {
        scenePlayback.current.paused = !shouldPlay;
        if (!shouldPlay) {
          // Cancel a scene start/navigation too; pausing must not admit a later
          // failed-start fallback after the user's explicit pause.
          playerRequestAbort.current?.abort();
          navigationVersion.current += 1;
          navigationPending.current = false;
        }
      }
      if (shouldPlay) {
        if (!current) return;
        await nativePlayer.play();
      } else await nativePlayer.pause();
      // Do not invert a possibly newer polling/event value. The native action
      // above has one explicit target state, so commit that same target.
      setPlayer(value => ({ ...value, playing: shouldPlay }));
    },
    [current],
  );
  const togglePlay = useCallback(
    () => setPlaybackPlaying(!player.playing),
    [setPlaybackPlaying, player.playing],
  );
  const notify = useCallback((value: string) => setMessage(value), []);
  // Keep the serialized controller current before React renders the next queued operation.
  const patchEqualizerSettings = useCallback(
    (update: (settings: AppSettings) => AppSettings) => {
      const current = equalizerState.current;
      if (current)
        equalizerState.current = {
          ...current,
          settings: update(current.settings),
        };
      patchState(value => ({ ...value, settings: update(value.settings) }));
    },
    [patchState],
  );
  const applyEqualizer = useCallback(
    async (preset: EqualizerPreset) => {
      await equalizerUpdates.request(async () => {
        try {
          const currentSettings = equalizerState.current?.settings;
          const tuning = presetTuning(preset);
          if (!currentSettings) return false;
          const general = readEffects(currentSettings);
          const override =
            preset === 'Custom'
              ? undefined
              : currentSettings.effectUserOverrides?.[`preset:${preset}`];
          const effectivePreset = override ? 'Custom' : preset;
          const gains =
            override?.gains ??
            (preset === 'Custom' ? general.gains : undefined);
          const configuration = AudioEffectStateManager.configuration(
            override?.advanced ??
              (preset === 'Custom' ? general.advanced : tuning.advanced),
          );
          await nativePlayer.setEqualizer(
            effectivePreset,
            gains,
            configuration,
          );
          appliedEqualizerKey.current = JSON.stringify([
            effectivePreset,
            gains,
            configuration,
          ]);
          patchEqualizerSettings(settings =>
            commitEffects(
              settings,
              {
                equalizer: effectivePreset,
                gains:
                  override?.gains ??
                  (preset === 'Custom' ? general.gains : tuning.gains),
                advanced: configuration.advanced,
                sceneId: override ? `preset:${preset}` : undefined,
              },
              'general',
            ),
          );
          setMessage(`已启用${equalizerPresetLabels[preset]}`);
          return true;
        } catch (error) {
          setMessage(error instanceof Error ? error.message : '音效应用失败');
          return false;
        }
      });
    },
    [patchEqualizerSettings, equalizerUpdates],
  );
  const applyCustomEqualizer = useCallback(
    async (gains: number[], savedId?: string, options?: EffectApplyOptions) => {
      if (!validEqualizerGains(gains)) {
        setMessage('需要十段 -12 至 +12 dB 的有效参数');
        return false;
      }
      const requestedGains = [...gains];
      return equalizerUpdates.request(async () => {
        try {
          const currentSettings = equalizerState.current?.settings;
          if (!currentSettings) return false;
          const scope = effectScope(options);
          if (
            options?.expectedTargetKey &&
            effectEditingTarget(currentSettings, scope).key !==
              options.expectedTargetKey
          ) {
            setMessage('当前音效已改变或删除，请重新打开编辑器');
            return false;
          }
          const retained = readEffects(currentSettings, scope);
          const savedPreset = savedId
            ? currentSettings.customEqualizerPresets?.find(
                preset =>
                  preset.id === savedId && savedEffectHasScope(preset, scope),
              )
            : undefined;
          const override = options?.sceneId
            ? currentSettings.effectUserOverrides?.[options.sceneId]
            : undefined;
          const effectiveGains = override?.gains ?? requestedGains;
          const configuration = AudioEffectStateManager.configuration(
            override?.advanced ??
              options?.advanced ??
              (savedPreset && savedPreset.advanced === undefined
                ? undefined
                : retained.advanced),
            scope === 'general'
              ? undefined
              : options && 'headphone' in options
              ? options.headphone ?? undefined
              : retained.headphone,
          );
          const sceneId =
            options?.sceneId ??
            (options?.preserveIdentity
              ? retained.sceneId ??
                (retained.equalizer !== 'Custom'
                  ? `preset:${retained.equalizer}`
                  : undefined)
              : undefined);
          await nativePlayer.setEqualizer(
            'Custom',
            effectiveGains,
            configuration,
          );
          appliedEqualizerKey.current = JSON.stringify([
            'Custom',
            effectiveGains,
            configuration,
          ]);
          patchEqualizerSettings(settings =>
            commitEffects(
              settings,
              {
                equalizer: 'Custom',
                gains: effectiveGains,
                savedId:
                  savedId ??
                  (options?.preserveIdentity ? retained.savedId : undefined),
                advanced: configuration.advanced,
                headphone: configuration.headphone,
                sceneId,
              },
              scope,
            ),
          );
          if (!options?.live) setMessage('已启用自定义音效');
          return true;
        } catch (error) {
          setMessage(error instanceof Error ? error.message : '音效应用失败');
          return false;
        }
      }, !options?.live);
    },
    [patchEqualizerSettings, equalizerUpdates],
  );
  const flushEqualizerUpdates = useCallback(
    () => equalizerUpdates.flush(),
    [equalizerUpdates],
  );
  const persistEqualizerEdit = useCallback(
    async (
      update: (settings: AppSettings) => AppSettings,
      successMessage: string,
      target?: EffectEditTarget,
    ): Promise<boolean> => {
      const current = equalizerState.current;
      if (!current) return false;
      if (target && !effectTargetMatches(current.settings, target)) {
        setMessage('当前音效已改变或删除，请重新打开编辑器');
        return false;
      }
      let applied = false;
      try {
        const settings = update(current.settings);
        const configuration = AudioEffectStateManager.configuration(
          settings.customEqualizerAdvanced,
          settings.headphoneCalibration,
        );
        const gains =
          settings.equalizer === 'Custom'
            ? settings.customEqualizerGains
            : undefined;
        await nativePlayer.setEqualizer(
          settings.equalizer,
          gains,
          configuration,
        );
        applied = true;
        if (
          target &&
          (!equalizerState.current ||
            !effectTargetMatches(equalizerState.current.settings, target))
        )
          throw new Error('当前音效已改变或删除，请重新打开编辑器');
        if (persistTimer.current) clearTimeout(persistTimer.current);
        await saveState({ ...current, settings });
        const latest = equalizerState.current;
        if (
          target &&
          (!latest || !effectTargetMatches(latest.settings, target))
        ) {
          // Legacy deletion can finish while storage is awaiting its native bridge.
          // Restore that newer persisted state before rejecting the stale edit.
          await saveState(latest ?? current);
          throw new Error('当前音效已改变或删除，请重新打开编辑器');
        }
        appliedEqualizerKey.current = JSON.stringify([
          settings.equalizer,
          gains,
          configuration,
        ]);
        patchEqualizerSettings(update);
        setMessage(successMessage);
        return true;
      } catch (error) {
        if (applied) {
          const old = equalizerState.current?.settings ?? current.settings;
          const configuration = AudioEffectStateManager.configuration(
            old.customEqualizerAdvanced,
            old.headphoneCalibration,
          );
          const gains =
            old.equalizer === 'Custom' ? old.customEqualizerGains : undefined;
          try {
            await nativePlayer.setEqualizer(
              old.equalizer,
              gains,
              configuration,
            );
            appliedEqualizerKey.current = JSON.stringify([
              old.equalizer,
              gains,
              configuration,
            ]);
          } catch {
            appliedEqualizerKey.current = null;
          }
        }
        setMessage(error instanceof Error ? error.message : '音效保存失败');
        return false;
      }
    },
    [patchEqualizerSettings],
  );
  const commitEqualizerEdit = useCallback(
    async (
      target: EffectEditTarget,
      gains: number[],
      advanced?: AdvancedEffects,
      part: 'equalizer' | 'advanced' = 'equalizer',
    ) => {
      if (!validEqualizerGains(gains)) {
        setMessage('需要十段 -12 至 +12 dB 的有效参数');
        return false;
      }
      const requestedGains = [...gains];
      let requestedAdvanced: AdvancedEffects | undefined;
      try {
        requestedAdvanced = advanced
          ? AudioEffectStateManager.configuration(advanced).advanced
          : undefined;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '高级音效参数无效');
        return false;
      }
      const capturedTarget = {
        ...target,
        scope: target.scope === 'general' ? target.scope : { ...target.scope },
      };
      return equalizerUpdates.request(async () => {
        const current = equalizerState.current?.settings;
        if (!current || !effectTargetMatches(current, capturedTarget)) {
          setMessage('当前音效已改变或删除，请重新打开编辑器');
          return false;
        }
        const retained = readEffects(current, capturedTarget.scope);
        const configuration = AudioEffectStateManager.configuration(
          requestedAdvanced ?? retained.advanced,
          retained.headphone,
        );
        const snapshot = {
          ...retained,
          equalizer: 'Custom' as const,
          gains: requestedGains,
          advanced: configuration.advanced,
          sceneId:
            capturedTarget.kind === 'preset' || capturedTarget.kind === 'scene'
              ? capturedTarget.id
              : retained.sceneId,
        };
        const update = (settings: AppSettings): AppSettings => {
          let next = commitEffects(settings, snapshot, capturedTarget.scope);
          if (capturedTarget.kind === 'saved') {
            next = {
              ...next,
              customEqualizerPresets: settings.customEqualizerPresets?.map(
                preset =>
                  preset.id === capturedTarget.id
                    ? part === 'advanced'
                      ? { ...preset, advanced: configuration.advanced }
                      : { ...preset, gains: [...requestedGains] }
                    : preset,
              ),
            };
          } else if (
            capturedTarget.kind === 'scene' ||
            capturedTarget.kind === 'preset'
          ) {
            const id = capturedTarget.id!;
            const original =
              settings.effectUserOverrides?.[id] ??
              (capturedTarget.kind === 'scene'
                ? [...zeusScenes, ...gtoScenes].find(scene => scene.id === id)!
                : presetTuning(id.slice(7)));
            const override =
              part === 'advanced'
                ? { gains: original.gains, advanced: configuration.advanced }
                : { gains: requestedGains, advanced: original.advanced };
            next = {
              ...next,
              effectUserOverrides: normalizeEffectUserOverrides({
                ...settings.effectUserOverrides,
                [id]: override,
              }),
            };
          }
          return next;
        };
        return persistEqualizerEdit(
          update,
          `已更新${capturedTarget.name}`,
          capturedTarget,
        );
      });
    },
    [equalizerUpdates, persistEqualizerEdit],
  );
  const saveEqualizerDraft = useCallback(
    async (
      name: string,
      gains: number[],
      category: EqualizerPresetCategory,
      scope: EffectScope = 'general',
      advanced?: AdvancedEffects,
    ) => {
      const requestedGains = [...gains];
      let requestedAdvanced: AdvancedEffects | undefined;
      try {
        requestedAdvanced = advanced
          ? AudioEffectStateManager.configuration(advanced).advanced
          : undefined;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '高级音效参数无效');
        return false;
      }
      const capturedScope = scope === 'general' ? scope : { ...scope };
      const initial = equalizerState.current?.settings;
      if (!initial) return false;
      const capturedTarget = effectEditingTarget(initial, capturedScope);
      return equalizerUpdates.request(async () => {
        try {
          const current = equalizerState.current?.settings;
          if (!current) return false;
          if (!effectTargetMatches(current, capturedTarget))
            throw new Error('当前音效已改变或删除，请重新打开编辑器');
          const title = name.trim().slice(0, 32);
          const existing = current.customEqualizerPresets ?? [];
          if (
            existing.some(
              preset =>
                preset.name === title &&
                savedEffectHasScope(preset, capturedScope),
            )
          )
            throw new Error('同名音效已存在，请使用其他名称');
          const selected = readEffects(current, capturedScope);
          const configuration = AudioEffectStateManager.configuration(
            requestedAdvanced,
            capturedScope === 'general' ? undefined : selected.headphone,
          );
          const created = storeEqualizerPreset(
            existing,
            name,
            requestedGains,
            category,
            requestedAdvanced ? configuration : undefined,
            capturedScope,
          ).saved;
          const saved = {
            ...created,
            ...(configuration.headphone
              ? { headphone: configuration.headphone }
              : {}),
          };
          return persistEqualizerEdit(
            settings => ({
              ...commitEffects(
                settings,
                {
                  equalizer: 'Custom',
                  gains: requestedGains,
                  advanced: configuration.advanced,
                  headphone: configuration.headphone,
                  savedId: saved.id,
                },
                capturedScope,
              ),
              customEqualizerPresets: [
                ...(settings.customEqualizerPresets ?? []),
                saved,
              ],
            }),
            `已保存${saved.name}`,
            capturedTarget,
          );
        } catch (error) {
          setMessage(error instanceof Error ? error.message : '音效保存失败');
          return false;
        }
      });
    },
    [equalizerUpdates, persistEqualizerEdit],
  );
  const saveCustomEqualizer = useCallback(
    async (
      name: string,
      gains: number[],
      category: EqualizerPresetCategory = '自定义',
      scope: EffectScope = 'general',
    ) => {
      try {
        const currentState = equalizerState.current;
        if (!currentState) return false;
        const selected = readEffects(currentState.settings, scope);
        const { presets, saved } = storeEqualizerPreset(
          currentState.settings.customEqualizerPresets ?? [],
          name,
          gains,
          category,
          AudioEffectStateManager.configuration(
            selected.advanced,
            scope === 'general' ? undefined : selected.headphone,
          ),
          scope,
        );
        const nextState = {
          ...currentState,
          settings: {
            ...currentState.settings,
            customEqualizerPresets: presets,
          },
        };
        await saveState(nextState);
        // Publish only after the existing storage service confirms persistence.
        patchState(value => ({
          ...value,
          settings: { ...value.settings, customEqualizerPresets: presets },
        }));
        setMessage(`已保存${saved.name}`);
        return true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '音效保存失败');
        return false;
      }
    },
    [patchState],
  );
  const deleteCustomEqualizer = useCallback(
    async (id: string) => {
      try {
        const currentState = equalizerState.current;
        if (!currentState) return false;
        const presets = deleteEqualizerPreset(
          currentState.settings.customEqualizerPresets ?? [],
          id,
        );
        if (
          presets.length ===
          (currentState.settings.customEqualizerPresets ?? []).length
        )
          return false;
        const nextState = {
          ...currentState,
          settings: {
            ...forgetSavedEffect(currentState.settings, id),
            customEqualizerPresets: presets,
            customEqualizerPresetId:
              currentState.settings.customEqualizerPresetId === id
                ? undefined
                : currentState.settings.customEqualizerPresetId,
          },
        };
        await saveState(nextState);
        patchState(value => ({
          ...value,
          settings: {
            ...forgetSavedEffect(value.settings, id),
            customEqualizerPresets: presets,
            customEqualizerPresetId:
              value.settings.customEqualizerPresetId === id
                ? undefined
                : value.settings.customEqualizerPresetId,
          },
        }));
        setMessage('已删除自定义音效');
        return true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '音效删除失败');
        return false;
      }
    },
    [patchState],
  );
  const setPlaybackMode = useCallback(
    async (mode: PlaybackMode) => {
      const next = playbackModeSettings(mode);
      if (next.shuffle) await discardFuturePreparation(true);
      await Promise.all([
        nativePlayer.setShuffle(next.shuffle),
        nativePlayer.setRepeatMode(
          onDemandPlayerQueue.current && next.repeat !== 'one'
            ? 'off'
            : next.repeat,
        ),
      ]);
      if (playbackSettings.current)
        playbackSettings.current = { ...playbackSettings.current, ...next };
      patchState(value => ({
        ...value,
        settings: { ...value.settings, ...next },
      }));
    },
    [patchState, discardFuturePreparation],
  );
  const jump = useCallback(
    (direction: -1 | 1, automaticTarget?: number) => {
      expiredUrlRequest.current?.abort.abort();
      if (!logicalQueueRef.current.length) return Promise.resolve();
      const wasPending = navigationPending.current;
      const selectedLogicalIndex =
        onDemandPlayerQueue.current && queueRef.current.length === 1
          ? logicalQueueRef.current.findIndex(
              track =>
                trackQueueKey(track) === trackQueueKey(queueRef.current[0]!),
            )
          : -1;
      const base = wasPending
        ? navigationCursor.current
        : selectedLogicalIndex >= 0
        ? selectedLogicalIndex
        : player.index;
      const requestVersion = ++navigationVersion.current;
      const requestedTarget =
        automaticTarget ??
        manualPlayerTarget(
          base,
          logicalQueueRef.current.length,
          direction,
          playbackSettings.current ?? { shuffle: false, repeat: 'off' },
        );
      const playerNavigation =
        pageRef.current === 'player' ||
        pageRef.current === 'queue' ||
        queueListOpenRef.current;
      if (playerNavigation || onDemandPlayerQueue.current) {
        playerRequestAbort.current?.abort();
        qualityRequestVersion.current += 1;
        setBusy(false);
      }
      navigationPending.current = true;
      navigationCursor.current = requestedTarget;
      const releasePriority = urlPrewarmScheduler.current!.hold();
      urlPrewarmScheduler.current!.setPlaybackReady(false);
      const requestedTrack = logicalQueueRef.current[requestedTarget];
      const backgroundReleased = urlPrewarmScheduler.current!.preemptExcept(
        requestedTrack ? prewarmIdentity(requestedTrack) : undefined,
      );
      const run = async () => {
        if (navigationVersion.current !== requestVersion) return;
        queueGeneration.current += 1;
        musicEntityRecorder.current.navigate(
          queueGeneration.current,
          logicalQueueRef.current[requestedTarget]
            ? trackQueueKey(logicalQueueRef.current[requestedTarget]!)
            : '',
        );
        playerQueuePreparation.current.pause();
        if (scenePlayback.current) {
          supersededSceneKey.current = scenePlayback.current.key;
          scenePlayback.current = {
            ...scenePlayback.current,
            generation: queueGeneration.current,
            started: false,
            handled: true,
          };
        }
        await playerPreparationCommit.current.catch(() => undefined);
        if (navigationVersion.current !== requestVersion) return;
        await nativePlayer.stop();
        if (navigationVersion.current !== requestVersion) return;
        await backgroundReleased;
        if (navigationVersion.current !== requestVersion) return;
        let target = requestedTarget;
        let skipped = 0;
        while (skipped < 8) {
          if (target < 0) {
            if (
              !queueReversedRef.current ||
              direction !== -1 ||
              !queuePaging.current?.source.hasMore
            )
              break;
            const anchor = logicalQueueRef.current[0];
            if (!anchor) break;
            const anchorKey = trackQueueKey(anchor);
            void loadMoreQueue().catch(() => undefined);
            await queuePageReadyRequest.current?.catch(() => undefined);
            if (navigationVersion.current !== requestVersion) return;
            const shifted = logicalQueueRef.current.findIndex(
              item => trackQueueKey(item) === anchorKey,
            );
            if (shifted <= 0) break;
            target = shifted - 1;
          }
          const logical = queuePublishedRef.current ?? logicalQueueRef.current;
          const displayTarget = logical[target];
          musicEntityRecorder.current.navigate(
            queueGeneration.current,
            displayTarget ? trackQueueKey(displayTarget) : '',
          );
          if (pageRef.current === 'player' && displayTarget) {
            const displayKey = trackQueueKey(displayTarget);
            pendingDisplay.current = { key: displayKey, index: target };
            setPlayer(value => ({
              ...value,
              index: target,
              mediaId: displayKey,
              playing: false,
              position: 0,
              duration: displayTarget.duration,
              error: null,
            }));
          }
          const hasMore = Boolean(
            !queueReversedRef.current &&
              (queuePage.hasMore || queuePaging.current?.source.hasMore),
          );
          if (target >= logical.length) {
            // React state may still be committing the metadata publication while
            // the native queue already contains the first validated batch.
            if (target < queueRef.current.length) {
              const targetNativeTrack = queueRef.current[target];
              const qualityReady =
                Boolean(targetNativeTrack?.playUrl) &&
                targetNativeTrack?.metadata?._playbackPreference ===
                  qualityPreferenceRef.current;
              if (!qualityReady) {
                await playTrack(
                  queueRef.current[target]!,
                  queueRef.current,
                  target,
                  {
                    openPlayer: false,
                    queueSource: queuePaging.current?.source,
                    navigationToken: requestVersion,
                    providerAlreadyStopped: true,
                    forceQualityRefresh: true,
                    failureDirection: direction,
                  },
                  queuePaging.current?.source ?? null,
                  true,
                );
                if (navigationVersion.current !== requestVersion) return;
                navigationCursor.current = target;
                return;
              }
              try {
                const preparedGate = {
                  generation: queueGeneration.current,
                  ready: false,
                  key: trackQueueKey(targetNativeTrack!),
                  preparedAccepted: false,
                };
                catalogPlaybackGate.current = preparedGate;
                if (isMenuSceneQueue(queuePaging.current?.source)) {
                  scenePlayback.current = {
                    generation: queueGeneration.current,
                    key: trackQueueKey(targetNativeTrack!),
                    started: false,
                    paused: false,
                    handled: false,
                  };
                }
                await nativePlayer.playIndex(target);
                preparedGate.preparedAccepted = true;
                if (navigationVersion.current === requestVersion)
                  musicEntityRecorder.current.accept(
                    queueGeneration.current,
                    trackQueueKey(targetNativeTrack!),
                  );
                if (isMenuSceneQueue(queuePaging.current?.source)) {
                  await nativePlayer.waitForPlaybackStart(
                    15000,
                    trackQueueKey(targetNativeTrack!),
                  );
                  if (navigationVersion.current !== requestVersion) return;
                  if (scenePlayback.current)
                    scenePlayback.current.started = true;
                  if (catalogPlaybackGate.current === preparedGate) {
                    preparedGate.ready = true;
                    urlPrewarmScheduler.current!.setPlaybackReady(true);
                  }
                }
                if (navigationVersion.current !== requestVersion) return;
                navigationCursor.current = target;
                setPlayer(value => ({
                  ...value,
                  index: target,
                  mediaId: playerNavigation
                    ? trackQueueKey(targetNativeTrack!)
                    : value.mediaId,
                  playing: true,
                  position: 0,
                  error: null,
                }));
                return;
              } catch {
                if (isMenuSceneQueue(queuePaging.current?.source)) {
                  if (navigationVersion.current !== requestVersion) return;
                  await nativePlayer.stop();
                  skipped += 1;
                  target += direction;
                  navigationCursor.current = target;
                  continue;
                }
              }
            }
            if (direction !== 1 || !hasMore) break;
            const initialMenuPage =
              queuePaging.current?.source.kind === 'home-menu' &&
              Boolean(queuePaging.current.source.initialMenuBatch);
            loadMoreQueue();
            const pending = queuePageReadyRequest.current;
            if (pending) {
              if (initialMenuPage) await pending.catch(() => undefined);
              else
                await Promise.race([
                  pending.catch(() => undefined),
                  waitForQueueProgress(),
                ]);
              if (navigationVersion.current !== requestVersion) return;
              await Promise.resolve();
              if (
                initialMenuPage &&
                target >=
                  (queuePublishedRef.current ?? logicalQueueRef.current).length
              )
                break;
              continue;
            }
            break;
          }
          const targetKey = trackQueueKey(logical[target]!);
          const nativeIndex = queueRef.current.findIndex(
            track => trackQueueKey(track) === targetKey,
          );
          const nativeTrack =
            nativeIndex >= 0 ? queueRef.current[nativeIndex] : null;
          const qualityReady =
            Boolean(nativeTrack?.playUrl) &&
            nativeTrack?.metadata?._playbackPreference ===
              qualityPreferenceRef.current &&
            (nativeTrack?.metadata?._playerPreparationSource === undefined ||
              nativeTrack.metadata._playerPreparationSource ===
                sourceSelectionGeneration.current);
          if (nativeIndex < 0 || !qualityReady) {
            await playTrack(
              logical[target]!,
              logical,
              target,
              {
                openPlayer: false,
                queueSource: queuePaging.current?.source,
                navigationToken: requestVersion,
                providerAlreadyStopped: true,
                forceQualityRefresh: true,
                failureDirection: direction,
              },
              queuePaging.current?.source ?? null,
              true,
            );
            if (navigationVersion.current !== requestVersion) return;
            navigationCursor.current = target;
            return;
          }
          try {
            const preparedGate = {
              generation: queueGeneration.current,
              ready: false,
              key: targetKey,
              preparedAccepted: false,
            };
            catalogPlaybackGate.current = preparedGate;
            if (isMenuSceneQueue(queuePaging.current?.source)) {
              scenePlayback.current = {
                generation: queueGeneration.current,
                key: targetKey,
                started: false,
                paused: false,
                handled: false,
              };
            }
            await nativePlayer.playIndex(nativeIndex);
            preparedGate.preparedAccepted = true;
            if (navigationVersion.current === requestVersion)
              musicEntityRecorder.current.accept(
                queueGeneration.current,
                targetKey,
              );
            pendingDisplay.current = null;
            console.info(
              '[player-navigation]',
              JSON.stringify({
                at: Date.now(),
                key: targetKey,
                path: 'prepared',
                preference: qualityPreferenceRef.current,
                quality: nativeTrack?.metadata?._playbackQuality,
              }),
            );
            if (
              pageRef.current === 'player' ||
              isMenuSceneQueue(queuePaging.current?.source)
            ) {
              const gateAbort = new AbortController();
              playerRequestAbort.current = gateAbort;
              await waitForPlayerRequest(
                nativePlayer.waitForPlaybackStart(
                  15000,
                  targetKey,
                  gateAbort.signal,
                ),
                gateAbort.signal,
              );
              if (navigationVersion.current !== requestVersion) return;
              if (scenePlayback.current) scenePlayback.current.started = true;
              if (catalogPlaybackGate.current === preparedGate) {
                preparedGate.ready = true;
                urlPrewarmScheduler.current!.setPlaybackReady(true);
              }
              actualPlayingKey.current = targetKey;
              setPlayerPreparationReadyKey(targetKey);
              if (playerRequestAbort.current === gateAbort)
                playerRequestAbort.current = null;
            }
            if (navigationVersion.current !== requestVersion) return;
            navigationCursor.current = target;
            setPlayer(value => ({
              ...value,
              index: target,
              mediaId: playerNavigation ? targetKey : value.mediaId,
              playing: true,
              position: 0,
              error: null,
            }));
            return;
          } catch {
            if (isMenuSceneQueue(queuePaging.current?.source)) {
              if (navigationVersion.current !== requestVersion) return;
              await nativePlayer.stop();
            }
            skipped += 1;
            target += direction;
            navigationCursor.current = target;
          }
        }
        const reachedQueueEnd =
          direction === 1 &&
          skipped === 0 &&
          target >=
            (queuePublishedRef.current ?? logicalQueueRef.current).length &&
          target >= queueRef.current.length &&
          !(queuePaging.current?.error ?? queuePage.error) &&
          (queueReversedRef.current ||
            !(queuePaging.current?.source.hasMore ?? queuePage.hasMore));
        const reachedQueueStart =
          direction === -1 &&
          skipped === 0 &&
          target < 0 &&
          !(queuePaging.current?.error ?? queuePage.error) &&
          (!queueReversedRef.current ||
            !(queuePaging.current?.source.hasMore ?? queuePage.hasMore));
        if (navigationVersion.current === requestVersion)
          setMessage(
            reachedQueueEnd
              ? '已到播放列表末尾'
              : reachedQueueStart
              ? '当前已是第一首歌啦'
              : direction === 1
              ? '后续歌曲暂时都无法播放'
              : '前面的歌曲暂时都无法播放',
          );
      };
      const request =
        !playerNavigation &&
        !onDemandPlayerQueue.current &&
        playbackFlight.current
          ? playbackFlight.current.catch(() => undefined).then(run)
          : run();
      playbackFlight.current = request.catch(() => undefined);
      const flight = playbackFlight.current;
      void flight.then(() => {
        if (playbackFlight.current === flight) playbackFlight.current = null;
      });
      void request.then(
        () => {
          releasePriority();
          if (navigationVersion.current === requestVersion) {
            navigationPending.current = false;
            void prefetchQueueRuntime
              .current(navigationCursor.current)
              .catch(() => undefined);
          }
        },
        () => {
          releasePriority();
          if (navigationVersion.current === requestVersion)
            navigationPending.current = false;
        },
      );
      return request;
    },
    [
      loadMoreQueue,
      playTrack,
      prewarmIdentity,
      player.index,
      queuePage.error,
      queuePage.hasMore,
      waitForQueueProgress,
    ],
  );
  const next = useCallback(() => jump(1), [jump]),
    previous = useCallback(() => jump(-1), [jump]);
  advanceFailedScene.current = (index, error) => {
    const scene = scenePlayback.current;
    if (!scene || !isMenuSceneQueue(queuePaging.current?.source)) return;
    console.warn(
      '[scene-playback-error]',
      JSON.stringify({
        key: scene.key,
        stage: 'playing',
        message: scenePlaybackFailure('playing', new Error(error)),
      }),
    );
    if (index + 1 >= logicalQueueRef.current.length) {
      setMessage(
        `场景队列没有下一首可尝试的歌曲（${scenePlaybackFailure(
          'playing',
          new Error(error),
        )}）`,
      );
      return;
    }
    // Reuse stop -> resolve selected -> actual PLAYING, without wrapping to
    // the failed song or fetching additional pages merely to evade the limit.
    jump(1, index + 1).catch(() => undefined);
  };
  advanceEndedPlayer.current = index => {
    if (!state) return;
    const target = automaticPlayerTarget(
      index,
      logicalQueueRef.current.length,
      !queueReversedRef.current && Boolean(queuePaging.current?.source.hasMore),
      state.settings,
    );
    if (target !== null) jump(1, target).catch(() => undefined);
  };
  const queueRestoreRuntime = useRef({
    prepareTrack,
    recommendationPlatforms,
    setQueueSource,
    repeatMode,
  });
  queueRestoreRuntime.current = {
    prepareTrack,
    recommendationPlatforms,
    setQueueSource,
    repeatMode,
  };
  const queuePreparationReady =
    player.playing ||
    Boolean(
      (page === 'queue' || queueListOpen) &&
        queueRef.current[0] &&
        actualPlayingKey.current === trackQueueKey(queueRef.current[0]),
    );
  // Partial native coverage still needs the existing logical-tail continuation.
  useEffect(() => {
    if (
      page !== 'player' &&
      queuePreparationReady &&
      onDemandPlayerQueue.current &&
      queueRef.current.length > 1 &&
      logicalQueueRef.current.length >= 2 &&
      !shuffle &&
      autoNext !== false &&
      logicalQueueRef.current.every(track =>
        queueRef.current.some(
          item => trackQueueKey(item) === trackQueueKey(track),
        ),
      )
    ) {
      onDemandPlayerQueue.current = false;
      nativePlayer
        .setRepeatMode(queueRestoreRuntime.current.repeatMode ?? 'off')
        .catch(() => undefined);
    }
    return undefined;
  }, [
    page,
    queuePreparationReady,
    current,
    queue.length,
    queueListOpen,
    shuffle,
    autoNext,
  ]);
  const preparationCacheToken = sourceResolutionCacheToken();
  const currentPreparationKey = current ? trackQueueKey(current) : '';
  useEffect(() => {
    const key = currentPreparationKey;
    const preparationOwner = playerQueuePreparation.current;
    if (!key || !queueRef.current.some(item => trackQueueKey(item) === key))
      return;
    const generation = queueGeneration.current;
    const navigation = navigationVersion.current;
    const sourceGeneration = sourceSelectionGeneration.current;
    const preferred = qualityPreferenceRef.current;
    const cacheToken = sourceResolutionCacheToken();
    const orderVersion = queuePreparationVersion.current;
    const nativeForwardEnabled =
      !state?.settings.shuffle && state?.settings.autoNext !== false;
    const context = `${preferred}:${sourceGeneration}:${cacheToken}`;
    let cancelled = false;
    const isCurrent = () =>
      !cancelled &&
      generation === queueGeneration.current &&
      navigation === navigationVersion.current &&
      sourceGeneration === sourceSelectionGeneration.current &&
      preferred === qualityPreferenceRef.current &&
      cacheToken === sourceResolutionCacheToken() &&
      orderVersion === queuePreparationVersion.current &&
      !navigationPending.current &&
      (!actualPlayingKey.current || actualPlayingKey.current === key);
    const matches = (track: Track) =>
      Boolean(track.playUrl) &&
      track.metadata?._playbackPreference === preferred &&
      track.metadata?._playerPreparationSource === sourceGeneration &&
      preparedNeighbourContexts.current.get(trackQueueKey(track)) === context;
    const serialCommit = (work: () => Promise<boolean>) => {
      const request = playerPreparationCommit.current
        .catch(() => undefined)
        .then(work);
      playerPreparationCommit.current = request.then(
        () => undefined,
        () => undefined,
      );
      return request;
    };
    const synchronize = (track: Track) => {
      const replace = (item: Track) =>
        trackQueueKey(item) === trackQueueKey(track) ? track : item;
      logicalQueueRef.current = logicalQueueRef.current.map(replace);
      if (queuePublishedRef.current)
        queuePublishedRef.current = queuePublishedRef.current.map(replace);
      setQueue(items => items.map(replace));
    };
    const run = async () => {
      // Remove stale or noncontiguous future items before Media3 can auto-next.
      // Played/current entries and the current provider remain untouched.
      const pruned = await serialCommit(async () => {
        if (!isCurrent()) return false;
        const native = await nativePlayer.getState();
        if (!isCurrent() || (native.mediaId && native.mediaId !== key))
          return false;
        const nativeIndex = queueRef.current.findIndex(
          item => trackQueueKey(item) === key,
        );
        const logicalIndex = logicalQueueRef.current.findIndex(
          item => trackQueueKey(item) === key,
        );
        if (nativeIndex < 0 || logicalIndex < 0) return false;
        if (!nativeForwardEnabled) {
          await restoreLogicalTailContinuation();
          for (
            let index = queueRef.current.length - 1;
            index >= 0;
            index -= 1
          ) {
            if (
              index === nativeIndex ||
              (!state?.settings.shuffle && index < nativeIndex)
            )
              continue;
            if (!isCurrent()) return false;
            const active = await nativePlayer.getState();
            if (!isCurrent() || (active.mediaId && active.mediaId !== key))
              return false;
            const removed = await nativePlayer.removePreparedQueueItem(
              key,
              trackQueueKey(queueRef.current[index]!),
              index,
            );
            if (!removed) return false;
            queueRef.current = queueRef.current.filter(
              (_, itemIndex) => itemIndex !== index,
            );
          }
          return true;
        }
        const firstInvalid = queueRef.current.findIndex(
          (item, index) =>
            index > nativeIndex &&
            (!matches(item) ||
              trackQueueKey(item) !==
                (logicalQueueRef.current[logicalIndex + index - nativeIndex]
                  ? trackQueueKey(
                      logicalQueueRef.current[
                        logicalIndex + index - nativeIndex
                      ]!,
                    )
                  : '')),
        );
        if (firstInvalid < 0) return true;
        await restoreLogicalTailContinuation();
        if (!isCurrent()) return false;
        for (
          let index = queueRef.current.length - 1;
          index >= firstInvalid;
          index -= 1
        ) {
          if (!isCurrent()) return false;
          const active = await nativePlayer.getState();
          if (!isCurrent() || (active.mediaId && active.mediaId !== key))
            return false;
          const removed = await nativePlayer.removePreparedQueueItem(
            key,
            trackQueueKey(queueRef.current[index]!),
            index,
          );
          if (!removed) return false;
          // Native success must always update the mirror before a waiting navigation.
          queueRef.current = queueRef.current.filter(
            (_, itemIndex) => itemIndex !== index,
          );
        }
        return true;
      });
      if (
        !nativeForwardEnabled ||
        !pruned ||
        !isCurrent() ||
        !player.playing ||
        playerPreparationReadyKey !== key ||
        actualPlayingKey.current !== key ||
        !catalogPlaybackGate.current?.ready
      )
        return;
      const logicalIndex = logicalQueueRef.current.findIndex(
        item => trackQueueKey(item) === key,
      );
      const neighbours = logicalQueueRef.current.slice(
        logicalIndex + 1,
        logicalIndex + 3,
      );
      await preparationOwner.prepareNext(
        neighbours,
        context,
        track =>
          queueRef.current.some(
            item =>
              trackQueueKey(item) === trackQueueKey(track) && matches(item),
          ) ||
          (typeof hasValidatedPlaybackPrewarm === 'function' &&
            hasValidatedPlaybackPrewarm(
              track,
              playbackSourcesFor(track),
              preferred,
            )),
        track => {
          const existing = queueRef.current.find(
            item =>
              trackQueueKey(item) === trackQueueKey(track) && matches(item),
          );
          if (existing)
            return Promise.resolve(
              existing as Track & {
                playUrl: string;
              },
            );
          if (
            !isCurrent() ||
            !hasValidatedPlaybackPrewarm(
              track,
              playbackSourcesFor(track),
              preferred,
            )
          )
            return Promise.reject(new Error('Playback preparation superseded'));
          return prepareTrack(
            { ...track, playUrl: undefined },
            preferred,
            false,
            undefined,
            false,
            true,
          );
        },
        (prepared, active) =>
          serialCommit(async () => {
            if (!isCurrent() || !active()) return false;
            const native = await nativePlayer.getState();
            if (
              !isCurrent() ||
              !active() ||
              !native.playing ||
              (native.mediaId && native.mediaId !== key)
            )
              return false;
            const logical = logicalQueueRef.current;
            const currentIndex = logical.findIndex(
              item => trackQueueKey(item) === key,
            );
            const targetIndex = logical.findIndex(
              item => trackQueueKey(item) === trackQueueKey(prepared),
            );
            const nativeCurrentIndex = queueRef.current.findIndex(
              item => trackQueueKey(item) === key,
            );
            const offset = targetIndex - currentIndex;
            if (
              currentIndex < 0 ||
              nativeCurrentIndex < 0 ||
              offset < 1 ||
              offset > 2
            )
              return false;
            for (let step = 1; step < offset; step += 1) {
              const preceding = queueRef.current[nativeCurrentIndex + step];
              if (
                !preceding ||
                !matches(preceding) ||
                trackQueueKey(preceding) !==
                  trackQueueKey(logical[currentIndex + step]!)
              )
                return false;
            }
            const nativeIndex = queueRef.current.findIndex(
              item => trackQueueKey(item) === trackQueueKey(prepared),
            );
            if (nativeIndex >= 0 && matches(queueRef.current[nativeIndex]!))
              return true;
            if (
              !hasValidatedPlaybackPrewarm(
                prepared,
                playbackSourcesFor(prepared),
                preferred,
              )
            )
              return false;
            const accepted = prepared;
            const insertionIndex = nativeCurrentIndex + offset;
            if (nativeIndex >= 0) {
              if (nativeIndex !== insertionIndex) return false;
              await nativePlayer.replaceQueueItem(nativeIndex, accepted);
              queueRef.current = queueRef.current.map(item =>
                trackQueueKey(item) === trackQueueKey(accepted)
                  ? accepted
                  : item,
              );
            } else {
              await nativePlayer.insertQueueItems(key, insertionIndex, [
                accepted,
              ]);
              const next = [...queueRef.current];
              next.splice(insertionIndex, 0, accepted);
              queueRef.current = next;
            }
            preparedNeighbourContexts.current.set(
              trackQueueKey(accepted),
              context,
            );
            synchronize(accepted);
            console.info(
              '[player-next-two]',
              JSON.stringify({
                current: key,
                target: trackQueueKey(accepted),
                offset,
                actualQuality: accepted.metadata?._playbackQuality,
                preference: preferred,
                nativeCount: queueRef.current.length,
              }),
            );
            return isCurrent() && active();
          }),
        isCurrent,
      );
    };
    void run().catch(() => undefined);
    return () => {
      cancelled = true;
      preparationOwner.pause();
    };
  }, [
    currentPreparationKey,
    player.playing,
    playerPreparationReadyKey,
    queue,
    queueOrderVersion,
    state?.settings.quality,
    state?.settings.wifiQuality,
    state?.settings.shuffle,
    state?.settings.autoNext,
    wifiConnected,
    sourceHealthRevision,
    preparationCacheToken,
    prepareTrack,
    playbackSourcesFor,
    restoreLogicalTailContinuation,
  ]);
  const dislikeTrack = useCallback(
    async (track: Track) => {
      patchState(value => ({
        ...value,
        disliked: value.disliked.includes(track.id)
          ? value.disliked
          : [...value.disliked, track.id],
      }));
      if (current?.id === track.id) await jump(1);
    },
    [current?.id, jump, patchState],
  );
  const seek = useCallback(async (value: number) => {
    await nativePlayer.seek(value);
    setPlayer(currentState => ({ ...currentState, position: value }));
  }, []);
  const changeQuality = useCallback(
    (quality: PersistedState['settings']['quality']) => {
      const qualitySettingKey = isWifiNetwork() ? 'wifiQuality' : 'quality';
      expiredUrlRequest.current?.abort.abort();
      const requestVersion = ++qualityRequestVersion.current;
      // Navigation queued behind this request must use the newest user
      // preference even before React commits the persisted settings update.
      qualityPreferenceRef.current = quality;
      const discardedFuture = discardFuturePreparation();
      // Publish feedback before waiting behind an earlier navigation or
      // quality request. The player sheet must never look inert while the
      // selected source is being resolved.
      setBusy(true);
      setMessage(`正在切换音质：${settingsQualityLabel(quality)}…`);
      const execute = async () => {
        if (requestVersion !== qualityRequestVersion.current) return;
        await discardedFuture.catch(() => undefined);
        if (requestVersion !== qualityRequestVersion.current) return;
        const active = queue[player.index] ?? current;
        if (!state || !active) {
          if (requestVersion === qualityRequestVersion.current) {
            setBusy(false);
            setMessage('');
          }
          return;
        }
        const nativeBefore = await nativePlayer.getState().catch(() => null);
        if (requestVersion !== qualityRequestVersion.current) return;
        const position =
          nativeBefore && Number.isFinite(nativeBefore.position)
            ? nativeBefore.position
            : player.position;
        const wasPlaying = nativeBefore?.playing ?? player.playing;
        const volume =
          nativeBefore && Number.isFinite(nativeBefore.volume)
            ? nativeBefore.volume
            : player.volume;
        let currentCommitted = false;
        try {
          const prepared = await prepareTrack(
            { ...active, playUrl: undefined },
            quality,
          );
          if (requestVersion !== qualityRequestVersion.current) return;
          qualityRevision.current += 1;
          const activeKey = trackQueueKey(active);
          queueGeneration.current += 1;
          const queueGate = catalogPlaybackGate.current;
          if (queueGate?.key === activeKey)
            queueGate.generation = queueGeneration.current;
          // Resolve first while the old source remains audible. The actual
          // replacement is a short pause/prepare/resume window so a quality
          // switch is observable without losing position or play state.
          if (wasPlaying) await nativePlayer.pause();
          if (requestVersion !== qualityRequestVersion.current) return;
          await nativePlayer.replaceCurrent(prepared, position, false);
          if (requestVersion !== qualityRequestVersion.current) return;
          await nativePlayer.setVolume(volume);
          if (requestVersion !== qualityRequestVersion.current) return;
          if (wasPlaying) {
            await nativePlayer.play();
            if (requestVersion !== qualityRequestVersion.current) return;
            await nativePlayer.waitForPlaybackStart();
          }
          if (requestVersion !== qualityRequestVersion.current) return;
          const replaceActive = (item: Track) =>
            trackQueueKey(item) === activeKey ? prepared : item;
          queueRef.current = queueRef.current.map(replaceActive);
          logicalQueueRef.current = logicalQueueRef.current.map(replaceActive);
          if (queuePublishedRef.current)
            queuePublishedRef.current =
              queuePublishedRef.current.map(replaceActive);
          setQueue(value => value.map(replaceActive));
          patchState(value => ({
            ...value,
            settings: { ...value.settings, [qualitySettingKey]: quality },
          }));
          setPlayer(value => ({
            ...value,
            playing: wasPlaying,
            volume,
            position,
            duration: prepared.duration,
            error: null,
          }));
          setMessage(`已切换为 ${settingsQualityLabel(quality)}`);
          setBusy(false);
          currentCommitted = true;
        } catch (error) {
          if (requestVersion !== qualityRequestVersion.current) return;
          // If native replacement failed after the old item was removed,
          // restore its last validated URL and play state before reporting the
          // failure. A failed quality request must not strand the player.
          if (active.playUrl) {
            await nativePlayer
              .replaceCurrent(
                active as Track & {
                  playUrl: string;
                },
                position,
                wasPlaying,
              )
              .catch(() => undefined);
            await nativePlayer.setVolume(volume).catch(() => undefined);
          }
          setPlayer(value => ({ ...value, playing: wasPlaying, volume }));
          setMessage(error instanceof Error ? error.message : '当前音质不可用');
        } finally {
          if (
            requestVersion === qualityRequestVersion.current &&
            !currentCommitted
          )
            setBusy(false);
        }
      };
      const request =
        pageRef.current !== 'player' &&
        pageRef.current !== 'queue' &&
        !queueListOpenRef.current &&
        playbackFlight.current
          ? playbackFlight.current.catch(() => undefined).then(execute)
          : execute();
      playbackFlight.current = request.catch(() => undefined);
      return request;
    },
    [
      current,
      patchState,
      player.index,
      player.playing,
      player.position,
      player.volume,
      prepareTrack,
      discardFuturePreparation,
      queue,
      state,
    ],
  );
  useEffect(() => {
    if (
      (queuePaging.current?.source.kind === 'home-menu' &&
        queuePaging.current.source.initialMenuBatch) ||
      !player.playing ||
      !queue.length ||
      !queuePage.hasMore ||
      queuePage.loading ||
      queuePage.error
    )
      return;
    void prefetchQueueAt(player.index).catch(() => undefined);
  }, [
    prefetchQueueAt,
    player.index,
    player.playing,
    queue.length,
    queueListOpen,
    queueReversed,
    queuePage,
  ]);
  // Other queue entries remain logical metadata until the user selects one.
  // Full native validation is owned exclusively by playTrack for the target.
  const toggleFavorite = useCallback(
    (track: Track, favorite?: boolean) =>
      patchState(value => {
        const kind = trackMediaKind(track);
        const chooseFavorites = (favorites: string[]) => {
          const wasFavorite = favorites.includes(track.id);
          const targetFavorite =
            typeof favorite === 'boolean' ? favorite : !wasFavorite;
          return targetFavorite === wasFavorite
            ? favorites
            : targetFavorite
            ? [...favorites, track.id]
            : favorites.filter(id => id !== track.id);
        };
        return {
          ...value,
          savedTracks: rememberTrack(value.savedTracks, track),
          favorites: chooseFavorites(value.favorites),
        };
      }),
    [patchState],
  );
  const isFavorite = useCallback(
    (track: Track) => {
      if (!state) return false;
      const kind = trackMediaKind(track);
      return state.favorites.includes(track.id);
    },
    [state],
  );
  const toggleCollectionFavorite = useCallback(
    (item: CatalogItem) =>
      patchState(value => {
        const key = collectionFavoriteKey(item);
        const kind = collectionMediaKind(item);
        {
          const removing = value.favoriteCollections.includes(key);
          return {
            ...value,
            savedCollections: removing
              ? value.savedCollections.filter(
                  entry => collectionFavoriteKey(entry) !== key,
                )
              : [
                  item,
                  ...value.savedCollections.filter(
                    entry => collectionFavoriteKey(entry) !== key,
                  ),
                ],
            favoriteCollections: removing
              ? value.favoriteCollections.filter(entry => entry !== key)
              : [...value.favoriteCollections, key],
          };
        }
      }),
    [patchState],
  );
  const isCollectionFavorite = useCallback(
    (item: CatalogItem) => {
      if (!state) return false;
      const key = collectionFavoriteKey(item);
      const kind = collectionMediaKind(item);
      return state.favoriteCollections.includes(key);
    },
    [state],
  );
  const resetSearch = useCallback(() => {
    searchGeneration.current += 1;
    setSearch({
      query: '',
      category: 'song',
      provider: 'all',
      page: 1,
      hasNext: false,
      loading: false,
      tracks: [],
      errors: [],
      playlists: [],
    });
  }, []);
  const runSearch = useCallback(
    async (
      query: string,
      provider: 'all' | PlatformSetting['id'] = 'all',
      searchPage = 1,
      searchCategory: SearchCategory = 'song',
      append = false,
    ) => {
      const term = query.trim();
      if (!term) return;
      const generation = ++searchGeneration.current;
      const requestedPage = Math.max(1, Math.floor(searchPage));
      setSearch(previous => ({
        query: term,
        category: searchCategory,
        provider,
        page: requestedPage,
        hasNext: false,
        loading: true,
        tracks:
          append &&
          previous.query === term &&
          previous.category === searchCategory &&
          previous.provider === provider
            ? previous.tracks
            : [],
        errors:
          append &&
          previous.query === term &&
          previous.category === searchCategory &&
          previous.provider === provider
            ? previous.errors
            : [],
        playlists:
          append &&
          previous.query === term &&
          previous.category === searchCategory &&
          previous.provider === provider
            ? previous.playlists
            : [],
      }));
      patchState(value => ({
        ...value,
        searchHistory: [
          term,
          ...value.searchHistory.filter(item => item !== term),
        ].slice(0, 12),
      }));
      try {
        if (
          provider !== 'all' &&
          !recommendationPlatforms.some(item => item.id === provider)
        )
          throw new Error('该平台本次启动播放检测未通过');
        const searchesTracks = ['song', 'artist', 'album'].includes(
          searchCategory,
        );
        const mediaType = 'music' as const;
        const result = searchesTracks
          ? await searchOnline(
              term,
              requestedPage,
              20,
              provider,
              recommendationPlatforms,
              'music',
              12000,
              undefined,
              undefined,
              { recheckKugouEmpty: true },
            )
          : {
              tracks: [],
              errors: [] as string[],
              rawCount: 0,
              providerRawCounts: undefined,
            };
        const searchPlatforms = recommendationPlatforms;
        const playlistResult = searchesTracks
          ? { items: [], errors: [] as string[] }
          : await searchOnlinePlaylists(
              term,
              requestedPage,
              20,
              provider === 'all' ? 'all' : provider,
              searchPlatforms,
              mediaType,
            );
        if (generation !== searchGeneration.current) return;
        const nextTracks = result.tracks;
        const nextPlaylists =
          mediaType === 'music'
            ? playlistResult.items
            : playlistResult.items.filter(
                item => !hasExternalMediaOrigin(item),
              );
        const nextErrors = [...result.errors, ...playlistResult.errors];
        setSearch(previous => ({
          query: term,
          category: searchCategory,
          provider,
          page: requestedPage,
          hasNext: nextTracks.length >= 20 || nextPlaylists.length >= 20,
          queueHasMore:
            searchesTracks &&
            (Number.isFinite(result.rawCount)
              ? Number(result.rawCount) > 0
              : nextTracks.length > 0),
          queueProviderPages: result.providerRawCounts
            ? Object.fromEntries(
                Object.entries(result.providerRawCounts).map(([id, count]) => [
                  id,
                  count === null ? requestedPage : requestedPage + 1,
                ]),
              )
            : undefined,
          loading: false,
          tracks: append ? [...previous.tracks, ...nextTracks] : nextTracks,
          playlists: append
            ? [...previous.playlists, ...nextPlaylists]
            : nextPlaylists,
          errors: append ? [...previous.errors, ...nextErrors] : nextErrors,
        }));
      } catch (error) {
        if (generation !== searchGeneration.current) return;
        setSearch(previous => ({
          query: term,
          category: searchCategory,
          provider,
          page: requestedPage,
          hasNext: false,
          loading: false,
          tracks: append ? previous.tracks : [],
          errors: append
            ? [
                ...previous.errors,
                error instanceof Error ? error.message : '搜索失败',
              ]
            : [error instanceof Error ? error.message : '搜索失败'],
          playlists: append ? previous.playlists : [],
        }));
      }
    },
    [patchState, recommendationPlatforms],
  );
  const clearSearchHistory = useCallback(
    () => patchState(value => ({ ...value, searchHistory: [] })),
    [patchState],
  );
  const removeSearchHistory = useCallback(
    (query: string) =>
      patchState(value => ({
        ...value,
        searchHistory: value.searchHistory.filter(item => item !== query),
      })),
    [patchState],
  );
  const clearHistory = useCallback(
    (kind?: LibraryMediaKind) => {
      patchState(value => {
        if (!kind)
          return {
            ...value,
            history: [],
            musicEntityHistory: [],
          };
        return { ...value, history: [], musicEntityHistory: [] };
      });
      setMessage(
        kind && kind !== 'music' ? '播放记录已清空' : '听歌历史已清空',
      );
    },
    [patchState],
  );
  const clearCache = useCallback(
    async (parts = allCacheCleanupParts) => {
      const nativeParts = parts.filter(
        (part): part is Exclude<CacheCleanupPart, 'runtime'> =>
          part !== 'runtime',
      );
      const result = await clearNativeCache(nativeParts);
      if (parts.includes('local-artwork')) {
        patchState(value =>
          forgetClearedLocalArtwork(value, result.deletedArtworkUris),
        );
      }
      if (parts.includes('runtime')) clearSafeRuntimeCaches();
      if (result.failedFiles)
        throw new Error(`部分缓存未能清理（${result.failedFiles} 项），请重试`);
      const labels = [
        parts.includes('network') ? '网络/网页/图片临时缓存' : '',
        parts.includes('runtime') ? '运行时解析/歌词/封面/取色缓存' : '',
        parts.includes('local-artwork') ? '本地封面文件' : '',
      ].filter(Boolean);
      const details = [
        result.networkEntries ? `临时文件 ${result.networkEntries} 个` : '',
        result.localArtworkFiles
          ? `本地封面 ${result.localArtworkFiles} 个`
          : '',
      ].filter(Boolean);
      setMessage(
        labels.length
          ? `已清理：${labels.join('、')}${
              details.length ? `（${details.join('，')}）` : ''
            }`
          : '未选择清理项',
      );
    },
    [patchState],
  );
  const selectDownloadDirectory = useCallback(async () => {
    const uri = await chooseDownloadDirectory();
    setMessage(uri ? '下载目录已更新' : '未更改下载目录');
  }, []);
  const backupData = useCallback(async () => {
    if (!state) return;
    const uri = await exportStateBackup(state);
    setMessage(uri ? '数据备份已保存' : '已取消备份');
  }, [state]);
  const restoreData = useCallback(async () => {
    const restored = await importStateBackup();
    if (!restored) {
      setMessage('已取消恢复');
      return;
    }
    setState(restored);
    setMessage('数据已从备份恢复');
  }, []);
  const importLocalMusic = useCallback(async () => {
    const tracks = await pickLocalAudioFiles();
    if (!tracks.length) {
      setMessage('未选择本地音乐');
      return;
    }
    patchState(value => ({
      ...value,
      localTracks: [
        ...new Map(
          [
            ...value.localTracks,
            ...tracks.filter(track => track.duration >= 60),
          ].map(track => [track.id, track]),
        ).values(),
      ],
    }));
    setMessage(`已添加 ${tracks.length} 首本地音乐`);
  }, [patchState]);
  const localArtworkRequests = useRef(
    new Map<string, Promise<string | null>>(),
  );
  const refreshLocalMusicArtwork = useCallback(
    async (incoming?: Track[]) => {
      const candidates = (incoming ?? state?.localTracks ?? []).filter(
        track => !track.cover && localPlaybackReference(track),
      );
      if (!candidates.length) return;
      const downloads = state?.downloads ?? [];
      const identities = await queryLocalFileIdentities([
        ...candidates.flatMap(localMusicFileReferences),
        ...downloads.flatMap(entry => [
          entry.id,
          ...localMusicFileReferences(entry.track),
        ]),
      ]).catch(() => ({}));
      for (let offset = 0; offset < candidates.length; offset += 2) {
        const results = await Promise.all(
          candidates.slice(offset, offset + 2).map(async track => {
            const reference = localPlaybackReference(track)!;
            const cover = await resolveLocalMusicArtwork(
              track,
              downloads,
              identities,
              {
                read: selected => {
                  let request = localArtworkRequests.current.get(selected);
                  if (!request) {
                    request = resolveLocalPlaybackReference(
                      selected,
                      queryDownloadStatus,
                    )
                      .then(readLocalAudioArtwork)
                      .catch(() => null)
                      .finally(() =>
                        localArtworkRequests.current.delete(selected),
                      );
                    localArtworkRequests.current.set(selected, request);
                  }
                  return request;
                },
                supplement: selected =>
                  recommendationPlatforms.length
                    ? getLibraryTrackArtwork(selected, recommendationPlatforms)
                    : Promise.resolve([]),
              },
            );
            return { key: trackQueueKey(track), reference, cover };
          }),
        );
        if (!results.some(result => result.cover)) continue;
        patchState(value => {
          let changed = false;
          const localTracks = value.localTracks.map(track => {
            const result = results.find(
              item =>
                item.key === trackQueueKey(track) &&
                item.reference === localPlaybackReference(track),
            );
            if (track.cover || !result?.cover) return track;
            changed = true;
            return { ...track, cover: result.cover };
          });
          return changed ? { ...value, localTracks } : value;
        });
      }
    },
    [patchState, recommendationPlatforms, state?.downloads, state?.localTracks],
  );
  const scanLocalMusic = useCallback(async () => {
    if (Platform.OS === 'android') {
      const permission =
        Number(Platform.Version) >= 33
          ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO
          : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
      const granted = await PermissionsAndroid.request(permission, {
        title: '允许扫描本地音乐',
        message: '需要读取设备音乐文件，才能完成全盘扫描。',
        buttonPositive: '允许',
        buttonNegative: '取消',
      });
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        setMessage('未获得读取本地音乐的权限');
        return;
      }
    }
    const tracks = await scanAllLocalMusic();
    const eligible = tracks.filter(track => track.duration >= 60);
    patchState(value => ({
      ...value,
      localTracks: [
        ...new Map(
          [...value.localTracks, ...eligible].map(track => [track.id, track]),
        ).values(),
      ],
    }));
    void refreshLocalMusicArtwork(eligible).catch(() => undefined);
    setMessage(
      tracks.length
        ? `扫描完成，添加 ${tracks.length} 首音乐`
        : '未发现时长不少于 1 分钟的音乐',
    );
  }, [patchState, refreshLocalMusicArtwork]);
  const addLocalMusicDirectory = useCallback(async () => {
    const tracks = await scanLocalMusicDirectory();
    if (!tracks.length) return;
    const eligible = tracks.filter(track => track.duration >= 60);
    patchState(value => ({
      ...value,
      localTracks: [
        ...new Map(
          [...value.localTracks, ...eligible].map(track => [track.id, track]),
        ).values(),
      ],
    }));
    void refreshLocalMusicArtwork(eligible).catch(() => undefined);
    setMessage(
      eligible.length
        ? `已添加 ${eligible.length} 首本地音乐`
        : '所选目录没有时长不少于 1 分钟的音乐',
    );
  }, [patchState, refreshLocalMusicArtwork]);
  const removeLocalTrack = useCallback(
    async (
      trackId: string,
      removeFromPlaylists: boolean,
      deleteFile = false,
      kind: LibraryMediaKind = 'music',
    ) => {
      const localTracks = state?.localTracks ?? [];
      const track = localTracks.find(item => item.id === trackId);
      if (deleteFile) {
        const reference = track?.playUrl;
        if (!reference) throw new Error('未找到设备文件，记录仍保留');
        const deleted = await deleteLocalFile(reference);
        if (!deleted) throw new Error('未能删除设备文件，记录仍保留');
      }
      patchState(value => {
        return {
          ...value,
          localTracks: value.localTracks.filter(track => track.id !== trackId),
          playlists: removeFromPlaylists
            ? value.playlists.map(playlist => ({
                ...playlist,
                trackIds: playlist.trackIds.filter(id => id !== trackId),
              }))
            : value.playlists,
        };
      });
    },
    [patchState, state],
  );
  const removeDownload = useCallback(
    async (
      trackId: string,
      deleteFile: boolean,
      kind: LibraryMediaKind = 'music',
    ) => {
      const entry =
        state &&
        mediaDownloads(state, kind).find(item => item.track.id === trackId);
      if (!entry) {
        for (const [key, task] of downloadActivityRef.current) {
          if (
            task.track.id === trackId &&
            trackMediaKind(task.track) === kind &&
            task.phase === 'failed'
          )
            downloadActivityRef.current.delete(key);
        }
        setDownloadActivities([...downloadActivityRef.current.values()]);
        return;
      }
      const target = entry.id.startsWith('download:')
        ? entry.id
        : entry.track.playUrl ?? entry.id;
      const identities =
        deleteFile && kind === 'music'
          ? await queryLocalFileIdentities([
              target,
              ...(state?.localTracks ?? []).flatMap(localMusicFileReferences),
            ]).catch(() => ({}))
          : {};
      if (deleteFile) {
        const deleted = await deleteLocalFile(target);
        if (!deleted) throw new Error('未能删除设备文件，记录仍保留');
      }
      patchState(value => ({
        ...value,
        ...removeDownloadedMusic(
          value.localTracks,
          value.downloads,
          entry,
          deleteFile ? target : undefined,
          identities,
        ),
      }));
      downloadActivityRef.current.delete(downloadTrackKey(entry.track));
      setDownloadActivities([...downloadActivityRef.current.values()]);
    },
    [patchState, state],
  );
  const downloadTrack = useCallback(
    async (
      track: Track,
      options?: {
        useLaunchBinding?: boolean;
        usePlaybackUrl?: boolean;
        resolved?: DownloadPreview;
      },
    ) => {
      if (!state) return;
      try {
        const sources = options?.useLaunchBinding
          ? playbackSourcesFor(track)
          : state.sources;
        if (
          options?.useLaunchBinding &&
          !options?.resolved &&
          (track.provider === 'custom' ||
            !verifiedSourceIdsByProvider.current?.[track.provider]?.length ||
            !sources.some(
              source =>
                source.enabled &&
                source.healthy === true &&
                Boolean(source.script),
            ))
        )
          throw new Error('该平台本次检测没有可用的绑定音源，无法下载');
        // A confirmation dialog may have already validated one exact URL. Reuse
        // that URL and its evidence instead of resolving a second stream.
        const activity = downloadActivityRef.current.get(
          downloadTrackKey(track),
        );
        const userTask =
          activity && !['downloaded', 'failed'].includes(activity.phase)
            ? activity
            : undefined;
        const input =
          track.playUrl &&
          track.provider !== 'custom' &&
          (!localPlaybackReference(track) || userTask)
            ? { ...track, playUrl: undefined }
            : track;
        const captured = options?.resolved;
        if (captured && captured.trackKey !== downloadTrackKey(track))
          throw new Error('下载预览与歌曲不匹配，已取消下载');
        if (captured && !captured.url)
          throw new Error('下载预览缺少已验证的播放地址，已取消下载');
        if (captured?.url && !/^https?:\/\//i.test(captured.url))
          throw new Error('下载预览未返回有效播放地址');
        if (
          captured?.audio?.resolvedUrl &&
          captured.audio.resolvedUrl !== captured.url
        )
          throw new Error('下载预览的音频证据与地址不匹配');
        const resolved = captured?.url
          ? {
              url: captured.url,
              reportedQuality: captured.reportedQuality,
              audio: captured.audio,
            }
          : options?.usePlaybackUrl
          ? playbackDownloadSource(track)
          : await resolvePlaybackWithQuality(
              input,
              sources,
              downloadNetworkQuality(state.settings),
            );
        const url = resolved.url;
        const quality = audioQuality(resolved.audio, resolved.reportedQuality);
        if (userTask) publishDownloadActivity({ ...userTask, quality });
        const id = userTask
          ? await downloadAudioWithProgress(
              url,
              track.title,
              track.artist,
              userTask.id,
            )
          : await downloadAudio(url, track.title, track.artist);
        const fileSize = id.startsWith('content:')
          ? positiveBytes(await queryLocalFileSize(id).catch(() => null)) ??
            positiveBytes(
              downloadActivityRef.current.get(downloadTrackKey(track))
                ?.fileSize,
            )
          : undefined;
        patchState(value => {
          const kind = trackMediaKind(track);
          const entry = {
            id,
            track: { ...track, playUrl: id.startsWith('content:') ? id : url },
            status: id.startsWith('content:')
              ? ('downloaded' as const)
              : ('queued' as const),
            createdAt: Date.now(),
            fileSize,
            quality,
          };
          return {
            ...value,
            savedTracks: rememberTrack(value.savedTracks, track),
            ...syncDownloadedMusic(value.localTracks, [
              entry,
              ...value.downloads.filter(item => item.track.id !== track.id),
            ]),
          };
        });
        if (userTask)
          publishDownloadActivity({
            ...downloadActivityRef.current.get(downloadTrackKey(track))!,
            token: id,
            fileSize,
            phase: id.startsWith('content:') ? 'downloaded' : 'queued',
          });
      } catch (error) {
        const task = downloadActivityRef.current.get(downloadTrackKey(track));
        if (task && !['downloaded', 'failed'].includes(task.phase))
          publishDownloadActivity({
            ...task,
            phase: 'failed',
            reason: error instanceof Error ? error.message : '下载失败，请重试',
          });
        throw error;
      }
    },
    [patchState, state, playbackSourcesFor, publishDownloadActivity],
  );
  const downloadsFor = useCallback(
    (kind: LibraryMediaKind) => (state ? mediaDownloads(state, kind) : []),
    [state],
  );
  const prepareDownloadPreview = useCallback(
    async (
      track: Track,
      signal: AbortSignal,
      options?: {
        useLaunchBinding?: boolean;
        usePlaybackUrl?: boolean;
      },
    ): Promise<DownloadPreview> => {
      if (!state) throw new Error('下载设置尚未就绪');
      const preferredQuality = downloadNetworkQuality(state.settings);
      if (options?.usePlaybackUrl) {
        const resolved = playbackDownloadSource(track);
        const header = await queryDownloadHeaders(resolved.url, signal).catch(
          error => {
            if (signal.aborted) throw error;
            return {} as {
              sizeBytes?: number;
            };
          },
        );
        return {
          trackKey: downloadTrackKey(track),
          preferredQuality,
          ...resolved,
          sizeBytes: positiveBytes(header.sizeBytes),
        };
      }
      // The user-authorized download metadata query mirrors the existing caller's
      // download source path; it does not change Home/startup/playback prewarming.
      const sources = options?.useLaunchBinding
        ? playbackSourcesFor(track)
        : state.sources;
      if (
        track.provider === 'custom' ||
        !sources.some(
          source => source.enabled && source.healthy !== false && source.script,
        )
      )
        throw new Error('该平台本次检测没有可用的绑定音源，无法读取下载信息');
      const resolved = await resolveWithImportedSourcePrewarm(
        { ...track, playUrl: undefined },
        sources,
        preferredQuality,
        signal,
      );
      const header: {
        sizeBytes?: number;
      } = await queryDownloadHeaders(resolved.url, signal).catch(error => {
        if (signal.aborted) throw error;
        return {};
      });
      return {
        trackKey: downloadTrackKey(track),
        preferredQuality,
        url: resolved.url,
        quality: resolved.quality,
        reportedQuality: resolved.reportedQuality,
        audio:
          resolved.audio?.resolvedUrl === resolved.url
            ? resolved.audio
            : undefined,
        sizeBytes: positiveBytes(header.sizeBytes),
      };
    },
    [state, playbackSourcesFor],
  );
  const downloadTrackRef = useRef(downloadTrack);
  downloadTrackRef.current = downloadTrack;
  const beginUserDownloads = useCallback(
    (
      tracks: Track[],
      options?: {
        onDownload?: (
          track: Track,
          resolved?: DownloadPreview,
        ) => Promise<void>;
        preferredQuality?: AppSettings['quality'];
        usePlaybackUrl?: boolean;
        resolved?: Record<string, DownloadPreview>;
      },
    ) => {
      const unique = [
        ...new Map(
          tracks.map(track => [downloadTrackKey(track), track]),
        ).values(),
      ];
      const pending = unique.filter(track => {
        const task = downloadActivityRef.current.get(downloadTrackKey(track));
        const queued =
          state &&
          mediaDownloads(state, trackMediaKind(track)).some(
            entry =>
              entry.status === 'queued' &&
              downloadTrackKey(entry.track) === downloadTrackKey(track),
          );
        return (
          !queued &&
          (!task || task.phase === 'failed' || task.phase === 'downloaded')
        );
      });
      const now = Date.now();
      pending.forEach((track, index) =>
        publishDownloadActivity({
          id: `user_download_${now}_${index}`,
          track,
          createdAt: now - unique.indexOf(track),
          phase: 'preparing',
          preferredQuality: options?.preferredQuality,
        }),
      );
      unique
        .filter(track => !pending.includes(track))
        .forEach(track => {
          const task = downloadActivityRef.current.get(downloadTrackKey(track));
          const queued =
            state &&
            mediaDownloads(state, trackMediaKind(track)).find(
              entry =>
                entry.status === 'queued' &&
                downloadTrackKey(entry.track) === downloadTrackKey(track),
            );
          if (task)
            publishDownloadActivity({
              ...task,
              createdAt: now - unique.indexOf(track),
            });
          else if (queued)
            publishDownloadActivity({
              id: queued.id,
              token: queued.id,
              track: queued.track,
              phase: 'queued',
              createdAt: now - unique.indexOf(track),
            });
        });
      if (unique.length) {
        const kind = trackMediaKind(unique[0]);
        setQueueListOpen(false);
        setTab('library');
        setDownloadDestination({
          kind,
          version: ++downloadNavigationVersion.current,
        });
        open('downloads');
      }
      // This loop belongs to the provider, and survives the source row/picker unmount.
      void (async () => {
        for (const track of pending) {
          try {
            if (options?.resolved && !options.resolved[downloadTrackKey(track)])
              throw new Error('本次歌曲未取得可用下载地址，请重试');
            await (options?.usePlaybackUrl
              ? downloadTrackRef.current(track, {
                  usePlaybackUrl: true,
                  resolved: options?.resolved?.[downloadTrackKey(track)],
                })
              : options?.onDownload
              ? options.onDownload(
                  track,
                  options?.resolved?.[downloadTrackKey(track)],
                )
              : downloadTrackRef.current(track, {
                  resolved: options?.resolved?.[downloadTrackKey(track)],
                }));
          } catch (error) {
            const task = downloadActivityRef.current.get(
              downloadTrackKey(track),
            );
            if (task)
              publishDownloadActivity({
                ...task,
                phase: 'failed',
                reason:
                  error instanceof Error ? error.message : '下载失败，请重试',
              });
          }
        }
      })();
    },
    [open, setTab, setQueueListOpen, publishDownloadActivity, state],
  );
  const downloadSizeReads = useRef(new Set<string>());
  const downloadSizeQueue = useRef(
    new Map<string, ReturnType<typeof mediaDownloads>[number]>(),
  );
  const downloadSizeFlight = useRef<Promise<void> | null>(null);
  const refreshDownloadFileSizes = useCallback(
    (entries: ReturnType<typeof mediaDownloads>): Promise<void> => {
      for (const entry of entries) {
        if (
          entry.status !== 'downloaded' ||
          positiveBytes(entry.fileSize) ||
          downloadSizeReads.current.has(entry.id)
        )
          continue;
        downloadSizeReads.current.add(entry.id);
        downloadSizeQueue.current.set(entry.id, entry);
      }
      if (downloadSizeFlight.current) return downloadSizeFlight.current;
      const worker = async () => {
        while (downloadSizeQueue.current.size) {
          const entry = downloadSizeQueue.current.values().next().value!;
          downloadSizeQueue.current.delete(entry.id);
          const reference = /^download:\d+$/.test(entry.id)
            ? entry.id
            : localPlaybackReference(entry.track) ?? entry.id;
          const fileSize = positiveBytes(
            await queryLocalFileSize(reference).catch(() => null),
          );
          if (!fileSize) continue;
          patchState(value => {
            const kind = trackMediaKind(entry.track);
            const update = (items: typeof entries) =>
              items.map(item =>
                item.id === entry.id &&
                downloadTrackKey(item.track) === downloadTrackKey(entry.track)
                  ? { ...item, fileSize }
                  : item,
              );
            return { ...value, downloads: update(value.downloads) };
          });
        }
      };
      const request = Promise.all([worker(), worker()])
        .then(() => undefined)
        .finally(() => {
          if (downloadSizeFlight.current === request)
            downloadSizeFlight.current = null;
        });
      downloadSizeFlight.current = request;
      return request;
    },
    [patchState],
  );
  const addTrackToPlaylist = useCallback(
    (track: Track, playlistId?: string) =>
      patchState(value => {
        const target = playlistId ?? value.playlists[0]?.id;
        if (!target) return value;
        return {
          ...value,
          savedTracks: rememberTrack(value.savedTracks, track),
          playlists: value.playlists.map(playlist =>
            playlist.id === target
              ? {
                  ...playlist,
                  trackIds: playlist.trackIds.includes(track.id)
                    ? playlist.trackIds
                    : [...playlist.trackIds, track.id],
                  updatedAt: Date.now(),
                }
              : playlist,
          ),
        };
      }),
    [patchState],
  );
  const removeTrackFromPlaylist = useCallback(
    (track: Track, playlistId: string) =>
      patchState(value =>
        removeTrackPlaylistMembership(value, track, playlistId),
      ),
    [patchState],
  );
  const openPersonalPlaylist = useCallback(
    (id: string) => {
      if (!state?.playlists.some(item => item.id === id)) {
        setMessage('该歌单已不存在');
        return;
      }
      const navigation: [string, unknown][] = [
        ['library-mode', 'music'],
        ['library-playlist-tab', 'mine'],
        ['library-playlist-opened', id],
      ];
      setQueueListOpen(false);
      setPlayerOverlayOpen(false);
      setTab('library');
      for (const [key, value] of navigation) catalogViewState.set(key, value);
      open('personal-playlist');
      setCatalogRestore(value => ({
        version: value.version + 1,
        keys: navigation.map(([key]) => key),
      }));
    },
    [state?.playlists, catalogViewState, open, setTab, setQueueListOpen],
  );
  const openLinkedPlaylist = useCallback(
    (item: CatalogItem) => {
      const navigation: [string, unknown][] = [
        ['library-mode', 'music'],
        ['library-playlist-tab', 'mine'],
        ['library-detail', item],
        ['library-detail-home-reference', true],
      ];
      setQueueListOpen(false);
      setPlayerOverlayOpen(false);
      setTab('library');
      for (const [key, value] of navigation) catalogViewState.set(key, value);
      open('search-playlist');
      setCatalogRestore(value => ({
        version: value.version + 1,
        keys: navigation.map(([key]) => key),
      }));
    },
    [catalogViewState, open, setTab, setQueueListOpen],
  );
  useEffect(() => {
    const destination = importedPlaylistDestination.current;
    if (!destination || !state) return;
    if ('personalPlaylistId' in destination) {
      if (
        !state.playlists.some(
          value => value.id === destination.personalPlaylistId,
        )
      )
        return;
      importedPlaylistDestination.current = null;
      openPersonalPlaylist(destination.personalPlaylistId);
      return;
    }
    const item = savedPlaylistReference(state, destination);
    if (!item) return;
    importedPlaylistDestination.current = null;
    openLinkedPlaylist(item);
  }, [state, openLinkedPlaylist, openPersonalPlaylist]);
  const isPlaylistSaved = useCallback(
    (preview: PlaylistImportPreview) =>
      Boolean(
        state &&
          (preview.kind === 'personal'
            ? state.playlists.some(
                value =>
                  value.id === preview.id ||
                  Boolean(
                    preview.shareOrigin &&
                      value.shareOrigin === preview.shareOrigin,
                  ),
              )
            : savedPlaylistReference(state, preview)),
      ),
    [state],
  );
  const importPlaylist = useCallback(
    async (preview: PlaylistImportPreview, options?: PlaylistImportOptions) => {
      if (!state) throw new Error('应用尚未就绪');
      if (getStateStorageStatus().readError)
        throw new Error('本地数据读取失败，已阻止保存以保护原始数据');
      if (playlistImportInFlight.current)
        throw new Error('歌单正在保存，请稍候');
      playlistImportInFlight.current = true;
      try {
        const commit = (value: PersistedState) =>
          preview.kind === 'personal'
            ? commitPersonalPlaylistImport(value, preview, options?.overwrite)
            : commitPlaylistImport(value, preview, options?.overwrite);
        const committed = commit(state);
        if (persistTimer.current) {
          clearTimeout(persistTimer.current);
          persistTimer.current = null;
        }
        await saveState(committed, { durable: true });
        try {
          await clearSystemPlaylistClipboard();
        } catch {
          setMessage('歌单已保存，但剪贴板未清空');
        }
        importedPlaylistDestination.current =
          preview.kind === 'personal'
            ? {
                personalPlaylistId: committed.playlists.find(
                  value =>
                    value.id === preview.id ||
                    Boolean(
                      preview.shareOrigin &&
                        value.shareOrigin === preview.shareOrigin,
                    ),
                )!.id,
              }
            : { provider: preview.provider, id: preview.id };
        setState(latestState =>
          latestState ? commit(latestState) : latestState,
        );
      } finally {
        playlistImportInFlight.current = false;
      }
    },
    [state, clearSystemPlaylistClipboard],
  );
  const createPlaylist = useCallback(
    (title?: string) =>
      patchState(value => ({
        ...value,
        playlists: [
          ...value.playlists,
          {
            id: `playlist-${Date.now()}`,
            title: title?.trim() || `新建歌单 ${value.playlists.length + 1}`,
            trackIds: [],
            coverKey: 'ocean',
            private: true,
            updatedAt: Date.now(),
          },
        ],
      })),
    [patchState],
  );
  const renamePlaylist = useCallback(
    (id: string, title: string) => {
      const normalized = title.trim();
      if (!normalized) return;
      patchState(value => ({
        ...value,
        playlists: value.playlists.map(playlist =>
          playlist.id === id
            ? { ...playlist, title: normalized, updatedAt: Date.now() }
            : playlist,
        ),
      }));
    },
    [patchState],
  );
  const renameImportedPlaylist = useCallback(
    (item: CatalogItem, title: string) =>
      patchState(value => renameLinkedPlaylist(value, item, title)),
    [patchState],
  );
  const deleteImportedPlaylist = useCallback(
    (item: CatalogItem) =>
      patchState(value => deleteLinkedPlaylist(value, item)),
    [patchState],
  );
  const deletePlaylist = useCallback(
    (id: string) =>
      patchState(value => ({
        ...value,
        playlists: value.playlists.filter(playlist => playlist.id !== id),
        musicEntityHistory: (value.musicEntityHistory ?? []).filter(
          entry => !('playlistId' in entry) || entry.playlistId !== id,
        ),
      })),
    [patchState],
  );
  const setSetting = useCallback(
    <K extends keyof PersistedState['settings']>(
      key: K,
      value: PersistedState['settings'][K],
    ) => {
      patchState(currentState => ({
        ...currentState,
        settings: { ...currentState.settings, [key]: value },
      }));
    },
    [patchState],
  );
  const invalidateSourceSelection = useCallback(
    (message: string) => {
      sourceSelectionGeneration.current += 1;
      playerQueuePreparation.current.reset();
      void discardFuturePreparation().catch(() => undefined);
      urlPrewarmScheduler.current!.reset();
      resetLaunchBackendPools();
      clearResolvedSourceCache();
      verifiedSourceIdsByProvider.current = {};
      verifiedBackendByProvider.current = {};
      setHealthyProviderIds([]);
      setStartupHealth(null);
      setSourceHealthRevision(value => value + 1);
      setMessage(message);
    },
    [discardFuturePreparation],
  );
  const runSourcePlaybackHealth = useCallback(
    async (
      source: SourceSetting,
      sourceCapabilities: SourceSetting['sourceCapabilities'],
    ) => {
      const checks: NonNullable<SourceSetting['manualPlatformHealth']> = {};
      const enabledPlatforms = (state?.platforms ?? []).filter(
        platform => platform.enabled,
      );
      for (const platform of enabledPlatforms) {
        const key = platformSourceKeys[platform.id];
        const declared =
          source.capabilities?.includes(key) ||
          Boolean(sourceCapabilities?.[key]);
        if (!declared) continue;
        let passed = false;
        try {
          const sample = await loadDesktopHealthSample(platform.id);
          await probeManualSource(
            sample,
            {
              ...source,
              sourceCapabilities,
              healthy: true,
            },
            false,
          );
          passed = true;
        } catch {
          passed = false;
        }
        checks[key] = { passed, checkedAt: Date.now() };
      }
      return checks;
    },
    [state?.platforms],
  );
  const toggleSource = useCallback(
    (id: string) => {
      const selected = state?.sources.find(source => source.id === id);
      if (!selected || !isSourceAuthorized(selected)) {
        setMessage('请先导入有效的音源脚本');
        return;
      }
      patchState(value => ({
        ...value,
        sources: value.sources.map(source =>
          source.id === id ? { ...source, enabled: !source.enabled } : source,
        ),
      }));
      invalidateSourceSelection('音源配置已更新，正在重新检测播放链路');
    },
    [invalidateSourceSelection, patchState, state?.sources],
  );
  const reorderSources = useCallback(
    (ids: string[]) => {
      const current = state?.sources ?? [];
      if (
        ids.length !== current.length ||
        new Set(ids).size !== ids.length ||
        ids.some(id => !current.some(source => source.id === id)) ||
        ids.every((id, index) => current[index]?.id === id)
      )
        return;
      patchState(value => {
        const byId = new Map(value.sources.map(source => [source.id, source]));
        if (ids.length !== byId.size || ids.some(id => !byId.has(id)))
          return value;
        const sources = ids.map(id => byId.get(id)!);
        return { ...value, sources };
      });
      invalidateSourceSelection('音源顺序已更新，正在重新检测播放链路');
    },
    [invalidateSourceSelection, patchState, state?.sources],
  );
  const removeSources = useCallback(
    async (ids: string[]) => {
      const selected = new Set(ids);
      if (!state?.sources.some(source => selected.has(source.id))) return;
      patchState(value => ({
        ...value,
        sources: value.sources.filter(source => !selected.has(source.id)),
      }));
      invalidateSourceSelection('音源已删除，正在重新检测播放链路');
    },
    [invalidateSourceSelection, patchState, state?.sources],
  );
  const togglePlatform = useCallback(
    (id: PlatformSetting['id']) => {
      if (!state?.platforms.some(platform => platform.id === id)) return;
      patchState(value => ({
        ...value,
        platforms: value.platforms.map(platform =>
          platform.id === id
            ? { ...platform, enabled: !platform.enabled }
            : platform,
        ),
      }));
      invalidateSourceSelection('平台配置已更新，正在重新检测播放链路');
    },
    [invalidateSourceSelection, patchState, state?.platforms],
  );
  const importSource = useCallback(async () => {
    const file = await importSourceScript();
    if (!file) return false;
    const block = /^\/\*[\s\S]+?\*\//.exec(file.content)?.[0];
    if (!block) throw new Error('无效的自定义音源：缺少头部注释');
    const metadata = (key: string, max: number) =>
      new RegExp(`^\\s?\\*\\s?@${key}\\s+(.+)$`, 'mi')
        .exec(block)?.[1]
        ?.trim()
        .slice(0, max) ?? '';
    const name = metadata('name', 64);
    if (!name) throw new Error('无效的自定义音源：缺少 @name');
    const version = metadata('version', 64);
    if (
      state?.sources.some(
        source =>
          source.script && source.name === name && source.version === version,
      )
    )
      throw new Error(`已存在相同版本的音源「${name}」`);
    const result = await testImportedSourceScript(file.content);
    // The native tester may return diagnostics containing script/runtime details.
    // Persist only the user-facing health state; source code and raw diagnostics
    // must never cross into the settings UI or persisted source metadata.
    const sourceCapabilities = result.capabilitiesJson
      ? JSON.parse(result.capabilitiesJson)
      : undefined;
    if (!result.ok) throw new Error('检测未通过');
    const importedSource: SourceSetting = {
      id: `source_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      name,
      enabled: true,
      description: metadata('description', 256),
      author: metadata('author', 128),
      homepage: metadata('homepage', 1024),
      version,
      fileName: file.fileName,
      origin: 'imported',
      script: file.content,
      // Initialization proves only the script contract. The playback-chain
      // result is filled immediately below, per platform.
      healthy: undefined,
      capabilities: result.sources,
      sourceCapabilities,
      statusMessage: '脚本格式通过，正在检测播放链路',
    };
    patchState(value => ({
      ...value,
      sources: [importedSource, ...value.sources],
    }));
    // Invalidate immediately after the new source enters persisted state so a
    // still-running launch probe cannot publish the previous source binding.
    invalidateSourceSelection('已导入新音源，正在重新检测播放链路');
    const manualPlatformHealth = await runSourcePlaybackHealth(
      importedSource,
      sourceCapabilities,
    );
    const passed = Object.values(manualPlatformHealth).some(
      check => check.passed,
    );
    patchState(value => ({
      ...value,
      sources: value.sources.map(source =>
        source.id === importedSource.id
          ? {
              ...source,
              healthy: passed,
              manualPlatformHealth,
              statusMessage: passed ? '播放链路检测通过' : '播放链路检测未通过',
            }
          : source,
      ),
    }));
    return true;
  }, [
    invalidateSourceSelection,
    patchState,
    runSourcePlaybackHealth,
    state?.sources,
  ]);
  const testSource = useCallback(
    async (id: string) => {
      const source = state?.sources.find(item => item.id === id);
      if (!source) throw new Error('音源不存在');
      if (!isSourceAuthorized(source))
        throw new Error('请先导入有效的音源脚本');
      if (!source.script) throw new Error('该条目不是自定义音源');
      try {
        const result = await testImportedSourceScript(source.script);
        const sourceCapabilities = result.capabilitiesJson
          ? JSON.parse(result.capabilitiesJson)
          : undefined;
        if (!result.ok) throw new Error('检测未通过');
        const manualPlatformHealth = await runSourcePlaybackHealth(
          { ...source, capabilities: result.sources },
          sourceCapabilities,
        );
        const passed = Object.values(manualPlatformHealth).some(
          check => check.passed,
        );
        if (!passed) throw new Error('检测未通过');
        const sourceStatus = '播放链路检测通过';
        patchState(value => ({
          ...value,
          sources: value.sources.map(item =>
            item.id === id
              ? {
                  ...item,
                  healthy: true,
                  capabilities: result.sources,
                  sourceCapabilities,
                  manualPlatformHealth,
                  statusMessage: sourceStatus,
                }
              : item,
          ),
        }));
        return '检测通过';
      } catch (error) {
        const sourceError = '检测未通过';
        patchState(value => ({
          ...value,
          sources: value.sources.map(item =>
            item.id === id
              ? {
                  ...item,
                  healthy: false,
                  manualPlatformHealth: {},
                  statusMessage: sourceError,
                }
              : item,
          ),
        }));
        throw error;
      }
    },
    [patchState, runSourcePlaybackHealth, state?.sources],
  );
  const setSleepTimer = useCallback(
    async (mode: 'minutes' | 'track', minutes = 0) => {
      await nativePlayer.setSleepTimer(mode, minutes);
      setPlayer(value => ({
        ...value,
        sleepMode: mode,
        sleepDeadline: mode === 'minutes' ? Date.now() + minutes * 60000 : 0,
      }));
      setMessage(
        mode === 'track' ? '将在本曲结束后暂停' : `将在 ${minutes} 分钟后暂停`,
      );
    },
    [],
  );
  const cancelSleepTimer = useCallback(async () => {
    await nativePlayer.cancelSleepTimer();
    setPlayer(value => ({ ...value, sleepMode: 'off', sleepDeadline: 0 }));
    setMessage('播放定时已取消');
  }, []);
  const startFeed = useCallback(
    async (
      track: Track,
      tracks: Track[] = [track],
      index = 0,
      options?: PlayTrackOptions,
    ) => {
      const isCurrentFeed =
        tracks.length === feed.length &&
        tracks.every(
          (item, itemIndex) =>
            trackQueueKey(item) ===
            (feed[itemIndex] ? trackQueueKey(feed[itemIndex]!) : ''),
        );
      const isCurrentQueue =
        tracks.length === logicalQueueRef.current.length &&
        tracks.every(
          (item, itemIndex) =>
            trackQueueKey(item) ===
            (logicalQueueRef.current[itemIndex]
              ? trackQueueKey(logicalQueueRef.current[itemIndex]!)
              : ''),
        );
      const source =
        options?.queueSource ??
        (isCurrentQueue
          ? queuePaging.current?.source ?? null
          : isCurrentFeed
          ? { kind: 'feed' as const, category, page: feedPage, hasMore: true }
          : null);
      await playTrack(
        track,
        tracks,
        index,
        {
          ...options,
          queueOrigin:
            options?.queueOrigin ??
            (isCurrentQueue
              ? queueOriginRef.current ?? undefined
              : isStartupQueueSource(source)
              ? captureQueueOrigin('默认模式', {
                  tab: 'discovery',
                  page: 'root',
                  menuChoiceId: 'mode-default',
                })
              : captureQueueOrigin()),
        },
        source,
        isCurrentQueue &&
          !(isStartupQueueSource(source) && options?.startupPlayback),
      );
    },
    [captureQueueOrigin, category, feed, feedPage, playTrack],
  );
  startFeedRef.current = startFeed;
  const playDefaultTrack = useCallback(async () => {
    if (current) {
      await togglePlay();
      return;
    }
    let available = feed;
    if (!available.length && enabledPlatforms?.length) {
      const request =
        feedLoadRef.current ??
        loadCategoryFeed(category, feedPage, enabledPlatforms);
      feedLoadRef.current = request;
      try {
        const tracks = await request;
        available = tracks.filter(track => !isRuntimeTrackBlocked(track));
        if (available.length) setFeed(available);
      } catch {
        available = [];
      } finally {
        if (feedLoadRef.current === request) feedLoadRef.current = null;
      }
    }
    const candidate = available[0];
    if (!candidate) {
      setMessage('暂无可播放歌曲');
      return;
    }
    await startFeed(candidate, available, 0);
  }, [
    category,
    current,
    enabledPlatforms,
    feed,
    feedPage,
    startFeed,
    togglePlay,
  ]);
  const storageDiagnostic =
    stateStorageStatus.readError ?? stateStorageStatus.writeError;
  const stateStorageError =
    !storageDiagnostic || stateStorageErrorDismissed
      ? ''
      : stateStorageStatus.readError
      ? `本地数据读取失败，旧数据已保护，本次不写入（${storageDiagnostic.code}）`
      : `本地数据保存失败，请稍后重试（${storageDiagnostic.code}）`;
  if (!state) return <InitialStartupSplash startup={startup} />;
  const value: Controller = {
    navigationDepth: stack.length,
    rememberHomeMenuBatch,
    catalogViewState,
    catalogRestore,
    catalogConfigurationKey,
    queueOriginCatalog,
    queueOrigin,
    captureQueueOrigin,
    returnToQueueOrigin,
    startupHealth,
    ready,
    startup,
    tab,
    page,
    homeMenuOrigin,
    setTab,
    homeRefreshToken,
    homeRefreshing,
    finishHomeRefresh,
    homeCatalogLaunchPage: state.homeCatalogLaunchPage,
    refreshHome,
    pageRefreshToken,
    refreshPage,
    open,
    back,
    state,
    recommendationPlatforms,
    category,
    setCategory: nextCategory => {
      setCategory(nextCategory);
      setFeedPage(1);
    },
    feedPage,
    setFeedPage,
    feed,
    queue,
    queuePage,
    loadMoreQueue,
    prefetchQueueAt,
    removeQueueTrack,
    current,
    player,
    playerOverlayOpen,
    setPlayerOverlayOpen,
    setQueueListOpen,
    queueListOpen,
    queueReversed,
    queueOrderVersion,
    queueOrderChanging,
    reverseQueue,
    busy,
    message,
    stateStorageError,
    notify,
    clearMessage: () =>
      message === EXIT_HINT_MESSAGE ? disarmExitHint() : setMessage(''),
    clearStateStorageError: () => setStateStorageErrorDismissed(true),
    playTrack: startFeed,
    playDefaultTrack,
    prewarmHomeTracks,
    prewarmContextKey: `${
      sourceSelectionGeneration.current
    }:${sourceResolutionCacheToken()}:${qualityPreferenceRef.current}`,
    prewarmDetailTracks,
    releaseDetailPrewarm,
    waitForQueuePrewarm,
    trackBlacklistVersion,
    isTrackBlocked: isRuntimeTrackBlocked,
    togglePlay,
    setPlaybackPlaying,
    next,
    previous,
    seek,
    changeQuality,
    applyEqualizer,
    applyCustomEqualizer,
    flushEqualizerUpdates,
    commitEqualizerEdit,
    saveEqualizerDraft,
    saveCustomEqualizer,
    deleteCustomEqualizer,
    setPlaybackMode,
    toggleFavorite,
    dislikeTrack,
    isFavorite,
    toggleCollectionFavorite,
    isCollectionFavorite,
    search,
    runSearch,
    clearSearchHistory,
    resetSearch,
    removeSearchHistory,
    clearHistory,
    clearCache,
    chooseDownloadDirectory: selectDownloadDirectory,
    backupData,
    restoreData,
    importLocalMusic,
    addLocalMusicDirectory,
    scanLocalMusic,
    refreshLocalMusicArtwork,
    removeLocalTrack,
    removeDownload,
    downloadTrack,
    downloadsFor,
    downloadActivities,
    downloadDestination,
    consumeDownloadDestination,
    prepareDownloadPreview,
    beginUserDownloads,
    refreshDownloadFileSizes,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    createPlaylist,
    importPlaylist,
    isPlaylistSaved,
    openPersonalPlaylist,
    openLinkedPlaylist,
    playlistImportRequest,
    openPlaylistImport,
    closePlaylistImport,
    cancelPlaylistImport,
    renamePlaylist,
    renameImportedPlaylist,
    deleteImportedPlaylist,
    deletePlaylist,
    setSetting,
    togglePlatform,
    toggleSource,
    reorderSources,
    removeSources,
    importSource,
    testSource,
    setSleepTimer,
    cancelSleepTimer,
  };
  return (
    <Context.Provider value={value}>
      <DesktopLyricsBridge
        settings={ready && !startup.visible ? state?.settings : undefined}
        current={current}
        player={player}
        favorite={Boolean(current && state?.favorites.includes(current.id))}
        actions={{
          toggle: togglePlay,
          jump,
          seek,
          favorite: () => {
            if (current) toggleFavorite(current);
          },
          close: () => setSetting('desktopLyricsEnabled', false),
          denied: () => {
            if (state?.settings.desktopLyricsEnabled) {
              setSetting('desktopLyricsEnabled', false);
              setMessage('请在桌面歌词中授予悬浮权限');
            }
          },
        }}
      />
      {children}
    </Context.Provider>
  );
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error('App state is not ready');
  return value;
}
const initialStartupContainer = { flex: 1 };
function InitialStartupSplash({
  startup,
}: {
  startup: {
    visible: boolean;
    label: string;
    progress: number;
  };
}) {
  const appearance = useMemo(readStartupAppearance, []);
  return (
    <View
      style={[
        initialStartupContainer,
        { backgroundColor: STARTUP_PALETTES[appearance.theme].background },
      ]}
    >
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle={
          STARTUP_PALETTES[appearance.theme].dark
            ? 'light-content'
            : 'dark-content'
        }
      />
      <StartupSplashView startup={startup} {...appearance} />
    </View>
  );
}
// Keep catalog navigation context when the existing shell temporarily mounts the player.
export function useCatalogViewState<T>(key: string, initial: T) {
  const { catalogViewState, catalogRestore } = useApp();
  const [value, setValue] = useState<T>(() =>
    catalogViewState.has(key) ? (catalogViewState.get(key) as T) : initial,
  );
  const restoredVersion = useRef(catalogRestore?.version);
  let visibleValue = value;
  if (restoredVersion.current !== catalogRestore?.version) {
    restoredVersion.current = catalogRestore?.version;
    if (catalogRestore?.keys.includes(key)) {
      visibleValue = catalogViewState.get(key) as T;
      setValue(visibleValue);
    }
  }
  const update = useCallback(
    (next: React.SetStateAction<T>) => {
      setValue(previous => {
        const resolved =
          typeof next === 'function'
            ? (next as (previous: T) => T)(previous)
            : next;
        catalogViewState.set(key, resolved);
        return resolved;
      });
    },
    [catalogViewState, key],
  );
  return [visibleValue, update] as const;
}
export const seedCatalog = catalog;
