import { NativeModules } from 'react-native';
import type { CatalogItem, PersistedState, Track } from '../domain/types';
import { playbackQualityOptions } from '../domain/types';
import { themeOptions } from '../themeCatalog';
import {
  flatAdvancedEffects,
  validAdvancedEffects,
  validCalibration,
} from './audioEffectState';
import {
  collectionFavoriteKey,
  normalizeCollectionFavoriteKeys,
} from './collectionIdentity';
import { normalizeEffectUserOverrides } from './effectEditing';
import { restoreEffectiveEffects } from './effectIsolation';
import {
  flatEqualizerGains,
  normalizeSavedEqualizers,
  validEqualizerGains,
} from './equalizer';
import { initializeHeadphoneDatabase } from './headphoneDatabase';
import {
  canonicalHeadphoneCalibration,
  normalizeHeadphoneData,
} from './headphones';
import { normalizeMenuProgress } from './homeMenuProgress';
import { migrateLinkedPlaylists } from './linkedPlaylist';
import { syncDownloadedMusic } from './localMusicLibrary';
import { trackMediaKind } from './mediaLibrary';
import { normalizeMusicEntityHistory } from './musicEntityHistory';
import {
  normalizePlaybackHistory as normalizeHistory,
  retainRecentMusicState,
} from './musicHistoryRetention';
import { memoryStatisticsFor } from './musicPreferenceStatistics';
import {
  isRecommendationMusicCollection,
  isRecommendationMusicTrack,
  isMusicLibraryCollection,
} from './recommendationContentPolicy';
import { filterImportedSources } from './sourcePolicy';
import type { AudioProbeResult } from './trackPlaybackPolicy';
export type CacheCleanupPart = 'network' | 'runtime' | 'local-artwork';
export interface StateStorageDiagnostic {
  code: string;
  rawLength?: number;
  errorName?: string;
  /** Character counts only: never persisted contents or source scripts. */
  sections?: Record<string, number>;
  counts?: Record<string, number>;
}
export interface StateStorageStatus {
  readError: StateStorageDiagnostic | null;
  writeError: StateStorageDiagnostic | null;
}
const stateStorageListeners = new Set<(status: StateStorageStatus) => void>();
let stateStorageStatus: StateStorageStatus = {
  readError: null,
  writeError: null,
};
const nativeStateErrorCodes = new Set([
  'STATE_MISSING_AFTER_UPDATE',
  'STATE_INSTALL_METADATA_FAILED',
  'STATE_FILE_MISSING',
  'STATE_FILE_READ_FAILED',
  'STATE_SAVE_FAILED',
  'STATE_VERIFY_FAILED',
  'STATE_MIGRATION_FAILED',
  'STATE_RECOVERY_FAILED',
]);
export function getStateStorageStatus(): StateStorageStatus {
  return { ...stateStorageStatus };
}
export function subscribeStateStorageStatus(
  listener: (status: StateStorageStatus) => void,
) {
  stateStorageListeners.add(listener);
  listener(getStateStorageStatus());
  return () => {
    stateStorageListeners.delete(listener);
  };
}
function updateStateStorageStatus(next: StateStorageStatus) {
  const changed = JSON.stringify(stateStorageStatus) !== JSON.stringify(next);
  if (!changed) return;
  stateStorageStatus = next;
  for (const listener of stateStorageListeners)
    listener(getStateStorageStatus());
}
function errorName(error: unknown) {
  return error && typeof error === 'object' && 'constructor' in error
    ? String(
        (
          error as {
            constructor?: {
              name?: string;
            };
          }
        ).constructor?.name ?? 'Error',
      )
    : 'Error';
}
export const allCacheCleanupParts: CacheCleanupPart[] = [
  'network',
  'runtime',
  'local-artwork',
];
export type NativeCacheClearResult = {
  networkEntries: number;
  localArtworkFiles: number;
  removedBytes: number;
  deletedArtworkUris: string[];
  failedFiles: number;
};
const defaults: PersistedState = {
  version: 2,
  homeCatalogLaunchPage: 0,
  menuRecommendationProgress: {},
  savedTracks: [],
  savedCollections: [],
  importedPlaylists: [],
  favorites: [],
  favoriteCollections: [],
  disliked: [],
  history: [],
  musicEntityHistory: [],
  playlists: [
    {
      id: 'liked',
      title: '日落与晚风',
      trackIds: [],
      coverKey: 'train',
      private: false,
      updatedAt: Date.now(),
    },
    {
      id: 'focus',
      title: '工作专注',
      trackIds: [],
      coverKey: 'vinyl',
      private: true,
      updatedAt: Date.now(),
    },
  ],
  searchHistory: [],
  settings: {
    theme: 'white',
    themeSystemVersion: 2,
    themePaletteVersion: 1,
    accent: '#0878FF',
    motion: 'standard',
    backgroundMotion: true,
    reducedMotion: false,
    autoNext: true,
    startupAutoplay: true,
    startupAutoplayVersion: 1,
    multiSourceDetection: true,
    sourceSyncDefaultsVersion: 1,
    normalizeVolume: true,
    interruptPlayback: false,
    quality: '320k',
    downloadQuality: '320k',
    wifiQuality: '320k',
    wifiDownloadQuality: '320k',
    desktopLyricsEnabled: false,
    desktopLyricsStyle: 'center',
    equalizer: 'Flat',
    customEqualizerGains: flatEqualizerGains(),
    customEqualizerPresets: [],
    customEqualizerAdvanced: flatAdvancedEffects(),
    headphoneData: normalizeHeadphoneData(undefined),
    shuffle: false,
    repeat: 'off',
  },
  platforms: [
    { id: 'netease', name: '网易云音乐', enabled: true },
    { id: 'qq', name: 'QQ音乐', enabled: true },
    { id: 'kugou', name: '酷狗音乐', enabled: true },
    { id: 'kuwo', name: '酷我音乐', enabled: true },
    { id: 'migu', name: '咪咕音乐', enabled: true },
    { id: 'qishui', name: '汽水音乐', enabled: true },
  ],
  sources: [],
  profile: {
    artists: {},
    languages: {},
    genres: {},
    moods: {},
    timeSlots: {},
    longTermTrackIds: [],
    shortTermTrackIds: [],
    sessionTrackIds: [],
  },
  localTracks: [],
  downloads: [],
};
let memory = JSON.stringify(defaults);
const native = NativeModules.LiuliuStorage as
  | {
      load: () => Promise<string | null>;
      md5: (value: string) => Promise<string>;
      save: (value: string) => Promise<void>;
      saveDurable?: (value: string) => Promise<void>;
      pickSourceScript: () => Promise<ImportedSourceFile | null>;
      pickHeadphoneProfile: () => Promise<ImportedSourceFile | null>;
      testSourceScript: (script: string) => Promise<SourceScriptTestResult>;
      clearCache: (parts: string[]) => Promise<NativeCacheClearResult>;
      chooseDownloadDirectory: () => Promise<string | null>;
      exportBackup: (value: string) => Promise<string | null>;
      importBackup: () => Promise<string | null>;
      pickAudioFiles: () => Promise<Track[]>;
      scanMusicDirectory: () => Promise<Track[]>;

      scanAllMusic: () => Promise<Track[]>;
      deleteLocalFile: (uri: string) => Promise<boolean>;
      downloadAudio: (
        url: string,
        title: string,
        artist: string,
      ) => Promise<string>;
      queryDownload: (id: string) => Promise<DownloadStatus>;
      downloadAudioWithProgress?: (
        url: string,
        title: string,
        artist: string,
        requestId: string,
      ) => Promise<string>;
      queryDownloadHeaders?: (
        url: string,
        requestId: string,
      ) => Promise<{
        sizeBytes?: number;
      }>;
      cancelDownloadHeaders?: (requestId: string) => void;
      queryLocalFileSize?: (reference: string) => Promise<number | null>;
      probeAudioUrl: (url: string) => Promise<AudioProbeResult>;
      probeLocalAudio: (uri: string) => Promise<AudioProbeResult>;
      readLocalAudioMetadata: (uri: string) => Promise<LocalAudioMetadata>;
      readLocalAudioArtwork?: (uri: string) => Promise<string | null>;
      queryLocalFileIdentities?: (
        references: string[],
      ) => Promise<Record<string, string>>;
    }
  | undefined;
