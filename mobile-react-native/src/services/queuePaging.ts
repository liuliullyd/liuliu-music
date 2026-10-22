import type {
  CatalogItem,
  DiscoveryCategory,
  PlatformSetting,
  Track,
} from '../domain/types';
import { trackQueueKey } from '../domain/types';
import {
  loadCollectionTrackBatch,
  type CollectionKind,
} from './collectionPaging';
import { loadHomeMenuPage, type HomeMenuCursor } from './homeMenuDiscovery';
import { shuffleHomeMenuSceneValues } from './homeMenuSceneOrder';
import {
  loadChartTrackBatch,
  loadMixedChartTrackBatch,
  type HomeChartSource,
} from './homeNewReleases';
import { constituentArtists, loadCategoryFeedPage } from './liveDiscovery';
import { loadLiveTracks } from './mediaDiscovery';
import { copyMediaCursor, type MediaCursor } from './mediaDiscoveryPaging';
import type { OnlineProvider } from './onlineCatalog';
import { searchOnline } from './onlineMusic';

export const QUEUE_BATCH_SIZE = 20;
export const QUEUE_PAGE_TIMEOUT_MS = 20_000;

type QueueContinuation = {
  buffered?: Track[];
  remoteHasMore?: boolean;
  /** Keys already published in the logical queue for cross-page de-duping. */
  seenKeys?: string[];
};
type QueueSourceList = { kind: 'list'; hasMore: boolean } & QueueContinuation;
type QueueSourceHomeMenu = {
  kind: 'home-menu';
  /** Launch is a lifecycle marker on the default mode, never a separate recommendation stream. */
  startup?: boolean;
  cursor: HomeMenuCursor;
  hasMore: boolean;
  /** All forty-five menu entrances share a five-first partial page. */
  initialMenuBatch?: { remaining: number; artists: string[] };
} & QueueContinuation;
type QueueSourceSearch = {
  kind: 'search';
  query: string;
  provider: 'all' | Track['provider'];
  page: number;
  hasMore: boolean;
  providerPages?: Partial<Record<OnlineProvider, number>>;
  exhaustedProviders?: OnlineProvider[];
} & QueueContinuation;
type QueueSourceCatalogPage = {
  kind: 'catalog-page';
  page: number;
  hasMore: boolean;
  /** Process-only continuation captured from a mounted typed catalog. */
  loadPage: (
    page: number,
    signal?: AbortSignal,
  ) => Promise<{ tracks: Track[]; hasMore: boolean }>;
} & QueueContinuation;
type QueueSourceChart = {
  kind: 'chart';
  provider: OnlineProvider;
  id: string;
  offset: number;
  hasMore: boolean;
} & QueueContinuation;
type QueueSourceChartMix = {
  kind: 'chart-mix';
  sources: HomeChartSource[];
  offset: number;
  hasMore: boolean;
} & QueueContinuation;
type QueueSourceCollection = {
  kind: 'collection';
  provider: OnlineProvider;
  collectionKind: CollectionKind;
  id: string;
  metadata?: CatalogItem['metadata'];
  offset: number;
  hasMore: boolean;
} & QueueContinuation;
type QueueSourceFeed = {
  kind: 'feed';
  category: DiscoveryCategory;
  page: number;
  hasMore: boolean;
  remaining?: Track[];
} & QueueContinuation;
type QueueSourceLive = {
  kind: 'live';
  provider: 'all' | OnlineProvider;
  page: number;
  /** Remote page width stays fixed when a rail becomes a twenty-song queue. */
  pageSize?: number;
  hasMore: boolean;
  /** Keep the exact Home platform set used when the rail was rendered. */
  platforms?: PlatformSetting[];
} & QueueContinuation;
export type QueueSource =
  | QueueSourceList
  | QueueSourceHomeMenu
  | QueueSourceSearch
  | QueueSourceCatalogPage
  | QueueSourceChart
  | QueueSourceChartMix
  | QueueSourceCollection
  | QueueSourceFeed
  | QueueSourceLive;

export function isStartupQueueSource(source: QueueSource | null | undefined) {
  return source?.kind === 'home-menu' && source.startup === true;
}

