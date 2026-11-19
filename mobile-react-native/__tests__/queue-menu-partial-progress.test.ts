import type { MusicProfile, PlatformSetting } from '../src/domain/types';
import { trackQueueKey } from '../src/domain/types';
import { loadCollectionTrackBatch } from '../src/services/collectionPaging';
import { loadHomeMenuPage } from '../src/services/homeMenuDiscovery';
import { normalizeKuwoTrack } from '../src/services/onlineCatalog';
import { searchOnlinePlaylists } from '../src/services/onlineMusic';
import { nextQueuePage, type QueueSource } from '../src/services/queuePaging';
import { isRecentRelease } from '../src/services/musicPreferenceStatistics';

jest.mock('../src/services/onlineMusic', () => ({ searchOnlinePlaylists: jest.fn() }));
jest.mock('../src/services/collectionPaging', () => ({ loadCollectionTrackBatch: jest.fn() }));

const platforms: PlatformSetting[] = [{ id: 'kuwo', name: '酷我', enabled: true }];
const profile: MusicProfile = { artists: {}, languages: {}, genres: {}, moods: {}, timeSlots: {},
  longTermTrackIds: [], shortTermTrackIds: [], sessionTrackIds: [],
  memoryStatistics: { minimumListenedSeconds: 30, version: 1, samples: 100, distributions: {
    genres: { __unknown__: 1 }, styles: { __unknown__: 1 }, moods: { __unknown__: 1 },
    languages: { '粤语': 1 }, artists: { __unknown__: 1 },
  } } };
const originalFetch = globalThis.fetch;
const recent = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const song = (index: number) => normalizeKuwoTrack({ id: String(index + 1),
  name: `Song ${index}`, artist: `Artist ${index}`, album: `Album ${index}`,
  albumid: String(index + 100), duration: '200' });
let releaseTail: boolean;
let albumCalls: number[];

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  releaseTail = false;
  albumCalls = [];
  jest.mocked(searchOnlinePlaylists).mockResolvedValue({ items: [{ provider: 'kuwo',
    kind: 'playlists', id: 'one', title: '目录', description: '' }], errors: [] });
  jest.mocked(loadCollectionTrackBatch).mockImplementation(async (_provider, _kind, _id, offset) => ({
    tracks: Array.from({ length: 20 }, (_, row) => song(offset + row)), hasMore: offset > 0,
  }));
  globalThis.fetch = jest.fn(async url => {
    const index = Number(String(url).match(/albumid=(\d+)/)?.[1]) - 100;
    albumCalls.push(index);
    if (index >= 34 && !releaseTail) return new Promise<Response>(() => {});
    return { ok: true, status: 200, text: async () => JSON.stringify({
      albumid: String(index + 100), name: `Album ${index}`, artist: `Artist ${index}`,
      pub: index >= 36 ? recent : '1990-04-01',
    }) } as Response;
  });
});
afterEach(() => { globalThis.fetch = originalFetch; jest.useRealTimers(); });

async function initialSixteen(): Promise<Extract<QueueSource, { kind: 'home-menu' }>> {
  const first = await loadHomeMenuPage('mode-memory', platforms, profile, [], 20);
  expect(first.tracks).toHaveLength(16);
  // All query pages are exhausted; the existing member page alone still has a tail.
  first.cursor.providers.forEach(provider => {
    provider.queries.forEach(query => { query.hasMore = false; });
    provider.collections?.forEach(collection => { collection.hasMore = true; });
  });
  return { kind: 'home-menu', cursor: first.cursor, hasMore: true,
    seenKeys: first.tracks.map(trackQueueKey),
    initialMenuBatch: { remaining: 4, artists: first.tracks.map(track => track.artist.toLowerCase()) } };
}

test.each([15_000, 100])('memory retains a partially validated member page at the %i ms queue deadline and resumes its remaining albums', async timeoutMs => {
  const source = await initialSixteen();
  const original = JSON.stringify(source);
  const work = nextQueuePage(source, platforms, 4, { timeoutMs });
  // Observe the rejection too, so the old implementation is a normal red test.
  const settled = work.then(value => ({ value }), error => ({ error }));
  await jest.advanceTimersByTimeAsync(Math.min(timeoutMs, 12_000) + 1);
  const result = await settled;
  expect(result).toHaveProperty('value');
  if (!('value' in result)) return;
  const partial = result.value;
  expect(partial.tracks).toEqual([]);
  expect(partial.source).toMatchObject({ initialMenuBatch: { remaining: 4 }, hasMore: true });
  if (partial.source.kind !== 'home-menu') throw new Error('wrong source');
  expect(partial.source.cursor.providers[0]!.collections![0]!.offset).toBe(20);
  expect(partial.source.cursor.providers[0]!.candidates.map(item => item.track.title)).toContain('Song 33');
  expect(JSON.stringify(source)).toBe(original);
  const callsBeforeResume = albumCalls.length;
  releaseTail = true;
  const resumed = await nextQueuePage(partial.source, platforms, 4);
  expect(resumed.tracks).toHaveLength(4);
  expect(resumed.tracks.every(track => isRecentRelease(track))).toBe(true);
  expect(resumed.source).toMatchObject({ initialMenuBatch: undefined });
  expect(albumCalls.slice(callsBeforeResume).some(index => index >= 20 && index < 34)).toBe(false);
});

test('an unchanged memory page still stops with an explicit error instead of silently retrying', async () => {
  const source = await initialSixteen();
  const firstWork = nextQueuePage(source, platforms, 4, { timeoutMs: 15_000 });
  const firstSettled = firstWork.catch(error => ({ tracks: [], source: { ...source, cursor: error.cursor } }));
  await jest.advanceTimersByTimeAsync(12_001);
  const first = await firstSettled;
  // The same pending albums stall again, with no new candidate or catalog position.
  const failed = nextQueuePage(first.source, platforms, 4, { timeoutMs: 15_000 })
    .then(value => ({ value }), error => ({ error }));
  await jest.advanceTimersByTimeAsync(12_001);
  expect(await failed).toHaveProperty('error');
});

test('caller cancellation rejects memory progress and cannot mutate the active queue', async () => {
  const source = await initialSixteen();
  const original = JSON.stringify(source);
  const controller = new AbortController();
  const work = nextQueuePage(source, platforms, 4, { signal: controller.signal });
  const failed = work.then(value => ({ value }), error => ({ error }));
  await jest.advanceTimersByTimeAsync(1);
  controller.abort();
  const result = await failed;
  expect(result).toHaveProperty('error');
  if ('error' in result) expect(result.error.message).toContain('取消');
  releaseTail = true;
  await jest.advanceTimersByTimeAsync(20_001);
  expect(JSON.stringify(source)).toBe(original);
});
