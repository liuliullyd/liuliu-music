import { trackQueueKey, type CatalogItem, type Track } from '../domain/types';
import type { CarLibraryItem, CarLibrarySnapshot } from './carLibrary';
import { carCatalogDurationMs } from './carMediaFacts';
import { carCatalogParent } from './carPlatformPlaylists';
import { CatalogRequestBudget } from './catalogRequestBudget';
import {
  collectionEntityKind,
  collectionFavoriteKey,
} from './collectionIdentity';
import {
  loadCollectionTrackBatch,
  type CollectionKind,
} from './collectionPaging';
import {
  libraryPlaybackTrack,
  libraryUnavailableReason,
} from './libraryPlayback';
import { linkedPlaylists } from './linkedPlaylist';
const PREFIX = 'car:linked:';
const SIZE = 20;
const collectionKind = (item: CatalogItem): CollectionKind | undefined => {
  if (collectionEntityKind(item) === 'artist') return 'artist';
  if (
    item.kind === 'playlists' ||
    item.kind === 'new-albums' ||
    item.kind === 'charts'
  )
    return item.kind;
  return undefined;
};
export const carLinkedParent = (item: CatalogItem, offset = 0) =>
  `${PREFIX}${item.provider}:${encodeURIComponent(item.id)}:${offset}`;
export const carFavoriteParent = (item: CatalogItem, offset = 0) =>
  `car:favorite:${encodeURIComponent(collectionFavoriteKey(item))}:${offset}`;
export const isCarLinkedParent = (parent: string) =>
  parent.startsWith(PREFIX) ||
  parent.startsWith('car:favorite:') ||
  parent.startsWith('car:catalog:');
