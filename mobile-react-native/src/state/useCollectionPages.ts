import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogItem, PlatformSetting, Track } from '../domain/types';
import {
  loadCollectionTrackBatch,
  type CollectionKind,
} from '../services/collectionPaging';
const empty = (order: 'default' = 'default') => ({
  tracks: [] as Track[],
  buffered: [] as Track[],
  offset: 0,
  loading: false,
  hasMore: true,
  remoteHasMore: true,
  error: '',
  order,
});
const COLLECTION_PAGE_SIZE = 20;
export type CollectionPageSnapshot = ReturnType<typeof empty> & {
  identity: string;
};
export interface CollectionPageReturn {
  version: number;
  state?: CollectionPageSnapshot;
  onChange?: (snapshot: CollectionPageSnapshot) => void;
  requested?: boolean;
}
const copySnapshot = (
  state: CollectionPageSnapshot,
): CollectionPageSnapshot => ({
  ...state,
  tracks: state.tracks.map(({ playUrl: _url, ...track }) => track),
  buffered: state.buffered.map(({ playUrl: _url, ...track }) => track),
  loading: false,
});
export function useCollectionPages(
  item: CatalogItem | null,
  platforms?: PlatformSetting[],
  originReturn?: CollectionPageReturn,
) {
  const cursor = useRef(empty());
  const [snapshot, setSnapshot] = useState(cursor.current);
  const generation = useRef(0);
  const activeRequest = useRef<Promise<void> | null>(null);
  const queuedRequest = useRef(false);
  const provider = item?.provider,
    id = item?.id;
  const requestedKind = item?.metadata?.collectionKind;
  const kind: CollectionKind =
    requestedKind === 'charts' ||
    requestedKind === 'playlists' ||
    requestedKind === 'new-albums' ||
    requestedKind === 'artist'
      ? requestedKind
      : item?.kind === 'charts'
      ? 'charts'
      : item?.kind === 'new-albums'
      ? 'new-albums'
      : 'playlists';
  const order = 'default' as const;
  const requestMetadata = item?.metadata;
  const identity = JSON.stringify([provider, kind, id, order, requestMetadata]);
  const cursorIdentity = useRef('');
  const restoredVersion = useRef(-1);
  const onChange = useRef(originReturn?.onChange);
  onChange.current = originReturn?.onChange;
  let visible =
    (!(originReturn?.state || originReturn?.requested) ||
      cursorIdentity.current === identity) &&
    snapshot.order === order
      ? snapshot
      : { ...empty(order), loading: true };
  if (
    originReturn?.state?.identity === identity &&
    restoredVersion.current !== originReturn.version
  ) {
    restoredVersion.current = originReturn.version;
    generation.current += 1;
    queuedRequest.current = false;
    activeRequest.current = null;
    cursor.current = copySnapshot(originReturn.state);
    cursorIdentity.current = identity;
    visible = cursor.current;
    setSnapshot(cursor.current);
  }
  const loadMore = useCallback(() => {
    if (
      !provider ||
      !id ||
      !cursor.current.hasMore ||
      cursor.current.order !== order
    )
      return Promise.resolve();
    if (activeRequest.current) return activeRequest.current;
    queuedRequest.current = true;
    const version = generation.current;
    const request = (async () => {
      try {
        while (
          queuedRequest.current &&
          cursor.current.hasMore &&
          generation.current === version
        ) {
          queuedRequest.current = false;
          const start = cursor.current;
          let offset = start.offset;
          let remoteHasMore = start.remoteHasMore;
          const buffered = [...start.buffered];
          let additions: Track[] = [];
          const seen = new Set(
            [...start.tracks, ...buffered].map(track => track.id),
          );
          cursor.current = { ...start, loading: true, error: '' };
          setSnapshot(cursor.current);
          try {
            // A requested twenty-song display page may span several remote
            // pages after filtering and de-duplication.  Continue on the same
            // cursor until the display batch is full or the remote ends.
            while (
              (buffered.length > 0 || remoteHasMore) &&
              additions.length < COLLECTION_PAGE_SIZE &&
              generation.current === version
            ) {
              if (buffered.length) {
                additions.push(
                  ...buffered.splice(
                    0,
                    COLLECTION_PAGE_SIZE - additions.length,
                  ),
                );
                continue;
              }
              const result =
                requestMetadata?.source === 'home-live'
                  ? await loadCollectionTrackBatch(
                      provider,
                      kind,
                      id,
                      offset,
                      COLLECTION_PAGE_SIZE,
                      requestMetadata,
                      platforms,
                    )
                  : await loadCollectionTrackBatch(
                      provider,
                      kind,
                      id,
                      offset,
                      COLLECTION_PAGE_SIZE,
                      requestMetadata,
                    );
              offset += COLLECTION_PAGE_SIZE;
              remoteHasMore = result.hasMore;
              for (const track of result.tracks) {
                if (seen.has(track.id)) continue;
                seen.add(track.id);
                buffered.push(track);
              }
              if (!result.tracks.length && !remoteHasMore) break;
            }
            if (generation.current !== version) return;
            cursor.current = {
              tracks: [...start.tracks, ...additions],
              order,
              buffered,
              offset,
              hasMore: buffered.length > 0 || remoteHasMore,
              remoteHasMore,
              loading: false,
              error: '',
            };
          } catch (error) {
            if (generation.current !== version) return;
            console.warn(
              '[collection-page-error]',
              JSON.stringify({
                provider,
                kind,
                id,
                offset,
                message: error instanceof Error ? error.message : String(error),
              }),
            );
            cursor.current = {
              tracks: [...start.tracks, ...additions],
              order,
              buffered,
              offset,
              hasMore: buffered.length > 0 || remoteHasMore,
              remoteHasMore,
              loading: false,
              error: error instanceof Error ? error.message : '歌曲加载失败',
            };
          }
          setSnapshot(cursor.current);
          if (cursor.current.error) break;
        }
      } finally {
        if (generation.current === version) {
          cursor.current = { ...cursor.current, loading: false };
          setSnapshot(cursor.current);
        }
        if (generation.current === version) activeRequest.current = null;
      }
    })();
    activeRequest.current = request;
    return request;
  }, [provider, id, kind, requestMetadata, platforms, order]);
  useEffect(() => {
    generation.current += 1;
    queuedRequest.current = false;
    activeRequest.current = null;
    if (
      originReturn?.state?.identity === identity &&
      restoredVersion.current === originReturn.version
    ) {
      return () => {
        generation.current += 1;
      };
    }
    cursorIdentity.current = identity;
    cursor.current = empty(order);
    setSnapshot(cursor.current);
    loadMore();
    return () => {
      generation.current += 1;
    };
  }, [
    identity,
    loadMore,
    order,
    originReturn?.state?.identity,
    originReturn?.version,
  ]);
  // A changed direction must not render the preceding direction's rows even
  // during the render before the effect resets its cursor and request generation.
  useEffect(() => {
    if (cursorIdentity.current === identity)
      onChange.current?.(copySnapshot({ ...cursor.current, identity }));
  }, [identity, snapshot]);
  return {
    ...visible,
    loadMore,
    kind,
    requestMetadata,
    snapshot: () => copySnapshot({ ...cursor.current, identity }),
  };
}
