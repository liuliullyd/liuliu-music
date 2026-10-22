import type { CatalogItem } from '../domain/types';
import { collectionMediaKind } from './mediaLibrary';
export function collectionEntityKind(item: CatalogItem) {
  const media = collectionMediaKind(item);
  if (item.metadata?.collectionKind === 'artist') return 'artist';
  if (
    item.kind === 'new-albums' ||
    item.metadata?.collectionKind === 'new-albums'
  )
    return 'album';
  if (item.kind === 'charts' || item.metadata?.collectionKind === 'charts')
    return 'chart';
  return 'playlist';
}
/** Entity type is part of identity; provider IDs can overlap across catalogs. */
export const collectionFavoriteKey = (item: CatalogItem) =>
  `${item.provider}:${collectionEntityKind(item)}:${item.id}`;
/** Keep orphan legacy keys, migrating only keys backed by complete entities. */
export function normalizeCollectionFavoriteKeys(
  keys: string[],
  items: CatalogItem[],
) {
  return [
    ...new Set(
      keys.flatMap(key => {
        const matches = items.filter(
          item =>
            `${item.provider}:${item.id}` === key &&
            typeof item.title === 'string' &&
            Boolean(item.title.trim()) &&
            ['playlists', 'new-albums', 'charts', 'new-songs'].includes(
              item.kind,
            ),
        );
        return matches.length ? matches.map(collectionFavoriteKey) : [key];
      }),
    ),
  ];
}
