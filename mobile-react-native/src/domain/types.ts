export type DiscoveryCategory =
  | '综合'
  | '新歌'
  | '华语'
  | '欧美'
  | '日韩'
  | '粤语'
  | '轻音乐'
  | 'ACG';
export type ProviderId =
  | 'kuwo'
  | 'netease'
  | 'qq'
  | 'kugou'
  | 'migu'
  | 'qishui'
  | 'custom';
export type CoverKey = 'train' | 'cat' | 'ocean' | 'vinyl';
export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  provider: ProviderId;
  providerId?: string;
  playUrl?: string;
  cover?: string;
  coverKey: CoverKey;
  language: '华语' | '欧美' | '日韩' | '粤语' | '纯音乐' | 'ACG';
  genre: string;
  mood: string;
  releaseYear: number;
  isNew?: boolean;
  quality?: 'SQ' | 'Hi-Res';
  reason?: string;
  metadata?: Record<string, unknown>;
}
/** Stable identity for one queue entry. Titles are presentation data and may repeat. */
export function trackQueueKey(track: {
  provider: string;
  providerId?: string;
  id: string;
}) {
  const sourceId = String(track.providerId ?? track.id).trim();
  return `${track.provider}:${sourceId}`;
}
export type CatalogKind = 'playlists' | 'new-songs' | 'new-albums' | 'charts';
export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  cover?: string;
  /** Ordered remote cover candidates used before the bundled fallback. */
  coverCandidates?: string[];
  provider: Exclude<ProviderId, 'custom'>;
  kind: CatalogKind;
  artist?: string;
  releaseDate?: string;
  trackCount?: number;
  metadata?: Record<string, unknown>;
}
export interface CatalogDetail extends CatalogItem {
  tracks: Track[];
}
export interface HistoryEntry {
  track: Track;
  playedAt: number;
  listenedSeconds: number;
  completed: boolean;
  skipped: boolean;
  /** Last observed native position and duration, separate from listening totals. */
  positionSeconds?: number;
  playbackDurationSeconds?: number;
}
export type MusicEntityKind = 'playlist' | 'album' | 'artist';
export type MusicEntityHistoryEntry =
  | {
      kind: MusicEntityKind;
      item: CatalogItem;
      playedAt: number;
    }
  | {
      kind: 'playlist';
      playlistId: string;
      title: string;
      coverKey: CoverKey;
      playedAt: number;
    };
export type MusicHistoryOrigin =
  | {
      item: CatalogItem;
    }
  | {
      playlistId: string;
    };
export interface DownloadEntry {
  id: string;
  track: Track;
  status: 'queued' | 'downloaded' | 'failed';
  createdAt: number;
  localLibrarySynced?: boolean;
  /** Actual completed-file byte count; never estimated from bitrate/duration. */
  fileSize?: number;
  /** Tier classified from this download's native audio evidence, independent of preferences. */
  quality?: PlaybackQuality;
}
export type LibraryMediaKind = 'music';
export interface Playlist {
  id: string;
  title: string;
  trackIds: string[];
  coverKey: CoverKey;
  private: boolean;
  updatedAt: number;
  cover?: string;
  description?: string;
  importOrigin?: {
    provider: PlatformSetting['id'];
    id: string;
  };
  /** Stable identity of an explicitly imported six-six playlist share. */
  shareOrigin?: string;
}
export interface SourceSetting {
  id: string;
  name: string;
  enabled: boolean;
  origin?: 'imported' | 'github';
  updateUrl?: string;
  scriptSha256?: string;
  healthy?: boolean;
  description?: string;
  author?: string;
  homepage?: string;
  version?: string;
  fileName?: string;
  script?: string;
  capabilities?: string[];
  sourceCapabilities?: Record<
    string,
    {
      qualitys?: string[];
    }
  >;
  /** Per-platform manual playback-chain result for this imported script. */
  manualPlatformHealth?: Record<
    string,
    {
      passed: boolean;
      checkedAt: number;
    }
  >;
  /** Launch-scoped backend selected by the platform health probe. */
  pinnedBackend?: string;
  statusMessage?: string;
}
export interface PlatformSetting {
  id: Exclude<ProviderId, 'custom'>;
  name: string;
  enabled: boolean;
}
export interface MusicProfile {
  artists: Record<string, number>;
  languages: Record<string, number>;
  genres: Record<string, number>;
  moods: Record<string, number>;
  timeSlots: Record<string, number>;
  longTermTrackIds: string[];
  shortTermTrackIds: string[];
  sessionTrackIds: string[];
  /** Local confirmed-play distribution; independent from the other recommendation signals. */
  memoryStatistics?: MusicPreferenceStatistics;
  /** Current favorites captured only for a menu queue; recomputed from the saved favorite set. */
  favoriteStatistics?: MusicPreferenceStatistics;
}
export type MusicPreferenceDimension =
  | 'genres'
  | 'styles'
  | 'languages'
  | 'moods'
  | 'artists';
