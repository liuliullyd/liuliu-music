import type { CatalogItem, PlatformSetting, Track } from '../domain/types';
import {
  searchOnlinePlaylists,
  searchOnline,
  loadLatestKugouNovelEpisodes,
  loadLatestNeteaseAudiobookEpisodes,
} from './onlineMusic';
import {
  createMediaCursor,
  mediaProviders,
  isMediaEntity,
  takeMediaBatch,
  type MediaCursor,
  interleaveMediaStreams,
} from './mediaDiscoveryPaging';

export interface AudiobookPage<T> {
  items: T[];
  errors: string[];
  hasMore: boolean;
}
export async function loadLatestAudiobookEpisodes(
  page: number,
  platforms: PlatformSetting[],
  limit = 18,
  cursor?: MediaCursor<Track>,
): Promise<AudiobookPage<Track>> {
  const current = cursor ?? createMediaCursor<Track>();
  const streams = mediaProviders(platforms, 'audiobook', false).map(
    provider => ({
      provider,
      key: `${provider}:latest-novel-episodes`,
      query: 'latest-novel-episodes',
    }),
  );
  const fetchBatch = () =>
    takeMediaBatch(
      current,
      streams,
      limit,
      track => `${track.provider}:${track.providerId ?? track.id}`,
      async (stream, sourcePage, size, reportProgress) => {
        const mediaOptions = {
          signal: current.signal,
          onTracks: (tracks: Track[]) => reportProgress(tracks.filter(track => isMediaEntity(track, 'audiobook', stream.provider))),
        };
        const result =
          stream.provider === 'netease'
            ? await loadLatestNeteaseAudiobookEpisodes(sourcePage, size, mediaOptions)
            : stream.provider === 'kugou'
            ? await loadLatestKugouNovelEpisodes(sourcePage, size)
            : await searchOnline(
                '最新有声小说',
                sourcePage,
                size,
                stream.provider,
                platforms,
                'audiobook',
                6000,
                mediaOptions,
              );
        return {
          items: result.tracks.filter(track =>
            isMediaEntity(track, 'audiobook', stream.provider),
          ),
          rawCount:
            'rawCount' in result ? result.rawCount : result.tracks.length,
          errors: 'errors' in result ? result.errors : [],
        };
      },
      { fetchAttempts: 1 },
    );
  if (!cursor) for (let index = 1; index < page; index += 1) await fetchBatch();
  return fetchBatch();
}
const audiobookCollectionCategories = [
  '玄幻小说',
  '武侠小说',
  '都市小说',
  '言情小说',
  '悬疑推理',
  '历史小说',
  '科幻小说',
  '经典名著',
  '文学小说',
  '传记故事',
  '军事小说',
  '官场小说',
  '青春小说',
  '穿越小说',
  '仙侠小说',
  '刑侦小说',
  '民间故事',
  '世界名著',
] as const;

export const audiobookTrackCategories = [
  { key: 'male', title: '男频热榜', query: '男频热榜' },
  { key: 'female', title: '女频热榜', query: '女频热榜' },
  { key: 'potential', title: '潜力佳作', query: '潜力佳作' },
  { key: 'featured', title: '精品', query: '精品' },
  { key: 'mystery', title: '悬疑脑洞', query: '悬疑脑洞' },
  { key: 'literature', title: '文学经典', query: '文学经典' },
] as const;

export const audiobookQuery = (query: string) =>
  query.includes('男频')
    ? '玄幻 有声小说'
    : query.includes('女频')
    ? '言情 有声小说'
    : query.includes('潜力')
    ? '悬疑 有声小说'
    : query;