export function carFavoriteCollections(
  snapshot: CarLibrarySnapshot,
): CatalogItem[] {
  const keys = new Set(snapshot.state.favoriteCollections);
  return [
    ...new Map(
      snapshot.state.savedCollections
        .filter(
          item => collectionKind(item) && keys.has(collectionFavoriteKey(item)),
        )
        .map(item => [collectionFavoriteKey(item), item]),
    ).values(),
  ];
}
export function carFavoriteFolders(
  snapshot: CarLibrarySnapshot,
): CarLibraryItem[] {
  return carFavoriteCollections(snapshot).map(item => ({
    id: carFavoriteParent(item),
    title: item.title,
    cover: item.cover,
    browsable: true,
    playable: false,
    parent: 'car:favorites',
  }));
}
export function carLinkedFolders(
  snapshot: CarLibrarySnapshot,
): CarLibraryItem[] {
  return linkedPlaylists(snapshot.state).map(item => ({
    id: carLinkedParent(item),
    title: item.title,
    cover: item.cover,
    browsable: true,
    playable: false,
    parent: 'car:playlists',
  }));
}
/** Explicit car browsing only. Process metadata pages, no URLs, persisted song rows or Player calls. */
export class CarLinkedPlaylists {
  constructor(
    private catalogReference?: (parent: string) => CatalogItem | undefined,
  ) {}
  private pages = new Map<
    string,
    {
      tracks: Track[];
      hasMore: boolean;
    }
  >();
  private active = new Map<
    string,
    {
      budget: CatalogRequestBudget;
      promise: Promise<void>;
    }
  >();
  private closed = false;
  private reference(snapshot: CarLibrarySnapshot, parent: string) {
    const catalog = /^car:catalog:([^:]+):([^:]+):(\d+)$/.exec(parent);
    if (catalog) {
      const offset = Number(catalog[3]);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset % SIZE)
        return null;
      const item = this.catalogReference?.(parent);
      return item && item.kind === 'playlists'
        ? { item, offset, kind: 'playlists' as const, next: carCatalogParent }
        : null;
    }
    const favorite = /^car:favorite:([^:]+):(\d+)$/.exec(parent);
    if (favorite) {
      const offset = Number(favorite[2]);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset % SIZE)
        return null;
      const item = carFavoriteCollections(snapshot).find(
        value =>
          collectionFavoriteKey(value) === decodeURIComponent(favorite[1]!),
      );
      const kind = item && collectionKind(item);
      return item && kind
        ? { item, offset, kind, next: carFavoriteParent }
        : null;
    }
    const match = /^car:linked:([^:]+):([^:]+):(\d+)$/.exec(parent);
    if (!match) return null;
    const offset = Number(match[3]);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % SIZE)
      return null;
    const id = decodeURIComponent(match[2]!);
    const item = linkedPlaylists(snapshot.state).find(
      value => value.provider === match[1] && value.id === id,
    );
    const kind = item && collectionKind(item);
    return item && kind ? { item, offset, kind, next: carLinkedParent } : null;
  }
  async browse(
    snapshot: CarLibrarySnapshot,
    parent: string,
    page: number,
    pageSize: number,
  ): Promise<CarLibraryItem[]> {
    if (
      this.closed ||
      !Number.isSafeInteger(page) ||
      page < 0 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      return [];
    const reference = this.reference(snapshot, parent);
    if (!reference) return [];
    if (!this.pages.has(parent)) {
      let flight = this.active.get(parent);
      if (!flight) {
        const budget = new CatalogRequestBudget(8000, 1);
        const promise = (async () => {
          try {
            const result = await budget.wait(
              loadCollectionTrackBatch(
                reference.item.provider,
                reference.kind,
                reference.item.id,
                reference.offset,
                SIZE,
                reference.item.metadata,
                undefined,
                budget,
              ),
            );
            budget.assertActive();
            if (this.closed) return;
            const seen = new Set<string>();
            const tracks = result.tracks
              .slice(0, SIZE)
              .filter(track => {
                const key = trackQueueKey(track);
                if (track.provider !== reference.item.provider || seen.has(key))
                  return false;
                seen.add(key);
                return true;
              })
              .map(({ playUrl: _url, ...track }) => track);
            this.pages.set(parent, { tracks, hasMore: result.hasMore });
            if (this.pages.size > 20)
              this.pages.delete(this.pages.keys().next().value!);
          } finally {
            budget.close();
            this.active.delete(parent);
          }
        })();
        flight = { budget, promise };
        this.active.set(parent, flight);
      }
      await flight.promise;
    }
    if (this.closed) return [];
    const stored = this.pages.get(parent);
    if (!stored) return [];
    const items: CarLibraryItem[] = stored.tracks
      .map(track => libraryPlaybackTrack(track, snapshot.state))
      .map(track => ({
        id:
          'car:track:' +
          encodeURIComponent(parent) +
          ':' +
          encodeURIComponent(trackQueueKey(track)),
        title: track.title,
        artist: track.artist,
        album: track.album,
        durationMs: carCatalogDurationMs(track),
        cover: track.cover,
        parent,
        browsable: false,
        playable: !libraryUnavailableReason(track, snapshot.providers),
      }));
    if (stored.hasMore)
      items.push({
        id: reference.next(reference.item, reference.offset + SIZE),
        title: `下一页（第 ${reference.offset + SIZE + 1} 首起）`,
        parent,
        browsable: true,
        playable: false,
      });
    return items.slice(page * pageSize, (page + 1) * pageSize);
  }
  selection(snapshot: CarLibrarySnapshot, parent: string, mediaId: string) {
    const reference = this.reference(snapshot, parent),
      stored = this.pages.get(parent);
    if (!reference || !stored) return null;
    const prefix = 'car:track:' + encodeURIComponent(parent) + ':';
    if (!mediaId.startsWith(prefix)) return null;
    const key = decodeURIComponent(mediaId.slice(prefix.length));
    const tracks = stored.tracks
      .map(track => libraryPlaybackTrack(track, snapshot.state))
      .filter(track => !libraryUnavailableReason(track, snapshot.providers));
    const index = tracks.findIndex(track => trackQueueKey(track) === key);
    if (index < 0) return null;
    return {
      track: tracks[index]!,
      tracks,
      index,
      item: reference.item,
      historyOrigin: { item: reference.item },
      queueSource: {
        kind: 'collection' as const,
        collectionKind: reference.kind,
        provider: reference.item.provider,
        id: reference.item.id,
        metadata: reference.item.metadata,
        offset: reference.offset + SIZE,
        hasMore: stored.hasMore,
      },
    };
  }
  close() {
    this.closed = true;
    this.active.forEach(flight => flight.budget.close());
    this.active.clear();
    this.pages.clear();
  }
}
