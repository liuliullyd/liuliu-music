import type { CatalogItem } from '../domain/types';

export type CollectionEpisodeOrder = 'default' | 'oldest';

export function isEpisodeCollection(item: CatalogItem | null): boolean {
  const metadata = item?.metadata;
  return Boolean(
    item &&
      (metadata?.mediaType === 'podcast' ||
        metadata?.mediaType === 'long-audio' ||
        metadata?.collectionKind === 'podcast' ||
        metadata?.collectionKind === 'audiobook'),
  );
}

/** A request snapshot only; never write ordering into the saved collection. */
export function collectionOrderMetadata(
  metadata: CatalogItem['metadata'],
  order: CollectionEpisodeOrder,
): CatalogItem['metadata'] {
  return order === 'oldest'
    ? { ...metadata, collectionEpisodeOrder: 'oldest' }
    : metadata;
}

export function collectionOrderItem(
  item: CatalogItem | null,
  order: CollectionEpisodeOrder,
): CatalogItem | null {
  return item && order === 'oldest' && isEpisodeCollection(item)
    ? { ...item, metadata: collectionOrderMetadata(item.metadata, order) }
    : item;
}