const queries = (query: string) => [
  ...new Set([
    audiobookQuery(query),
    `${audiobookQuery(query)} 有声书`,
    ...(/^(推荐有声小说|最新有声小说)$/.test(query)
      ? ['有声小说', '有声书']
      : []),
  ]),
];
export async function loadAudiobookCollections(
  query: string,
  page: number,
  platforms: PlatformSetting[],
  limit = 10,
  cursor?: MediaCursor<CatalogItem>,
): Promise<AudiobookPage<CatalogItem>> {
  const current = cursor ?? createMediaCursor<CatalogItem>();
  const streams = interleaveMediaStreams(
    mediaProviders(platforms, 'audiobook', true).map(provider =>
      queries(query).map(term => ({
        key: `${provider}:${term}`,
        provider,
        query: term,
      })),
    ),
  );
  const fetchBatch = () =>
    takeMediaBatch(
      current,
      streams,
      limit,
      item => `${item.provider}:${item.id}`,
      async (stream, requestPage, size) => {
        const result = await searchOnlinePlaylists(
          stream.query,
          requestPage,
          size,
          stream.provider,
          platforms,
          'audiobook',
          { signal: current.signal },
        );
        return {
          ...result,
          rawCount: result.items.length,
          items: result.items.filter(item =>
            isMediaEntity(item, 'audiobook', stream.provider),
          ),
        };
      },
      { randomize: true, fetchAttempts: 1 },
    );
  if (!cursor) for (let index = 1; index < page; index += 1) await fetchBatch();
  return fetchBatch();
}
// Track is only the three-row presentation model here. These are book entities,
// never playable chapter placeholders; opening a book uses its real album ID.
export async function loadAudiobookTracks(
  query: string,
  page: number,
  platforms: PlatformSetting[],
  limit = 18,
  cursor?: MediaCursor<Track>,
): Promise<AudiobookPage<Track>> {
  const current = cursor ?? createMediaCursor<Track>();
  const streams = interleaveMediaStreams(
    mediaProviders(platforms, 'audiobook', true).map(provider =>
      queries(query).map(term => ({
        key: `${provider}:${term}`,
        provider,
        query: term,
      })),
    ),
  );
  const fetchBatch = () =>
    takeMediaBatch(
      current,
      streams,
      limit,
      item => `${item.provider}:${item.metadata?.albumid}`,
      async (stream, requestPage, size) => {
        const result = await searchOnlinePlaylists(
          stream.query,
          requestPage,
          size,
          stream.provider,
          platforms,
          'audiobook',
          { signal: current.signal },
        );
        return {
          errors: result.errors,
          rawCount: result.items.length,
          items: result.items
            .filter(item => isMediaEntity(item, 'audiobook', stream.provider))
            .map(
              (item): Track => ({
                id: `book:${item.provider}:${item.id}`,
                providerId: item.id,
                provider: item.provider,
                title: item.title,
                artist: item.description,
                album: item.title,
                cover: item.cover,
                coverKey: 'train',
                duration: 0,
                language: '华语',
                genre: '有声书',
                mood: '发现',
                releaseYear: 0,
                metadata: {
                  ...item.metadata,
                  albumid: item.id,
                  mediaType: 'long-audio',
                  discoveryEntity: 'book',
                },
              }),
            ),
        };
      },
      { randomize: true, fetchAttempts: 1 },
    );
  if (!cursor) for (let index = 1; index < page; index += 1) await fetchBatch();
  return fetchBatch();
}
export type AudiobookCategoryCollection = {
  category: { key: string; title: string; query: string; glyph: string };
  item: CatalogItem;
};
export async function loadAudiobookCategoryCollections(
  platforms: PlatformSetting[],
  page = 1,
  requestPage = page,
  cursor?: MediaCursor<AudiobookCategoryCollection>,
  _categoryTitle?: string,
  batchSize = 10,
) {
  const current = cursor ?? createMediaCursor<AudiobookCategoryCollection>();
  const popularCursor =
    (current.nested as MediaCursor<CatalogItem> | undefined) ??
    createMediaCursor<CatalogItem>();
  current.nested = popularCursor;
  popularCursor.signal = current.signal;
  const asCategories = (items: CatalogItem[]) => items
    .filter(item => isMediaEntity(item, 'audiobook', item.provider))
    .map(item => ({
      category: { key: 'popular-books', title: '热门好书', query: '热门有声小说', glyph: '◉' },
      item,
    }));
  popularCursor.onProgress = (items, preview) => current.onProgress?.(asCategories(items), { ...current, nested: preview });
  const result = await loadAudiobookCollections(
    '热门有声小说',
    requestPage,
    platforms,
    batchSize,
    cursor ? popularCursor : undefined,
  );
  return asCategories(result.items);
}
