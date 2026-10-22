import type {
  CatalogItem,
  DownloadEntry,
  HistoryEntry,
  LibraryMediaKind,
  PersistedState,
  Track,
} from '../domain/types';
export const trackMediaKind = (
  _track: Pick<Track, 'metadata'>,
): LibraryMediaKind => 'music';
export const collectionMediaKind = (
  _item: Pick<CatalogItem, 'metadata'>,
): LibraryMediaKind => 'music';
export const mediaHistory = (
  state: PersistedState,
  _kind: LibraryMediaKind = 'music',
): HistoryEntry[] => state.history ?? [];
export const mediaDownloads = (
  state: PersistedState,
  _kind: LibraryMediaKind = 'music',
): DownloadEntry[] => state.downloads;
export const allDownloads = (state: PersistedState): DownloadEntry[] =>
  state.downloads;
export const mediaTracks = (
  state: PersistedState,
  _kind: LibraryMediaKind = 'music',
): Track[] => state.savedTracks;
export const mediaLocalTracks = (
  state: PersistedState,
  _kind: LibraryMediaKind = 'music',
): Track[] => state.localTracks;
export const mediaCollections = (
  state: PersistedState,
  _kind: LibraryMediaKind = 'music',
): CatalogItem[] => state.savedCollections;