export interface ImportedSourceFile {
  fileName: string;
  content: string;
}
export const pickHeadphoneProfile = async () =>
  native?.pickHeadphoneProfile() ?? null;
export interface SourceScriptTestResult {
  ok: boolean;
  message: string;
  sources: string[];
  capabilitiesJson?: string;
}
export interface DownloadStatus {
  status: 'queued' | 'downloaded' | 'failed';
  localUri?: string;
  reason?: string;
  bytesDownloaded?: number;
  totalBytes?: number;
  fileSize?: number;
}
const cloneDefaults = (): PersistedState =>
  JSON.parse(JSON.stringify(defaults));
const normalizeSearchHistory = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map(item => item.trim())
            .filter(Boolean),
        ),
      ).slice(0, 12)
    : [];
const normalizeTracks = (value: unknown): Track[] =>
  Array.isArray(value)
    ? [
        ...new Map(
          value
            .filter(track => track && typeof track.id === 'string')
            .map(track => {
              const item = track as Track;
              return [
                `${trackMediaKind(item)}:${item.provider}:${item.id}`,
                item,
              ] as const;
            }),
        ).values(),
      ]
    : [];
const normalizeCollections = (value: unknown): CatalogItem[] =>
  Array.isArray(value)
    ? [
        ...new Map(
          value
            .filter(
              item =>
                item &&
                typeof item.id === 'string' &&
                typeof item.provider === 'string',
            )
            .map(item => {
              const value = item as CatalogItem;
              return [collectionFavoriteKey(value), value] as const;
            }),
        ).values(),
      ]
    : [];