/** Queue paging owns a copy and never advances the mounted typed catalog. */
export function catalogSnapshotQueueSource(
  snapshot: { page: number; hasMore: boolean; cursor: MediaCursor<Track> },
  loader: (
    page: number,
    cursor: MediaCursor<Track>,
  ) => Promise<{ items: Track[]; hasMore: boolean; errors?: string[] }>,
): QueueSource {
  let cursor = copyMediaCursor(snapshot.cursor);
  return {
    kind: 'catalog-page',
    page: snapshot.page,
    hasMore: snapshot.hasMore,
    loadPage: async (page, signal) => {
      const next = copyMediaCursor(cursor);
      const result = await loader(page, next);
      if (signal?.aborted) throw new Error('播放列表请求已取消');
      if (!result.items.length && result.errors?.length)
        throw new Error(result.errors.join('；'));
      cursor = next;
      return { tracks: result.items, hasMore: result.hasMore };
    },
  };
}

/** Preserve loaded input independently of the remote/API continuation. */
export function withQueueRemainder(
  source: QueueSource | null,
  tracks: Track[],
): QueueSource {
  const base = source ?? { kind: 'list' as const, hasMore: false };
  const buffered = [...tracks, ...(base.buffered ?? [])];
  const remoteHasMore = base.remoteHasMore ?? base.hasMore;
  const seenKeys = new Set(base.seenKeys ?? []);
  tracks.forEach(track => seenKeys.add(trackQueueKey(track)));
  return {
    ...base,
    buffered,
    remoteHasMore,
    seenKeys: [...seenKeys],
    hasMore: buffered.length > 0 || remoteHasMore,
  };
}

export function sourceWithSeenKeys(
  source: QueueSource,
  keys: Iterable<string>,
) {
  const seen = new Set(source.seenKeys ?? []);
  for (const key of keys) seen.add(key);
  return { ...source, seenKeys: [...seen] } as QueueSource;
}

export function queueSourceProgressKey(source: QueueSource) {
  const value = source as QueueSource & {
    offset?: number;
    page?: number;
    cursor?: HomeMenuCursor;
    remaining?: Track[];
    buffered?: Track[];
  };
  const cursor =
    source.kind === 'home-menu' &&
    (source.cursor.choiceId === 'scene-80s' ||
      source.cursor.choiceId === 'scene-90s')
      ? {
          ...source.cursor,
          providers: source.cursor.providers.map(provider => ({
            ...provider,
            // Rotating a recall direction or re-shuffling the same rejected pool
            // is not catalog progress. Keep the live cursor/order untouched and
            // let the existing queue stall guard stop an empty continuation.
            recallRouteIndex: undefined,
            candidates: [...provider.candidates].sort((left, right) => {
              const key = (item: typeof left) =>
                `${trackQueueKey(item.track)}\0${item.query}\0${
                  item.collection?.provider ?? ''
                }\0${item.collection?.id ?? ''}`;
              const a = key(left),
                b = key(right);
              return a < b ? -1 : a > b ? 1 : 0;
            }),
          })),
        }
      : value.cursor;
  return JSON.stringify({
    kind: source.kind,
    offset: value.offset,
    page: value.page,
    cursor,
    remaining: value.remaining?.map(trackQueueKey),
    buffered: value.buffered?.map(trackQueueKey),
    hasMore: source.hasMore,
    ...(source.kind === 'search'
      ? {
          providerPages: source.providerPages,
          exhaustedProviders: source.exhaustedProviders,
        }
      : {}),
  });
}