export interface MusicPreferenceStatistics {
  version: 1;
  /** Effective sample weight, saturating at 100 for the 1% update rule. */
  samples: number;
  distributions: Record<MusicPreferenceDimension, Record<string, number>>;
}
export type PlaybackQuality = '128k' | '320k' | 'flac' | 'flac24bit' | 'hires';
export const playbackQualityOptions: ReadonlyArray<{
  value: PlaybackQuality;
  settingsLabel: string;
  playerLabel: string;
}> = [
  { value: '128k', settingsLabel: '标清', playerLabel: '标清' },
  { value: '320k', settingsLabel: '高清', playerLabel: '高清' },
  { value: 'flac', settingsLabel: '无损', playerLabel: '无损' },
  { value: 'flac24bit', settingsLabel: '至臻', playerLabel: '至臻' },
  { value: 'hires', settingsLabel: '母带', playerLabel: '母带' },
];
/** A display label; the stored/requested quality always remains the original value. */
export const settingsQualityLabel = (quality: PlaybackQuality): string =>
  returnedQualityLabel(quality);
/** Only explicit platform response tiers can become a result label. */
export function normalizeReturnedQuality(
  value: unknown,
): PlaybackQuality | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim().toLowerCase();
  return playbackQualityOptions.find(
    option => option.value === raw || option.playerLabel === raw,
  )?.value;
}
export function returnedQualityLabel(value: unknown): string {
  const quality = normalizeReturnedQuality(value);
  return (
    playbackQualityOptions.find(option => option.value === quality)
      ?.playerLabel ?? ''
  );
}
export interface AppSettings {
  theme:
    | 'white'
    | 'sunset'
    | 'night'
    | 'nature'
    | 'mist'
    | 'ocean'
    | 'lavender'
    | 'sakura'
    | 'anime-school'
    | 'anime-voyage'
    | 'anime-ninja'
    | 'anime-train'
    | 'sport-basketball'
    | 'sport-football'
    | 'sport-tennis'
    | 'sport-swimming'
    | 'film-space'
    | 'film-cyber'
    | 'film-wuxia'
    | 'film-romance'
    | 'curated-dunhuang'
    | 'curated-deer'
    | 'curated-butterfly'
    | 'curated-rose';
  themeSystemVersion: 2;
  themePaletteVersion: 1;
  accent: string;
  motion: 'off' | 'soft' | 'standard' | 'rich';
  backgroundMotion: boolean;
  reducedMotion: boolean;
  autoNext: boolean;
  startupAutoplay: boolean;
  startupAutoplayVersion: 1;
  multiSourceDetection: boolean;
  sourceSyncDefaultsVersion?: 1;
  normalizeVolume: boolean;
  interruptPlayback: boolean;
  quality: PlaybackQuality;
  downloadQuality: PlaybackQuality;
  wifiQuality?: PlaybackQuality;
  wifiDownloadQuality?: PlaybackQuality;
  desktopLyricsEnabled?: boolean;
  desktopLyricsStyle?: import('../services/desktopLyrics').DesktopLyricStyle;
  equalizer: EqualizerPreset;
  customEqualizerGains?: number[];
  customEqualizerPresets?: SavedEqualizerPreset[];
  customEqualizerPresetId?: string;
  customEqualizerAdvanced?: import('../services/audioEffectState').AdvancedEffects;
  headphoneCalibration?: import('../services/audioEffectState').HeadphoneCalibration;
  headphoneData?: import('../services/headphones').HeadphoneUserData;
  effectIsolation?: import('../services/effectIsolation').EffectIsolation;
  effectSceneId?: string;
  effectUserOverrides?: Record<
    string,
    {
      gains: number[];
      advanced: import('../services/audioEffectState').AdvancedEffects;
    }
  >;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
}
export type PlaybackMode = 'sequence' | 'shuffle' | 'repeat-one';
export const playbackModeLabels: Record<PlaybackMode, string> = {
  sequence: '顺序播放',
  shuffle: '随机播放',
  'repeat-one': '单曲循环',
};
export function playbackModeFromSettings(
  settings: Pick<AppSettings, 'shuffle' | 'repeat'>,
): PlaybackMode {
  if (settings.repeat === 'one') return 'repeat-one';
  if (settings.shuffle) return 'shuffle';
  return 'sequence';
}
export function playbackModeSettings(
  mode: PlaybackMode,
): Pick<AppSettings, 'shuffle' | 'repeat'> {
  if (mode === 'repeat-one') return { shuffle: false, repeat: 'one' };
  if (mode === 'shuffle') return { shuffle: true, repeat: 'all' };
  return { shuffle: false, repeat: 'off' };
}
export const equalizerPresets = [
  'Flat',
  'Pop',
  'Rock',
  'Classical',
  'Jazz',
  'Bass Boost',
  'Vocal',
  'DTS 风格',
  '蝰蛇风格',
  '电影',
  '舞曲',
  '原声',
  '清晰人声',
  '深沉低音',
  '现场空间',
  '游戏空间',
  '夜间聆听',
  '开车旅途',
  '超重低音',
  '车载音响',
  'Custom',
] as const;
export type EqualizerPreset = (typeof equalizerPresets)[number];
export type EqualizerPresetCategory =
  | '银河音效'
  | 'DTS 音效'
  | '调音台'
  | '自定义';