const mergeUnique = <T>(values: T[], keyOf: (value: T) => string) => [
  ...new Map(values.map(value => [keyOf(value), value])).values(),
];
export function normalizeState(value: unknown): PersistedState {
  if (!value || typeof value !== 'object') return cloneDefaults();
  const parsed = value as Partial<PersistedState> & {
    sources?: PersistedState['sources'];
  };
  const legacyItems = Array.isArray(parsed.sources) ? parsed.sources : [];
  const importedSources = filterImportedSources(legacyItems);
  const legacyPlatforms = legacyItems.filter(source => !source.script);
  const storedPlatforms = Array.isArray(parsed.platforms)
    ? parsed.platforms
    : [];
  const platforms = defaults.platforms.map(platform => ({
    ...platform,
    ...legacyPlatforms.find(item => item.id === platform.id),
    ...storedPlatforms.find(item => item.id === platform.id),
    id: platform.id,
    name: platform.name,
  }));
  const parsedSettings = (parsed.settings ?? {}) as Partial<
    Omit<
      PersistedState['settings'],
      'themeSystemVersion' | 'themePaletteVersion' | 'startupAutoplayVersion'
    >
  > & {
    themeSystemVersion?: number;
    themePaletteVersion?: number;
    startupAutoplayVersion?: number;
    spectrum?: boolean;
  };
  const { spectrum: legacySpectrum, ...settingsWithoutLegacySpectrum } =
    parsedSettings;
  const settings: PersistedState['settings'] = {
    ...defaults.settings,
    ...settingsWithoutLegacySpectrum,
    themeSystemVersion: 2,
    themePaletteVersion: 1,
    startupAutoplayVersion: 1,
    interruptPlayback:
      typeof parsedSettings.interruptPlayback === 'boolean'
        ? parsedSettings.interruptPlayback
        : typeof legacySpectrum === 'boolean'
        ? legacySpectrum
        : defaults.settings.interruptPlayback,
  };
  settings.customEqualizerGains = validEqualizerGains(
    parsedSettings.customEqualizerGains,
  )
    ? [...parsedSettings.customEqualizerGains]
    : flatEqualizerGains();
  settings.customEqualizerPresets = normalizeSavedEqualizers(
    parsedSettings.customEqualizerPresets,
  );
  settings.effectUserOverrides = normalizeEffectUserOverrides(
    parsedSettings.effectUserOverrides,
  );
  settings.customEqualizerAdvanced = validAdvancedEffects(
    parsedSettings.customEqualizerAdvanced,
  )
    ? parsedSettings.customEqualizerAdvanced
    : flatAdvancedEffects();
  settings.headphoneCalibration = validCalibration(
    parsedSettings.headphoneCalibration,
  )
    ? canonicalHeadphoneCalibration(parsedSettings.headphoneCalibration)
    : undefined;
  settings.headphoneData = normalizeHeadphoneData(parsedSettings.headphoneData);
  settings.customEqualizerPresetId = settings.customEqualizerPresets.some(
    preset => preset.id === parsedSettings.customEqualizerPresetId,
  )
    ? parsedSettings.customEqualizerPresetId
    : undefined;
  Object.assign(settings, restoreEffectiveEffects(settings));
  settings.downloadQuality = playbackQualityOptions.some(
    option => option.value === parsedSettings.downloadQuality,
  )
    ? parsedSettings.downloadQuality!
    : playbackQualityOptions.some(
        option => option.value === parsedSettings.quality,
      )
    ? parsedSettings.quality!
    : defaults.settings.downloadQuality;
  settings.wifiQuality = playbackQualityOptions.some(
    option => option.value === parsedSettings.wifiQuality,
  )
    ? parsedSettings.wifiQuality!
    : settings.quality;
  settings.wifiDownloadQuality = playbackQualityOptions.some(
    option => option.value === parsedSettings.wifiDownloadQuality,
  )
    ? parsedSettings.wifiDownloadQuality!
    : settings.downloadQuality;
  settings.desktopLyricsEnabled = parsedSettings.desktopLyricsEnabled === true;
  settings.desktopLyricsStyle = [
    'center',
    'capsule',
    'card',
    'bottom',
    'wave',
    'vertical',
  ].includes(parsedSettings.desktopLyricsStyle ?? '')
    ? parsedSettings.desktopLyricsStyle!
    : 'center';
  if (
    Number(parsed.version ?? 0) < 2 ||
    Number(parsedSettings.themeSystemVersion ?? 0) < 2 ||
    Number(parsedSettings.themePaletteVersion ?? 0) < 1 ||
    !themeOptions.some(option => option.id === settings.theme)
  ) {
    settings.theme = 'white';
    settings.themeSystemVersion = 2;
    settings.themePaletteVersion = 1;
    settings.accent = '#0878FF';
  }
  if (Number(parsedSettings.startupAutoplayVersion ?? 0) < 1) {
    settings.startupAutoplay = true;
    settings.startupAutoplayVersion = 1;
  }
  const savedTracks = normalizeTracks(parsed.savedTracks);
  if (parsedSettings.sourceSyncDefaultsVersion !== 1) {
    settings.sourceSyncDefaultsVersion = 1;
  }
  const savedCollections = normalizeCollections(parsed.savedCollections);
  const legacyDownloads = Array.isArray(parsed.downloads)
    ? parsed.downloads
    : [];
  const legacyFavorites = Array.isArray(parsed.favorites)
    ? parsed.favorites.filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];
  const history = normalizeHistory(parsed.history, 'music');
  const musicDownloads = syncDownloadedMusic(
    (Array.isArray(parsed.localTracks) ? parsed.localTracks : []).filter(
      isRecommendationMusicTrack,
    ),
    legacyDownloads.filter(entry => isRecommendationMusicTrack(entry.track)),
  );
  const musicTracks = savedTracks.filter(isRecommendationMusicTrack);
  const musicCollections = savedCollections.filter(isMusicLibraryCollection);
  return retainRecentMusicState(
    migrateLinkedPlaylists({
      ...defaults,
      version: 2,
      menuRecommendationProgress: normalizeMenuProgress(
        parsed.menuRecommendationProgress,
      ),
      homeCatalogLaunchPage: Math.max(
        0,
        Math.floor(Number(parsed.homeCatalogLaunchPage) || 0),
      ),
      searchHistory: normalizeSearchHistory(parsed.searchHistory),
      musicEntityHistory: normalizeMusicEntityHistory(
        parsed.musicEntityHistory,
      ),
      history,
      profile: {
        ...defaults.profile,
        ...parsed.profile,
        memoryStatistics: memoryStatisticsFor(
          { ...defaults.profile, ...parsed.profile },
          history,
        ),
      },
      settings,
      platforms,
      sources: importedSources,
      savedTracks: musicTracks,
      savedCollections: musicCollections,
      favorites: legacyFavorites.filter(
        id =>
          !savedTracks.some(
            track => track.id === id && !isRecommendationMusicTrack(track),
          ),
      ),
      favoriteCollections: normalizeCollectionFavoriteKeys(
        Array.isArray(parsed.favoriteCollections)
          ? parsed.favoriteCollections.filter(
              (key): key is string => typeof key === 'string',
            )
          : [],
        musicCollections,
      ),
      disliked: Array.isArray(parsed.disliked) ? parsed.disliked : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      importedPlaylists: Array.isArray(parsed.importedPlaylists)
        ? parsed.importedPlaylists.filter(isRecommendationMusicCollection)
        : [],
      ...musicDownloads,
    }),
  );
}
export async function loadState(
  readRaw: () => Promise<string | null> = async () =>
    native ? native.load() : memory,
) {
  // Only committed local metadata; no network or full calibration reads.
  await initializeHeadphoneDatabase().catch(() => undefined);
  let state = cloneDefaults();
  let raw: string | null = null;
  let readError: StateStorageDiagnostic | null = null;
  try {
    raw = await readRaw();
  } catch (error) {
    const nativeCode =
      error && typeof error === 'object' && 'code' in error
        ? (
            error as {
              code?: unknown;
            }
          ).code
        : undefined;
    readError = {
      code:
        typeof nativeCode === 'string' && nativeStateErrorCodes.has(nativeCode)
          ? nativeCode
          : 'STATE_READ_FAILED',
      errorName: errorName(error),
    };
  }
  if (!readError && raw !== null && typeof raw !== 'string') {
    readError = {
      code: 'STATE_SHAPE_INVALID',
      errorName: 'InvalidStorageValue',
    };
  }
  if (!readError && raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw, stripProcessPlayback);
    } catch (error) {
      readError = {
        code: 'STATE_JSON_INVALID',
        rawLength: raw.length,
        errorName: errorName(error),
      };
    }
    if (
      !readError &&
      (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    ) {
      readError = {
        code: 'STATE_SHAPE_INVALID',
        rawLength: raw.length,
        errorName: 'InvalidPersistedState',
      };
    }
    if (!readError) {
      try {
        state = normalizeState(parsed);
        const previous = parsed as Partial<PersistedState>;
        if ((previous.savedTracks?.length ?? 0) > state.savedTracks.length) {
          console.info(
            '[state-storage-cleanup]',
            JSON.stringify({
              stage: 'read',
              previousMusicRecords: previous.savedTracks?.length ?? 0,
              ...stateStorageSizes(state),
            }),
          );
        }
      } catch (error) {
        readError = {
          code: 'STATE_NORMALIZE_FAILED',
          rawLength: raw.length,
          errorName: errorName(error),
        };
      }
    }
  }
  updateStateStorageStatus({
    readError,
    writeError: stateStorageStatus.writeError,
  });
  if (readError) {
    console.warn(
      '[state-storage]',
      JSON.stringify({ stage: 'read', ...readError }),
    );
  }
  const sources = filterImportedSources(state.sources);
  return { ...state, sources };
}
function stripProcessPlayback(_key: string, value: any) {
  if (_key === 'favoriteStatistics') return undefined;
  if (_key === 'sources' && Array.isArray(value))
    return filterImportedSources(value);
  const importedPlayback =
    value?.provider !== 'custom' &&
    value?.metadata?._playerPreparationSource !== undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    (value.metadata?._prewarmedUrl !== true && !importedPlayback)
  )
    return value;
  const track = { ...value, metadata: { ...value.metadata } };
  if (/^https?:\/\//i.test(track.playUrl ?? '')) delete track.playUrl;
  delete track.metadata._prewarmedUrl;
  delete track.metadata._prewarmedAt;
  delete track.metadata._prewarmedQuality;
  delete track.metadata._prewarmedReportedQuality;
  delete track.metadata._prewarmedAudio;
  if (importedPlayback) {
    delete track.metadata._playbackAudio;
    delete track.metadata._playbackQuality;
    delete track.metadata._playbackReportedQuality;
    delete track.metadata._playbackPreference;
    delete track.metadata._playerPreparationSource;
  }
  return track;
}
export function serializePersistedState(state: PersistedState, space?: number) {
  const musicState = Object.fromEntries(
    Object.entries(retainRecentMusicState(state)).filter(
      ([key]) => key !== 'podcastLibrary' && key !== 'audiobookLibrary',
    ),
  );
  return JSON.stringify(musicState, stripProcessPlayback, space);
}
function stateStorageSizes(state: PersistedState) {
  const sections: Record<string, number> = {};
  for (const key of [
    'history',
    'savedTracks',
    'sources',
    'settings',
    'profile',
    'playlists',
    'importedPlaylists',
    'savedCollections',
    'downloads',
    'localTracks',
    'musicEntityHistory',
    'menuRecommendationProgress',
  ] as const) {
    sections[key] =
      JSON.stringify(state[key], stripProcessPlayback)?.length ?? 0;
  }
  return {
    sections,
    counts: {
      musicHistory: state.history.length,
      musicRecords: state.savedTracks.length,
      favorites: state.favorites.length,
      personalPlaylists: state.playlists.length,
      importedPlaylists: state.importedPlaylists?.length ?? 0,
      sources: state.sources.length,
    },
  };
}
export async function saveState(
  state: PersistedState,
  options: {
    durable?: boolean;
  } = {},
) {
  if (stateStorageStatus.readError) {
    const error = new Error('STATE_WRITE_BLOCKED');
    Object.assign(error, { code: 'STATE_WRITE_BLOCKED' });
    throw error;
  }
  let serialized: string | undefined;
  try {
    serialized = serializePersistedState(state);
    if (options.durable && native) {
      if (!native.saveDurable) throw new Error('当前设备不支持可靠保存歌单');
      await native.saveDurable(serialized);
    } else if (native) {
      await native.save(serialized);
    }
    memory = serialized;
    updateStateStorageStatus({ readError: null, writeError: null });
  } catch (error) {
    const nativeCode =
      error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined;
    const writeError: StateStorageDiagnostic = {
      code:
        typeof nativeCode === 'string' && nativeStateErrorCodes.has(nativeCode)
          ? nativeCode
          : options.durable
          ? 'STATE_DURABLE_WRITE_FAILED'
          : 'STATE_WRITE_FAILED',
      rawLength: serialized?.length,
      errorName: errorName(error),
      ...(serialized === undefined
        ? {}
        : stateStorageSizes(retainRecentMusicState(state))),
    };
    updateStateStorageStatus({ readError: null, writeError });
    console.warn(
      '[state-storage]',
      JSON.stringify({ stage: 'write', ...writeError }),
    );
    throw error;
  }
}
export async function importSourceScript() {
  if (!native?.pickSourceScript)
    throw new Error('当前设备不支持音乐源文件选择器');
  return native.pickSourceScript();
}
export async function testImportedSourceScript(script: string) {
  if (!native?.testSourceScript)
    throw new Error('当前设备不支持自定义音源测试');
  return native.testSourceScript(script);
}
export async function clearNativeCache(
  parts: Exclude<CacheCleanupPart, 'runtime'>[],
) {
  if (!parts.length)
    return {
      networkEntries: 0,
      localArtworkFiles: 0,
      removedBytes: 0,
      deletedArtworkUris: [],
      failedFiles: 0,
    };
  if (!native?.clearCache) throw new Error('当前设备不支持缓存清理');
  return native.clearCache(parts);
}
export async function chooseDownloadDirectory() {
  if (!native?.chooseDownloadDirectory)
    throw new Error('当前设备不支持目录选择器');
  return native.chooseDownloadDirectory();
}
export async function exportStateBackup(state: PersistedState) {
  if (!native?.exportBackup) throw new Error('当前设备不支持数据备份');
  return native.exportBackup(serializePersistedState(state, 2));
}
export async function importStateBackup() {
  if (!native?.importBackup) throw new Error('当前设备不支持数据恢复');
  const raw = await native.importBackup();
  if (!raw) return null;
  const state = normalizeState(JSON.parse(raw, stripProcessPlayback));
  return { ...state, sources: filterImportedSources(state.sources) };
}
export async function pickLocalAudioFiles() {
  if (!native?.pickAudioFiles) throw new Error('当前设备不支持本地音乐选择器');
  return native.pickAudioFiles();
}
export async function scanLocalMusicDirectory() {
  if (!native?.scanMusicDirectory)
    throw new Error('当前设备不支持本地音乐目录扫描');
  return native.scanMusicDirectory();
}
export async function scanAllLocalMusic() {
  if (!native?.scanAllMusic) throw new Error('当前设备不支持全盘音乐扫描');
  return native.scanAllMusic();
}
export async function deleteLocalFile(uri: string) {
  if (!native?.deleteLocalFile) throw new Error('当前设备不支持删除本地文件');
  return native.deleteLocalFile(uri);
}
export async function queryLocalFileIdentities(
  references: string[],
): Promise<Record<string, string>> {
  return native?.queryLocalFileIdentities?.([...new Set(references)]) ?? {};
}
export async function downloadAudio(
  url: string,
  title: string,
  artist: string,
) {
  if (!native?.downloadAudio) throw new Error('当前设备不支持系统下载服务');
  return native.downloadAudio(url, title, artist);
}
export async function queryDownloadStatus(id: string) {
  if (!native?.queryDownload) throw new Error('当前设备不支持读取系统下载状态');
  return native.queryDownload(id);
}
export async function downloadAudioWithProgress(
  url: string,
  title: string,
  artist: string,
  requestId: string,
) {
  if (native?.downloadAudioWithProgress)
    return native.downloadAudioWithProgress(url, title, artist, requestId);
  return downloadAudio(url, title, artist);
}
let downloadHeaderSequence = 0;
export async function queryDownloadHeaders(url: string, signal: AbortSignal) {
  if (signal.aborted)
    throw Object.assign(new Error('查询已取消'), { name: 'AbortError' });
  if (!native?.queryDownloadHeaders) return {};
  const id = `download_headers_${++downloadHeaderSequence}`;
  const cancel = () => native.cancelDownloadHeaders?.(id);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const request = native.queryDownloadHeaders(url, id);
    if (signal.aborted) cancel();
    const result = await request;
    if (signal.aborted)
      throw Object.assign(new Error('查询已取消'), { name: 'AbortError' });
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
export async function queryLocalFileSize(reference: string) {
  return native?.queryLocalFileSize?.(reference) ?? null;
}
export async function probeAudioUrl(url: string) {
  if (!native?.probeAudioUrl) throw new Error('当前设备不支持音频链路测试');
  return native.probeAudioUrl(url);
}
export async function probeLocalAudio(uri: string) {
  if (!native?.probeLocalAudio) throw new Error('当前设备不支持读取本地音频');
  return native.probeLocalAudio(uri);
}
export interface LocalAudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  durationSeconds?: number;
}
export async function readLocalAudioMetadata(
  uri: string,
): Promise<LocalAudioMetadata> {
  return native?.readLocalAudioMetadata
    ? native.readLocalAudioMetadata(uri)
    : {};
}
export async function readLocalAudioArtwork(
  uri: string,
): Promise<string | null> {
  return native?.readLocalAudioArtwork
    ? native.readLocalAudioArtwork(uri)
    : null;
}
export async function md5(value: string) {
  if (!native?.md5) throw new Error('当前设备不支持平台签名');
  return native.md5(value);
}
export const defaultState = cloneDefaults;
