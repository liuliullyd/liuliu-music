import { catalogSnapshotQueueSource, nextQueuePage, withQueueRemainder } from '../src/services/queuePaging';
import { createMediaCursor } from '../src/services/mediaDiscoveryPaging';
import { adaptivePageMetrics } from '../src/layout';
import { searchOnline } from '../src/services/onlineMusic';
import { loadCollectionTrackBatch } from '../src/services/collectionPaging';
import { loadCategoryFeedPage } from '../src/services/liveDiscovery';
import type { Track } from '../src/domain/types';

jest.mock('../src/services/onlineMusic', () => ({ searchOnline: jest.fn() }));
jest.mock('../src/services/collectionPaging', () => ({ loadCollectionTrackBatch: jest.fn() }));
jest.mock('../src/services/liveDiscovery', () => ({ loadCategoryFeedPage: jest.fn() }));
const platforms = [
  { id: 'qq', name: 'QQ音乐', enabled: true },
] as import('../src/domain/types').PlatformSetting[];
const song = (i: number): Track => ({
  id: `q-${i}`,
  provider: 'qq',
  providerId: String(i),
  title: `歌曲${i}`,
  artist: `艺人${i}`,
  album: '专辑',
  duration: 180,
  coverKey: 'train',
  language: '华语',
  genre: '流行',
  mood: '快乐',
  releaseYear: 1990,
});

test('finite input retains every unconsumed song in successive twenty-song batches', async () => {
  const all = Array.from({ length: 53 }, (_, i) => song(i));
  const source = withQueueRemainder(null, all.slice(20));
  const second = await nextQueuePage(source, platforms);
  const third = await nextQueuePage(second.source, platforms);
  expect(second.tracks.map(t => t.id)).toEqual(
    all.slice(20, 40).map(t => t.id),
  );
  expect(third.tracks.map(t => t.id)).toEqual(all.slice(40).map(t => t.id));
  expect(third.source.hasMore).toBe(false);
  expect(searchOnline).not.toHaveBeenCalled();
});

test('queue modal reuses the same canvas scale across device DP sizes', () => {
  expect(adaptivePageMetrics(720, 0.8).scale).toBe(0.8);
  expect(adaptivePageMetrics(720, 1).scale).toBe(1);
  expect(adaptivePageMetrics(720, 1.2).scale).toBe(1.2);
});

test('partial collection hydration keeps the remote width and consumes its tail before another request', async () => {
  const all = Array.from({ length: 20 }, (_, i) => song(i + 20));
  jest.mocked(loadCollectionTrackBatch).mockResolvedValue({ tracks: all, hasMore: false });
  const partial = await nextQueuePage({
    kind: 'collection', collectionKind: 'playlists', provider: 'qq', id: 'list', offset: 20, hasMore: true,
  }, platforms, 2);
  expect(partial.tracks).toEqual(all.slice(0, 2));
  expect(loadCollectionTrackBatch).toHaveBeenLastCalledWith('qq', 'playlists', 'list', 20, 20);
  const remainder = await nextQueuePage(partial.source, platforms);
  expect(remainder.tracks).toEqual(all.slice(2));
  expect(remainder.source.hasMore).toBe(false);
});

test('feed remainders survive cross-page de-duplication and filtered pages retain remote continuation', async () => {
  const all = Array.from({ length: 20 }, (_, i) => song(i + 40));
  jest.mocked(loadCategoryFeedPage).mockResolvedValueOnce({ tracks: all, hasMore: true });
  jest.mocked(loadCategoryFeedPage).mockResolvedValueOnce({ tracks: [], hasMore: true });
  const partial = await nextQueuePage({ kind: 'feed', category: '综合', page: 1, hasMore: true }, platforms, 2);
  const remainder = await nextQueuePage(partial.source, platforms);
  expect([...partial.tracks, ...remainder.tracks]).toEqual(all);
  const filtered = await nextQueuePage(remainder.source, platforms);
  expect(filtered.tracks).toEqual([]);
  expect(filtered.source.hasMore).toBe(true);
});

test('search continuation distinguishes a filtered remote page from a failed request', async () => {
  jest.mocked(searchOnline).mockResolvedValueOnce({ tracks: [], rawCount: 20, errors: ['均未通过可播放条件'] });
  const source = { kind: 'search' as const, query: '歌', provider: 'qq' as const, page: 1, hasMore: true };
  const filtered = await nextQueuePage(source, platforms);
  expect(filtered.source).toMatchObject({ page: 2, hasMore: true });
  jest.mocked(searchOnline).mockResolvedValueOnce({ tracks: [], rawCount: null, errors: ['offline'] });
  await expect(nextQueuePage(filtered.source, platforms)).rejects.toThrow('offline');
  expect(filtered.source).toMatchObject({ page: 2, hasMore: true });
});

test('typed catalog queue retains the rail cursor, buffers the eighteen-song remote page and retries independently', async () => {
  const cursor = createMediaCursor<Track>();
  cursor.streams.qq = { page: 2, buffer: [], exhausted: false };
  const all = Array.from({ length: 18 }, (_, i) => song(i + 100));
  const loader = jest.fn(async (_page: number, next: typeof cursor) => {
    next.streams.qq.page += 1;
    return { items: all, hasMore: true };
  });
  const source = catalogSnapshotQueueSource({ page: 1, hasMore: true, cursor }, loader);
  const partial = await nextQueuePage(source, platforms, 2);
  expect(partial.tracks).toEqual(all.slice(0, 2));
  expect(cursor.streams.qq.page).toBe(2);
  expect(loader.mock.calls[0][0]).toBe(2);
  const remainder = await nextQueuePage(partial.source, platforms);
  expect(remainder.tracks).toEqual(all.slice(2));
  loader.mockImplementationOnce(async (_page, next) => {
    next.streams.qq.page = 999;
    throw new Error('offline');
  });
  await expect(nextQueuePage(remainder.source, platforms)).rejects.toThrow('offline');
  loader.mockImplementationOnce(async (_page, next) => {
    next.streams.qq.page += 1;
    return { items: all.map(item => ({ ...item, id: `${item.id}-next`, providerId: `${item.providerId}-next` })), hasMore: true };
  });
  await nextQueuePage(remainder.source, platforms);
  expect(loader.mock.calls.at(-1)![0]).toBe(3);
  expect(loader.mock.calls.at(-1)![1].streams.qq.page).toBe(4);
  expect(cursor.streams.qq.page).toBe(2);
});

test('mixed search keeps a failed provider on its own cursor while successful providers advance', async () => {
  const mixedPlatforms = [...platforms, { id: 'netease' as const, name: '网易', enabled: true }];
  jest.mocked(searchOnline).mockImplementation(async (_query, page, _size, provider) => {
    if (provider === 'netease') return { tracks: [], errors: ['offline'], rawCount: null };
    return { tracks: [song(200 + page!)], errors: [], rawCount: 20 };
  });
  const first = await nextQueuePage({ kind: 'search', query: '歌', provider: 'all', page: 1, hasMore: true }, mixedPlatforms);
  expect(first.source).toMatchObject({ providerPages: { qq: 3, netease: 2 }, hasMore: true });
  await nextQueuePage(first.source, mixedPlatforms);
  expect(jest.mocked(searchOnline).mock.calls.slice(-2).map(call => [call[3], call[1]])).toEqual([['qq', 3], ['netease', 2]]);
});
