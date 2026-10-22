import type { CatalogItem, PlatformSetting } from '../domain/types';
import { getCatalog, type OnlineProvider } from './onlineCatalog';
import {
  copyMediaCursor,
  createMediaCursor,
  hasExternalMediaOrigin,
  takeMediaBatch,
  type MediaCursor,
} from './mediaDiscoveryPaging';

export interface LibraryPlaylistSnapshot {
  items: CatalogItem[];
  cursor: MediaCursor<CatalogItem>;
  hasMore: boolean;
  error: string;
}

export const createLibraryPlaylistSnapshot = (): LibraryPlaylistSnapshot => ({
  items: [],
  cursor: createMediaCursor<CatalogItem>(),
  hasMore: true,
  error: '',
});

/**
 * Randomize the already fetched batch without changing the provider slots
 * chosen by takeMediaBatch. This keeps the all-platform interleave contract
 * while preventing a deterministic upstream order from becoming the visible
 * recommendation order.
 */
export function randomizeLibraryPlaylistBatch(
  items: CatalogItem[],
  random: () => number = Math.random,
) {
  const buckets = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const bucket = buckets.get(item.provider) ?? [];
    bucket.push(item);
    buckets.set(item.provider, bucket);
  }
  for (const bucket of buckets.values()) {
    for (let index = bucket.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.max(0, Math.min(0.999999, random())) * (index + 1));
      [bucket[index], bucket[target]] = [bucket[target]!, bucket[index]!];
    }
  }
  const offsets = new Map<string, number>();
  return items.map(item => {
    const bucket = buckets.get(item.provider)!;
    const offset = offsets.get(item.provider) ?? 0;
    offsets.set(item.provider, offset + 1);
    return bucket[offset]!;
  });
}

const musicProviders = new Set(['netease', 'qq', 'kugou', 'kuwo', 'migu', 'qishui']);
const spokenMedia =
  /播客|听书|有声(?:书|小说|读物)|广播剧|评书|相声|脱口秀|电台|\bpodcast\b|audio[\s_-]?book|long[\s_-]?audio|spoken[\s_-]?word|\bradio\b/i;

function isMusicPlaylist(item: CatalogItem, provider: OnlineProvider) {
  if (
    item.provider !== provider ||
    item.kind !== 'playlists' ||
    typeof item.id !== 'string' ||
    !item.id.trim() ||
    typeof item.title !== 'string' ||
    !item.title.trim() ||
    hasExternalMediaOrigin(item)
  )
    return false;
  return !spokenMedia.test(
    JSON.stringify([item.title, item.description, item.artist, item.metadata]),
  );
}

// Platforms are the caller's fixed passing launch result, in persisted order.
// This adapter loads genuine catalog collections; it never detects health or
// resolves songs. Each mounted Library surface owns its snapshot/generation.
export async function loadLibraryPlaylistBatch(
  snapshot: LibraryPlaylistSnapshot,
  platforms: PlatformSetting[],
  limit = 10,
): Promise<LibraryPlaylistSnapshot> {
  const providers = [
    ...new Set(
      platforms
        .filter(platform => platform.enabled && musicProviders.has(platform.id))
        .map(platform => platform.id),
    ),
  ];
  if (!providers.length)
    return {
      ...createLibraryPlaylistSnapshot(),
      hasMore: false,
      error: '本次通过启动检测的平台暂无可用精选歌单',
    };

  const cursor = copyMediaCursor(snapshot.cursor);
  const streams = providers.map(provider => ({
    key: `${provider}:playlists`,
    provider,
    query: '精选歌单',
  }));
  try {
    const batch = await takeMediaBatch(
      cursor,
      streams,
      limit,
      item => `${item.provider}:${item.id}`,
      async (stream, page) => {
        const items =
          stream.provider === 'kugou'
            ? await getCatalog(stream.provider, 'playlists', page, '全部', {
                paginateKugouAllPlaylists: true,
              })
            : await getCatalog(stream.provider, 'playlists', page);
        return {
          items: items.filter(item => isMusicPlaylist(item, stream.provider)),
          rawCount: items.length,
          errors: [],
        };
      },
    );
    return {
      items: [
        ...snapshot.items,
        ...randomizeLibraryPlaylistBatch(batch.items),
      ],
      cursor,
      hasMore: batch.hasMore,
      error: [...new Set(batch.errors)].join('；'),
    };
  } catch (error) {
    // A transient all-platform failure must not consume the committed page or
    // replace already visible collections. The next gesture retries that page.
    return {
      ...snapshot,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