function uniquePage(source: QueueSource, tracks: Track[]) {
  const seen = new Set(source.seenKeys ?? []);
  const unique = tracks.filter(track => {
    const key = trackQueueKey(track);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { tracks: unique, seenKeys: [...seen] };
}

function queuePageResult(
  source: QueueSource,
  tracks: Track[],
  remoteHasMore: boolean,
  batchSize: number,
) {
  const page = uniquePage(source, tracks);
  const buffered = page.tracks.slice(batchSize);
  return {
    tracks: page.tracks.slice(0, batchSize),
    source: {
      ...source,
      seenKeys: page.seenKeys,
      buffered,
      remoteHasMore,
      hasMore: buffered.length > 0 || remoteHasMore,
    } as QueueSource,
  };
}

export async function nextQueuePage(
  source: QueueSource,
  platforms: PlatformSetting[],
  batchSize = QUEUE_BATCH_SIZE,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ tracks: Track[]; source: QueueSource }> {
  if (options.timeoutMs !== undefined && options.timeoutMs <= 0)
    throw new Error('播放列表加载超时，请重试');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => {
      reject(
        Object.assign(new Error('播放列表请求已取消'), { name: 'AbortError' }),
      );
      controller.abort();
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) {
      cancel();
      return;
    }
    timer = setTimeout(() => {
      reject(new Error('播放列表加载超时，请重试'));
      controller.abort();
    }, Math.max(1, options.timeoutMs ?? QUEUE_PAGE_TIMEOUT_MS));
  });
  try {
    if (controller.signal.aborted) return await cancelled;
    return await Promise.race([
      readQueuePage(source, platforms, batchSize, controller.signal),
      cancelled,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

async function readQueuePage(
  source: QueueSource,
  platforms: PlatformSetting[],
  batchSize: number,
  signal: AbortSignal,
): Promise<{ tracks: Track[]; source: QueueSource }> {
  if (source.kind === 'live') {
    const livePlatforms = source.platforms ?? platforms;
    const buffered: Track[] = [...(source.buffered ?? [])];
    const seenKeys = new Set([
      ...(source.seenKeys ?? []),
      ...buffered.map(trackQueueKey),
    ]);
    const pageSize = source.pageSize ?? QUEUE_BATCH_SIZE;
    let page = source.page;
    let remoteHasMore = source.remoteHasMore ?? source.hasMore;

    // A cold Live tap starts with the rail's eighteen tracks. Queue hydration
    // may therefore ask for only the missing two, but the remote page still
    // belongs to the queue. Keep its unused tracks so later twenty-song
    // continuations cannot skip entries between pages.
    while (buffered.length < batchSize && remoteHasMore) {
      let result: Awaited<ReturnType<typeof loadLiveTracks>>;
      try {
        result = await loadLiveTracks(
          page + 1,
          livePlatforms,
          source.provider,
          pageSize,
        );
        if (result.retryable) throw new Error(result.errors.join('；'));
      } catch (error) {
        // Return successfully consumed pages before surfacing a later failure.
        // The caller can commit this cursor and retry the failed page exactly.
        if (page === source.page) throw error;
        break;
      }
      page += 1;
      for (const track of result.tracks) {
        const key = trackQueueKey(track);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        buffered.push(track);
      }
      remoteHasMore = result.hasMore;
    }

    const tracks = buffered.slice(0, batchSize);
    const remaining = buffered.slice(batchSize);
    const nextSource: QueueSourceLive = {
      ...source,
      page,
      seenKeys: [...seenKeys],
      hasMore: remaining.length > 0 || remoteHasMore,
    };
    if (remaining.length) {
      nextSource.buffered = remaining;
      nextSource.remoteHasMore = remoteHasMore;
    } else {
      delete nextSource.buffered;
      delete nextSource.remoteHasMore;
    }
    return { tracks, source: nextSource };
  }
  if (source.buffered?.length) {
    const tracks = source.buffered.slice(0, batchSize);
    const buffered = source.buffered.slice(batchSize);
    return {
      tracks,
      source: {
        ...source,
        buffered,
        hasMore: buffered.length > 0 || (source.remoteHasMore ?? false),
      },
    };
  }
  if (source.kind === 'list')
    return { tracks: [] as Track[], source: { ...source, hasMore: false } };
  if (source.kind === 'catalog-page') {
    const result = await source.loadPage(source.page + 1, signal);
    return queuePageResult(
      { ...source, page: source.page + 1 },
      result.tracks,
      result.hasMore,
      batchSize,
    );
  }
  if (source.kind === 'home-menu') {
    // Menu queues retain the single platform selected for their first page.
    // Other platforms finishing launch detection cannot widen this cursor.
    const menuPlatforms = platforms.filter(
      platform =>
        platform.enabled && platform.id === source.cursor.providers[0]?.id,
    );
    if (!menuPlatforms.length) throw new Error('本次启动没有可用的音乐平台');
    const initial = source.initialMenuBatch;
    const result = initial
      ? await loadHomeMenuPage(
          source.cursor.choiceId,
          menuPlatforms,
          source.cursor.profile,
          source.cursor.history,
          Math.min(batchSize, initial.remaining),
          source.cursor,
          {
            ...(source.cursor.choiceId.startsWith('scene-')
              ? { randomizeSceneBatch: true }
              : {}),
            excludedArtists: initial.artists,
            signal,
          },
        )
      : await loadHomeMenuPage(
          source.cursor.choiceId,
          menuPlatforms,
          source.cursor.profile,
          source.cursor.history,
          batchSize,
          source.cursor,
          { signal },
        );
    const loaded =
      initial && source.cursor.choiceId.startsWith('scene-')
        ? shuffleHomeMenuSceneValues(result.tracks)
        : result.tracks;
    const { tracks, seenKeys } = uniquePage(source, loaded);
    const remaining = initial
      ? Math.max(0, initial.remaining - tracks.length)
      : 0;
    return {
      tracks,
      source: {
        ...source,
        cursor: result.cursor,
        seenKeys,
        remoteHasMore: result.hasMore,
        hasMore: result.hasMore,
        ...(initial
          ? {
              initialMenuBatch:
                remaining > 0 && (result.hasMoreForMenuBatch ?? result.hasMore)
                  ? {
                      remaining,
                      artists: [
                        ...new Set([
                          ...initial.artists,
                          ...tracks.flatMap(item =>
                            constituentArtists(item.artist),
                          ),
                        ]),
                      ],
                    }
                  : undefined,
            }
          : {}),
      },
    };
  }
  if (source.kind === 'search') {
    const exhausted = new Set(source.exhaustedProviders ?? []);
    const providers = platforms
      .filter(
        platform =>
          platform.enabled &&
          (source.provider === 'all' || platform.id === source.provider) &&
          !exhausted.has(platform.id),
      )
      .map(platform => platform.id);
    if (!providers.length)
      return { tracks: [], source: { ...source, hasMore: false } };
    const providerPages = { ...source.providerPages };
    providers.forEach(provider => {
      providerPages[provider] ??= source.page + 1;
    });
    const settled = await Promise.allSettled(
      providers.map(async provider => {
        const page = providerPages[provider] ?? source.page + 1;
        const result = await searchOnline(
          source.query,
          page,
          QUEUE_BATCH_SIZE,
          provider,
          platforms,
        );
        if (
          !result.tracks.length &&
          result.errors.length &&
          !Number.isFinite(result.rawCount)
        )
          throw new Error(result.errors.join('；'));
        return { page, result };
      }),
    );
    if (settled.every(result => result.status === 'rejected')) {
      const failure = settled.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      throw failure?.reason ?? new Error('搜索续页请求失败，请重试');
    }
    const tracks = settled.flatMap((result, index) => {
      if (result.status === 'rejected') return [];
      const provider = providers[index]!;
      providerPages[provider] = result.value.page + 1;
      const page = result.value.result;
      if (
        !(Number.isFinite(page.rawCount)
          ? Number(page.rawCount) > 0
          : page.tracks.length > 0)
      )
        exhausted.add(provider);
      return page.tracks;
    });
    return queuePageResult(
      {
        ...source,
        page: source.page + 1,
        providerPages,
        exhaustedProviders: [...exhausted],
      },
      tracks,
      providers.some(provider => !exhausted.has(provider)),
      batchSize,
    );
  }
  if (source.kind === 'collection') {
    const result = source.metadata
      ? await loadCollectionTrackBatch(
          source.provider,
          source.collectionKind,
          source.id,
          source.offset,
          QUEUE_BATCH_SIZE,
          source.metadata,
        )
      : await loadCollectionTrackBatch(
          source.provider,
          source.collectionKind,
          source.id,
          source.offset,
          QUEUE_BATCH_SIZE,
        );
    return queuePageResult(
      { ...source, offset: source.offset + QUEUE_BATCH_SIZE },
      result.tracks,
      result.hasMore,
      batchSize,
    );
  }
  if (source.kind === 'chart') {
    const result = await loadChartTrackBatch(
      source.provider,
      source.id,
      source.offset,
      QUEUE_BATCH_SIZE,
    );
    return queuePageResult(
      { ...source, offset: source.offset + QUEUE_BATCH_SIZE },
      result.tracks,
      result.hasMore,
      batchSize,
    );
  }
  if (source.kind === 'chart-mix') {
    const result = await loadMixedChartTrackBatch(
      source.sources,
      source.offset,
      QUEUE_BATCH_SIZE,
      undefined,
      true,
    );
    return queuePageResult(
      { ...source, offset: source.offset + QUEUE_BATCH_SIZE },
      result.tracks,
      result.hasMore,
      batchSize,
    );
  }
  if (source.remaining?.length) {
    const tracks = source.remaining.slice(0, batchSize);
    const remaining = source.remaining.slice(batchSize);
    return {
      tracks,
      source: {
        ...source,
        remaining,
        hasMore:
          remaining.length > 0 || (source.remoteHasMore ?? source.hasMore),
      },
    };
  }
  const loaded = await loadCategoryFeedPage(
    source.category,
    source.page + 1,
    platforms,
  );
  if (loaded.retryable) throw new Error('推荐续页请求失败，请重试');
  const page = uniquePage(source, loaded.tracks);
  const tracks = page.tracks.slice(0, batchSize);
  return {
    tracks,
    source: {
      ...source,
      page: source.page + 1,
      seenKeys: page.seenKeys,
      remaining: page.tracks.slice(batchSize),
      remoteHasMore: loaded.hasMore,
      hasMore: page.tracks.length > batchSize || loaded.hasMore,
    },
  };
}