export const equalizerPresetLabels: Record<EqualizerPreset, string> = {
  Flat: '标准',
  Pop: '流行律动',
  Rock: '摇滚现场',
  Classical: '古典厅堂',
  Jazz: '爵士暖声',
  'Bass Boost': '低音增强',
  Vocal: '人声清晰',
  'DTS 风格': 'DTS 环绕',
  蝰蛇风格: '蝰蛇环绕',
  电影: '影院沉浸',
  舞曲: '舞曲节拍',
  原声: '原声还原',
  清晰人声: '清晰人声',
  深沉低音: '深沉低音',
  现场空间: '现场空间',
  游戏空间: '游戏空间',
  夜间聆听: '夜间聆听',
  开车旅途: '开车旅途',
  超重低音: '超重低音',
  车载音响: '车载音响',
  Custom: '自定义',
};
export interface SavedEqualizerPreset {
  id: string;
  name: string;
  gains: number[];
  category: EqualizerPresetCategory;
  advanced?: import('../services/audioEffectState').AdvancedEffects;
  headphone?: import('../services/audioEffectState').HeadphoneCalibration;
  effectScope?: Exclude<
    import('../services/effectIsolation').EffectScope,
    string
  >;
}
export interface PersistedState {
  version: 2;
  /** Menu directory positions and recently recommended identities, never audio URLs. */
  menuRecommendationProgress?: Record<string, HomeMenuProgressEntry>;
  /** Monotonic Home catalog page used for the next process launch. */
  homeCatalogLaunchPage: number;
  savedTracks: Track[];
  savedCollections: CatalogItem[];
  favorites: string[];
  favoriteCollections: string[];
  disliked: string[];
  history: HistoryEntry[];
  /** Real music entities confirmed by native playback, independent of song history. */
  musicEntityHistory: MusicEntityHistoryEntry[];
  playlists: Playlist[];
  /** Imported metadata is independent of collection favorites. */
  importedPlaylists?: CatalogItem[];
  searchHistory: string[];
  settings: AppSettings;
  platforms: PlatformSetting[];
  sources: SourceSetting[];
  profile: MusicProfile;
  localTracks: Track[];
  downloads: DownloadEntry[];
}
export interface HomeMenuProgressEntry {
  revision: number;
  round?: number;
  queries: Record<
    string,
    {
      page: number;
      hasMore: boolean;
      limit?: number;
    }
  >;
  collections: Record<
    string,
    {
      offset: number;
      hasMore: boolean;
    }
  >;
  recentTrackKeys: string[];
}
export interface NativePlayerState {
  audioEffectWarning?: string | null;
  playing: boolean;
  ended?: boolean;
  previousItem?: {
    sequence: number;
    mediaId: string;
    position: number;
    duration: number;
    completed: boolean;
  };
  index: number;
  mediaId?: string | null;
  position: number;
  duration: number;
  volume: number;
  error?: string | null;
  urlRecovery?: {
    token: string;
    mediaId: string;
    position: number;
    resume: boolean;
    status: 'pending' | 'retrying' | 'failed';
  } | null;
  sleepMode?: 'off' | 'minutes' | 'track';
  sleepDeadline?: number;
}
