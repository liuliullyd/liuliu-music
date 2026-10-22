import type {
  CatalogItem,
  DownloadEntry,
  HistoryEntry,
  LibraryMediaKind,
  MediaLibraryBucket,
  PersistedState,
  Track,
} from '../domain/types';

export const emptyMediaLibrary = (): MediaLibraryBucket => ({
  history: [],
  savedTracks: [],
  savedCollections: [],
  favorites: [],
  favoriteCollections: [],
  downloads: [],
  localTracks: [],
});

export const mediaHistory = (
  state: PersistedState,
  kind: LibraryMediaKind,
): HistoryEntry[] =>
  (kind === 'music'
    ? state.history ?? []
    : mediaBucket(state, kind).history ?? []).filter(
    entry => trackMediaKind(entry.track) === kind,
  );

export const trackMediaKind = (
  track: Pick<Track, 'metadata'>,
): LibraryMediaKind => {
  const type = String(track.metadata?.mediaType ?? '').toLowerCase();
  if (type === 'podcast') return 'podcast';
  if (type === 'audiobook' || type === 'long-audio') return 'audiobook';
  return 'music';
};

export const collectionMediaKind = (
  item: Pick<CatalogItem, 'metadata'>,
): LibraryMediaKind => {
  const type = String(item.metadata?.mediaType ?? '').toLowerCase();
  if (type === 'podcast') return 'podcast';
  if (type === 'audiobook' || type === 'long-audio') return 'audiobook';
  return 'music';
};

export const mediaBucket = (
  state: PersistedState,
  kind: Exclude<LibraryMediaKind, 'music'>,
) => (kind === 'podcast' ? state.podcastLibrary : state.audiobookLibrary);

export const mediaDownloads = (
  state: PersistedState,
  kind: LibraryMediaKind,
): DownloadEntry[] =>
  kind === 'music' ? state.downloads : mediaBucket(state, kind).downloads;

export const allDownloads = (state: PersistedState): DownloadEntry[] => [
  ...state.downloads,
  ...state.podcastLibrary.downloads,
  ...state.audiobookLibrary.downloads,
];

export const mediaTracks = (
  state: PersistedState,
  kind: LibraryMediaKind,
): Track[] =>
  kind === 'music' ? state.savedTracks : mediaBucket(state, kind).savedTracks;

export const mediaLocalTracks = (
  state: PersistedState,
  kind: LibraryMediaKind,
): Track[] =>
  kind === 'music'
    ? state.localTracks
    : mediaBucket(state, kind).localTracks ?? [];

export const mediaCollections = (
  state: PersistedState,
  kind: LibraryMediaKind,
): CatalogItem[] =>
  kind === 'music'
    ? state.savedCollections
    : mediaBucket(state, kind).savedCollections;
