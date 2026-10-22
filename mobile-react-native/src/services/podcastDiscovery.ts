import type { CatalogItem, PlatformSetting, Track } from '../domain/types';
import {
  loadLatestNeteasePodcastEpisodes,
  searchOnline,
  searchOnlinePlaylists,
} from './onlineMusic';
import {
  createMediaCursor,
  mediaProviders,
  isMediaEntity,
  takeMediaBatch,
  type MediaCursor,
  interleaveMediaStreams,
} from './mediaDiscoveryPaging';

export const podcastTrackCategories = [
  { key: 'history', title: '人文历史', query: '历史播客', glyph: '◉' },
  { key: 'growth', title: '自我成长', query: '成长播客', glyph: '♧' },
  { key: 'emotion', title: '情感生活', query: '情感播客', glyph: '♥' },
  {
    key: 'technology',
    title: '科技数码',
    query: '科技访谈播客',
    glyph: '◌',
  },
  { key: 'business', title: '职场商业', query: '商业播客', glyph: '▣' },
] as const;

const podcastCollectionCategories = [
  { title: '人文历史', query: '历史播客' },
  { title: '自我成长', query: '成长播客' },
  { title: '情感生活', query: '情感播客' },
  { title: '科技数码', query: '科技访谈播客' },
  { title: '职场商业', query: '商业播客' },
  { title: '文化艺术', query: '文化播客' },
  { title: '影视娱乐', query: '影视访谈播客' },
  { title: '社会观察', query: '社会观察播客' },
  { title: '科学探索', query: '科学故事播客' },
  { title: '旅行见闻', query: '旅行播客' },
  { title: '健康生活', query: '健康播客' },
  { title: '读书文学', query: '文学播客' },
  { title: '音乐故事', query: '音乐故事播客' },
  { title: '体育运动', query: '体育播客' },
  { title: '亲密关系', query: '亲密关系播客' },
  { title: '创业访谈', query: '创业访谈播客' },
  { title: '语言学习', query: '语言学习播客' },
  { title: '心理成长', query: '心理成长播客' },
] as const;

export interface PodcastPage<T> {
  items: T[];
  errors: string[];
  hasMore: boolean;
}
const queries = (query: string) => [
  ...new Set([
    query.trim(),
    query.includes('播客')
      ? query.replaceAll('播客', '电台')
      : query.includes('电台')
      ? query.replaceAll('电台', '播客')
      : `${query} 播客`,
  ]),
];
export async function loadPodcastCollections(
  query: string,
  page: number,
  platforms: PlatformSetting[],
  limit: number,
  cursor?: MediaCursor<CatalogItem>,
): Promise<PodcastPage<CatalogItem>> {
  const current = cursor ?? createMediaCursor<CatalogItem>();
  const streams = interleaveMediaStreams(
    mediaProviders(platforms, 'podcast', true).map(provider =>
      [
        ...new Set([
          ...queries(query),
          ...(/^(精品播客|播客)$/.test(query)
            ? podcastCollectionCategories.map(category => category.query)
            : []),
        ]),
      ].map(term => ({
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
          'podcast',
          { signal: current.signal },
        );
        return {
          ...result,
          rawCount: result.items.length,
          items: result.items.filter(item =>
            isMediaEntity(item, 'podcast', stream.provider),
          ),
        };
      },
      { randomize: true, fetchAttempts: 1 },
    );
  // Stateless callers retain page semantics; mounted pages supply their own cursor.
  if (!cursor) for (let index = 1; index < page; index += 1) await fetchBatch();
  return fetchBatch();
}
export async function loadPodcastTracks(
  query: string,
  page: number,
  platforms: PlatformSetting[],
  limit = 18,
  cursor?: MediaCursor<Track>,
  randomize = false,
): Promise<PodcastPage<Track>> {
  return loadPodcastTrackPage(query, page, platforms, limit, cursor, randomize, false);
}

export async function loadLatestPodcastEpisodes(
  query: string,
  page: number,
  platforms: PlatformSetting[],
  limit = 18,
  cursor?: MediaCursor<Track>,
): Promise<PodcastPage<Track>> {
  return loadPodcastTrackPage(query, page, platforms, limit, cursor, false, true);
}

async function loadPodcastTrackPage(
  query: string,
  page: number,
  platforms: PlatformSetting[],
  limit: number,
  cursor: MediaCursor<Track> | undefined,
  randomize: boolean,
  latestEpisodes: boolean,
): Promise<PodcastPage<Track>> {
  const current = cursor ?? createMediaCursor<Track>();
  const streams = interleaveMediaStreams(
    mediaProviders(platforms, 'podcast', false).map(provider =>
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
      item => `${item.provider}:${item.providerId ?? item.id}`,
      async (stream, requestPage, size, reportProgress) => {
        const requestOptions = {
          signal: current.signal,
          onTracks: (tracks: Track[]) => reportProgress(tracks.filter(item => isMediaEntity(item, 'podcast', stream.provider))),
        };
        const result = latestEpisodes && stream.provider === 'netease'
          ? await loadLatestNeteasePodcastEpisodes(stream.query, requestPage, size, requestOptions)
          : await searchOnline(
          stream.query,
          requestPage,
          size,
          stream.provider,
          platforms,
          'podcast',
          6000,
          requestOptions,
        );
        return {
          rawCount: 'rawCount' in result ? result.rawCount : result.tracks.length,
          items: result.tracks.filter(item =>
            isMediaEntity(item, 'podcast', stream.provider),
          ),
          errors: 'errors' in result ? result.errors : [],
        };
      },
      { randomize, fetchAttempts: 1 },
    );
  if (!cursor) for (let index = 1; index < page; index += 1) await fetchBatch();
  return fetchBatch();
}
export type PodcastCategoryCollection = {
  category: { key: string; title: string; query: string; glyph: string };
  item: CatalogItem;
};
export async function loadPodcastCategoryCollections(
  platforms: PlatformSetting[],
  page = 1,
  requestPage = page,
  cursor?: MediaCursor<PodcastCategoryCollection>,
  _categoryTitle?: string,
  batchSize = 10,
) {
  const current = cursor ?? createMediaCursor<PodcastCategoryCollection>();
  const popularCursor =
    (current.nested as MediaCursor<CatalogItem> | undefined) ??
    createMediaCursor<CatalogItem>();
  current.nested = popularCursor;
  popularCursor.signal = current.signal;
  const asCategories = (items: CatalogItem[]) => items
    .filter(item => isMediaEntity(item, 'podcast', item.provider))
    .map(item => ({
      category: { key: 'popular-programs', title: '热门节目', query: '热门播客', glyph: '◉' },
      item,
    }));
  popularCursor.onProgress = (items, preview) => current.onProgress?.(asCategories(items), { ...current, nested: preview });
  const result = await loadPodcastCollections(
    '热门播客',
    requestPage,
    platforms,
    batchSize,
    cursor ? popularCursor : undefined,
  );
  return asCategories(result.items);
}
