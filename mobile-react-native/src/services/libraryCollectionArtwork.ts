import type { CatalogItem, Track } from '../domain/types';
import { trackCoverCandidates } from './onlineCatalog';

/** Roam details retain their entity artwork; only a missing entity cover uses the first displayed song. */
export function libraryCollectionArtwork(
  item: CatalogItem | null,
  firstTrack?: Track,
) {
  const own = Array.from(
    new Set(
      [item?.cover, ...(item?.coverCandidates ?? [])]
        .filter(
          (uri): uri is string =>
            typeof uri === 'string' && /^https?:\/\//i.test(uri.trim()),
        )
        .map(uri => uri.trim()),
    ),
  );
  const candidates = own.length
    ? own
    : firstTrack && item && firstTrack.provider === item.provider
    ? trackCoverCandidates(firstTrack)
    : [];
  return { cover: candidates[0], coverCandidates: candidates };
}
