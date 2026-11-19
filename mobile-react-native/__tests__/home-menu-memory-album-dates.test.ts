import type { MusicProfile, Track } from '../src/domain/types';
import { normalizeKuwoTrack } from '../src/services/onlineCatalog';
import { loadHomeMenuPage } from '../src/services/homeMenuDiscovery';
import { loadCollectionTrackBatch } from '../src/services/collectionPaging';
import { searchOnlinePlaylists } from '../src/services/onlineMusic';
import {
  confirmedReleaseDate,
  isRecentRelease,
  statisticsFromTracks,
} from '../src/services/musicPreferenceStatistics';
import { MenuAlbumRequestQueue, supplementMenuTrackMetadata } from '../src/services/homeMenuTrackMetadata';
import { CatalogRequestBudget } from '../src/services/catalogRequestBudget';

jest.mock('../src/services/onlineMusic', () => ({
  searchOnlinePlaylists: jest.fn(),
}));
jest.mock('../src/services/collectionPaging', () => ({
  loadCollectionTrackBatch: jest.fn(),
}));
const originalFetch = globalThis.fetch;
const recent = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const song = (index: number) =>
  normalizeKuwoTrack({
    id: String(index + 1),
    name: `Song ${index}`,
    artist: `Artist ${index}`,
    album: `Album ${index}`,
    albumid: String(index + 100),
    duration: '200',
    // Kuwo's playlist member field is an ingestion timestamp, not a release date.
    firstrecordtime: `${recent} 12:00:00`,
  });
const album = (index: number, date: string = recent) => ({
  albumid: String(index + 100),
  name: `Album ${index}`,
  artist: `Artist ${index}`,
  pub: date,
});
const response = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response);
beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('memory accepts the verified Kuwo album pub date and never the member ingestion time', async () => {
  const track = song(0);
  expect(confirmedReleaseDate(track)).toBeUndefined();
  globalThis.fetch = jest.fn(async () => response(album(0)));
  const [prepared] = await supplementMenuTrackMetadata([track], 'mode-memory');
  expect(isRecentRelease(prepared!)).toBe(true);
  expect(prepared!.metadata?.album).toEqual(
    expect.objectContaining({ albumid: '100', pub: recent }),
  );
  globalThis.fetch = jest.fn(async () =>
    response({ ...album(0), artist: 'Unrelated artist' }),
  );
  expect(
    confirmedReleaseDate(
      (await supplementMenuTrackMetadata([track], 'mode-memory'))[0]!,
    ),
  ).toBeUndefined();
});

test('a year without a date cannot skip memory album validation', async () => {
  const track: Track = {
    ...song(0),
    releaseYear: 1990,
    metadata: { ...song(0).metadata, releaseYear: 1990 },
  };
  globalThis.fetch = jest.fn(async () => response(album(0, '1990-04-01')));
  expect(
    confirmedReleaseDate(
      (await supplementMenuTrackMetadata([track], 'mode-memory'))[0]!,
    ),
  ).toBe(Date.parse('1990-04-01'));
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

test('a Kuwo compilation supplies its date after exact album and member identity validation', async () => {
  const track = normalizeKuwoTrack({
    id: '547027312', name: '这世的名字 (Live)', artist: '张信哲&唐汉霄',
    album: '有歌第二季 第10期', albumid: '86998419', duration: '200',
  });
  globalThis.fetch = jest.fn(async () => response({
    albumid: '86998419', name: '有歌第二季&nbsp;第10期', artist: '有歌第二季', pub: recent,
    musiclist: [{
      id: '547027312', name: '这世的名字&nbsp;(Live)', artist: '张信哲&唐汉霄',
      album: '有歌第二季&nbsp;第10期', albumId: 86998419,
    }],
  }));
  const [prepared] = await supplementMenuTrackMetadata([track], 'mode-memory');
  expect(confirmedReleaseDate(prepared!)).toBe(Date.parse(recent));
});

test.each([
  { id: 'different' }, { name: '另一首歌' }, { artist: '另一位歌手' },
  { albumId: 123 }, { album: '另一张专辑' },
])('a mismatched compilation member cannot supply a date %j', async mismatch => {
  const track = song(0);
  globalThis.fetch = jest.fn(async () => response({
    ...album(0), artist: 'Various artists',
    musiclist: [{ id: '1', name: 'Song 0', artist: 'Artist 0', albumId: 100,
      album: 'Album 0', ...mismatch }],
  }));
  const [prepared] = await supplementMenuTrackMetadata([track], 'mode-memory');
  expect(confirmedReleaseDate(prepared!)).toBeUndefined();
});

test('memory fills five plus fifteen from real playlist-shaped members with four verified recent albums', async () => {
  const tracks = Array.from({ length: 20 }, (_, index) => song(index));
  const profile: MusicProfile = {
    artists: {},
    languages: {},
    genres: {},
    moods: {},
    timeSlots: {},
    longTermTrackIds: [],
    shortTermTrackIds: [],
    sessionTrackIds: [],
    memoryStatistics: { ...statisticsFromTracks(tracks), minimumListenedSeconds: 30 },
  };
  jest
    .mocked(searchOnlinePlaylists)
    .mockResolvedValue({
      items: [
        {
          provider: 'kuwo',
          kind: 'playlists',
          id: 'collection',
          title: '国语流行歌曲',
          description: '',
        },
      ],
      errors: [],
    });
  jest
    .mocked(loadCollectionTrackBatch)
    .mockResolvedValue({ tracks, hasMore: false });
  globalThis.fetch = jest.fn(async url => {
    const index = Number(String(url).match(/albumid=(\d+)/)?.[1]) - 100;
    return response(album(index, index >= 16 ? recent : '1990-04-01'));
  });
  const platforms = [{ id: 'kuwo' as const, name: '酷我', enabled: true }];
  const controller = new AbortController();
  const first = await loadHomeMenuPage(
    'mode-memory',
    platforms,
    profile,
    [],
    5,
    undefined,
    { signal: controller.signal },
  );
  const preparedAlbums = new Set([
    ...first.tracks,
    ...first.cursor.providers.flatMap(provider => provider.candidates.map(item => item.track)),
  ].map(track => String(track.metadata?.albumId)));
  const fill = await loadHomeMenuPage(
    'mode-memory',
    platforms,
    profile,
    [],
    15,
    first.cursor,
    {
      signal: controller.signal,
      excludedArtists: first.tracks.map(track => track.artist.toLowerCase()),
    },
  );
  const all = [...first.tracks, ...fill.tracks];
  expect(first.tracks).toHaveLength(5);
  expect(all).toHaveLength(20);
  expect(all.filter(track => isRecentRelease(track))).toHaveLength(4);
  expect(new Set(all.map(track => track.artist)).size).toBe(20);
  expect(globalThis.fetch).toHaveBeenCalled();
  // An early first batch retains its partial member page. Continuation must
  // use the verified evidence already in that cursor instead of re-reading it.
  // A request cancelled before publication may be retried on continuation.
  const albumRequests = jest.mocked(globalThis.fetch).mock.calls
    .map(([url]) => String(url).match(/albumid=(\d+)/)?.[1]);
  for (const id of preparedAlbums) {
    expect(albumRequests.filter(requested => requested === id)).toHaveLength(1);
  }
});

test('memory can fill twenty distinct artists when year-prefixed new-song searches return classic playlists', async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  const year = new Date().getUTCFullYear();
  const profile: MusicProfile = {
    artists: {}, languages: {}, genres: {}, moods: {}, timeSlots: {},
    longTermTrackIds: [], shortTermTrackIds: [], sessionTrackIds: [],
    memoryStatistics: { minimumListenedSeconds: 30, version: 1, samples: 100, distributions: {
      genres: {__unknown__: 1}, styles: {__unknown__: 1}, moods: {__unknown__: 1},
      languages: {'粤语': 1}, artists: {'张国荣': 1},
    }},
  };
  // Saved Kuwo responses: "2026 粤语 歌曲 新歌" starts with classic
  // collections; "粤语 2026" also recalls the current-year collection.
  jest.mocked(searchOnlinePlaylists).mockImplementation(async query => ({
    items: [{provider: 'kuwo', kind: 'playlists', id: query === `粤语 ${year}` ? 'recent' : 'classic',
      title: query === `粤语 ${year}` ? `『粤语』${year}全网爆火热歌精选100首` : '经典粤语歌曲', description: ''}], errors: [],
  }));
  jest.mocked(loadCollectionTrackBatch).mockImplementation(async (_provider, _kind, id) => ({
    tracks: Array.from({length: 20}, (_, row) => song(id === 'recent' ? row + 100 : row)), hasMore: false,
  }));
  globalThis.fetch = jest.fn(async url => {
    const index = Number(String(url).match(/albumid=(\d+)/)?.[1]) - 100;
    return response({...album(index, index >= 100 ? recent : '1990-04-01'), lang: '粤语'});
  });
  let page: Awaited<ReturnType<typeof loadHomeMenuPage>> | undefined;
  const work = loadHomeMenuPage('mode-memory', [{id: 'kuwo', name: '酷我', enabled: true}],
    profile, [], 20, undefined, {signal: controller.signal}).then(result => { page = result; });
  try {
    await jest.advanceTimersByTimeAsync(12000);
    await work;
    expect(page?.tracks).toHaveLength(20);
    expect(page?.tracks.filter(track => isRecentRelease(track))).toHaveLength(4);
    expect(new Set(page?.tracks.map(track => track.artist)).size).toBe(20);
  } finally {
    controller.abort();
    await work;
    jest.useRealTimers();
  }
});

test.each(['current-year playlist', 'new-song chart'])(
  'memory fills the last two verified recent slots from the %s when stalled at eighteen', async source => {
    const tracks = Array.from({ length: 20 }, (_, index) => song(index));
    const profile: MusicProfile = {
      artists: {}, languages: {}, genres: {}, moods: {}, timeSlots: {},
      longTermTrackIds: [], shortTermTrackIds: [], sessionTrackIds: [],
      memoryStatistics: { ...statisticsFromTracks(tracks), minimumListenedSeconds: 30 },
    };
    const platforms = [{ id: 'kuwo' as const, name: '酷我', enabled: true }];
    const collection = (id: string, title: string) => ({
      id, title, provider: 'kuwo' as const, kind: 'playlists' as const, description: '',
    });
    const read = jest.mocked(loadCollectionTrackBatch);
    jest.mocked(searchOnlinePlaylists).mockResolvedValue({ items: [collection('first', '粤语流行')], errors: [] });
    read.mockResolvedValue({ tracks: tracks.slice(0, 5), hasMore: false });
    globalThis.fetch = jest.fn(async url => {
      const index = Number(String(url).match(/albumid=(\d+)/)?.[1]) - 100;
      return response(album(index, index === 4 || index >= 100 ? recent : '1990-04-01'));
    });
    const options = { signal: new AbortController().signal };
    const first = await loadHomeMenuPage('mode-memory', platforms, profile, [], 5, undefined, options);
    const previous = first.cursor;
    previous.modeSelection!.preference.count = 18;
    previous.modeSelection!.recent = 2;
    const year = new Date(previous.modeSelection!.now).getUTCFullYear();
    const query = `粤语 ${year}`;
    const provider = previous.providers[0]!;
    provider.candidates = [];
    provider.queries = [{ query, page: 2, hasMore: false }];
    provider.pendingSceneRoutes = [];
    provider.collections = [
      ...Array.from({ length: 40 }, (_, index) => ({
        item: collection(`classic-${index}`, `粤语经典${index}`), query, offset: 0, hasMore: true,
      })),
      { item: collection('current-year', `粤语 ${year} 新歌`), query, offset: 20, hasMore: true },
    ];
    read.mockClear();
    read.mockImplementation(async (_platform, kind, id) => ({
      tracks: (source === 'new-song chart' ? kind === 'charts' : id === 'current-year')
        ? [song(90), song(100), song(101)] : [song(90)],
      hasMore: false,
    }));

    const next = await loadHomeMenuPage('mode-memory', platforms, profile, [], 2, previous, options);

    if (source === 'current-year playlist') {
      expect(read.mock.calls.find(([, kind]) => kind === 'playlists')?.slice(2, 4)).toEqual(['current-year', 20]);
    } else {
      expect(read.mock.calls.some(([, kind]) => kind === 'charts')).toBe(true);
    }
    expect(next.tracks).toHaveLength(2);
    expect(next.tracks.every(track => isRecentRelease(track))).toBe(true);
    expect(next.cursor.modeSelection?.preference.count).toBe(20);
  },
);

test('memory reaches recent recall while generic preference collections are stalled', async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  const tracks = Array.from({ length: 20 }, (_, index) => ({
    ...song(index),
    metadata: { ...song(index).metadata, genre: '流行', style: '抒情', language: '国语', mood: '平静' },
  }));
  const statistics = statisticsFromTracks(tracks);
  const profile: MusicProfile = {
    artists: {}, languages: {}, genres: {}, moods: {}, timeSlots: {},
    longTermTrackIds: [], shortTermTrackIds: [], sessionTrackIds: [],
    memoryStatistics: { ...statistics, minimumListenedSeconds: 30 as const },
  };
  jest.mocked(searchOnlinePlaylists).mockImplementation(async query => ({
    items: [{ provider: 'kuwo', kind: 'playlists', id: query, title: query, description: '' }],
    errors: [],
  }));
  jest.mocked(loadCollectionTrackBatch).mockImplementation(async (_provider, _kind, id) => {
    if (!id.includes(String(new Date().getUTCFullYear()))) return new Promise(() => {});
    return { tracks, hasMore: false };
  });
  globalThis.fetch = jest.fn(async url => {
    const index = Number(String(url).match(/albumid=(\d+)/)?.[1]) - 100;
    return response(album(index, index >= 16 ? recent : '1990-04-01'));
  });
  let first: Awaited<ReturnType<typeof loadHomeMenuPage>> | undefined;
  const work = loadHomeMenuPage('mode-memory',
    [{ id: 'kuwo', name: '酷我', enabled: true }], profile, [], 5, undefined,
    { signal: controller.signal },
  ).then(result => { first = result; }, () => {});
  try {
    await jest.advanceTimersByTimeAsync(100);
    expect(first?.tracks).toHaveLength(5);
    expect(first?.tracks.filter(track => isRecentRelease(track))).toHaveLength(1);
  } finally {
    controller.abort();
    await work;
    jest.useRealTimers();
  }
});

test('cancellation rejects late memory album evidence', async () => {
  let resolveBody!: (body: string) => void;
  globalThis.fetch = jest.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        text: () =>
          new Promise<string>(resolve => {
            resolveBody = resolve;
          }),
      } as Response),
  );
  const controller = new AbortController();
  const scope = new CatalogRequestBudget(1000, 5, controller.signal);
  const publish = jest.fn();
  const work = supplementMenuTrackMetadata(
    [song(0)],
    'mode-memory',
    scope,
    publish,
  ).catch(error => error);
  for (let tick = 0; tick < 8; tick++) await Promise.resolve();
  controller.abort();
  await work;
  resolveBody?.(JSON.stringify(album(0)));
  await Promise.resolve();
  expect(publish).not.toHaveBeenCalled();
  scope.close();
});

test('memory starts later recall routes before earlier member pages finish album validation', async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  const metadata = { genre: '流行', style: '抒情', language: '国语', mood: '平静' };
  const tracks = Array.from({ length: 20 }, (_, index) => ({
    ...song(index), metadata: { ...song(index).metadata, ...metadata },
  }));
  const profile: MusicProfile = {
    artists: {}, languages: {}, genres: {}, moods: {}, timeSlots: {},
    longTermTrackIds: [], shortTermTrackIds: [], sessionTrackIds: [],
    memoryStatistics: { ...statisticsFromTracks(tracks), minimumListenedSeconds: 30 },
  };
  const routes = new Map<string, number>();
  jest.mocked(searchOnlinePlaylists).mockImplementation(async query => {
    if (!routes.has(query)) routes.set(query, routes.size);
    return { items: [{ provider: 'kuwo', kind: 'playlists', id: query,
      title: query, description: '' }], errors: [] };
  });
  jest.mocked(loadCollectionTrackBatch).mockImplementation(async (_provider, _kind, id) => ({
    tracks: Array.from({ length: 20 }, (_, row) => {
      const index = routes.get(id)! * 20 + row;
      return { ...song(index), metadata: { ...song(index).metadata, ...metadata } };
    }), hasMore: false,
  }));
  let activeAlbums = 0;
  let peakAlbums = 0;
  globalThis.fetch = jest.fn(async url => {
    const index = Number(String(url).match(/albumid=(\d+)/)?.[1]) - 100;
    peakAlbums = Math.max(peakAlbums, ++activeAlbums);
    await new Promise<void>(resolve => setTimeout(resolve, 600));
    activeAlbums -= 1;
    // Only the sixth recall direction supplies a recent release. Earlier
    // directions are valid, slow twenty-member pages, rather than failures.
    return response(album(index, index === 100 ? recent : '1990-04-01'));
  });
  let first: Awaited<ReturnType<typeof loadHomeMenuPage>> | undefined;
  const work = loadHomeMenuPage('mode-memory',
    [{ id: 'kuwo', name: '酷我', enabled: true }], profile, [], 5, undefined,
    { signal: controller.signal },
  ).then(result => { first = result; }, () => {});
  try {
    await jest.advanceTimersByTimeAsync(6500);
    expect(routes.size).toBeGreaterThanOrEqual(6);
    expect(first?.tracks).toHaveLength(5);
    expect(first?.tracks.filter(track => isRecentRelease(track))).toHaveLength(1);
    expect(peakAlbums).toBeLessThanOrEqual(2);
  } finally {
    controller.abort();
    await work;
    await jest.runOnlyPendingTimersAsync();
    jest.useRealTimers();
  }
});

test('memory album work gives a sibling collection a turn before draining one collection', async () => {
  jest.useFakeTimers();
  const scope = new CatalogRequestBudget(1000, 40);
  const queue = new MenuAlbumRequestQueue();
  const calls: number[] = [];
  const release: (() => void)[] = [];
  globalThis.fetch = jest.fn(async url => {
    const index = Number(String(url).match(/albumid=(\d+)/)?.[1]) - 100;
    calls.push(index);
    if (index < 2) await new Promise<void>(resolve => release.push(resolve));
    return response(album(index));
  });
  const older = supplementMenuTrackMetadata(
    Array.from({ length: 20 }, (_, index) => song(index)),
    'mode-memory', scope, undefined, new Map(), queue,
  );
  await jest.advanceTimersByTimeAsync(0);
  const sibling = supplementMenuTrackMetadata(
    [song(100)], 'mode-memory', scope, undefined, new Map(), queue,
  );
  await jest.advanceTimersByTimeAsync(0);
  try {
    release.forEach(resolve => resolve());
    await Promise.all([older, sibling]);
    expect(calls.indexOf(100)).toBeLessThan(calls.indexOf(19));
  } finally {
    scope.close();
    jest.useRealTimers();
  }
});

test('memory publishes a complete first five without waiting for an unrelated stalled album', async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  const tracks = Array.from({ length: 20 }, (_, index) => song(index));
  const profile: MusicProfile = {
    artists: {},
    languages: {},
    genres: {},
    moods: {},
    timeSlots: {},
    longTermTrackIds: [],
    shortTermTrackIds: [],
    sessionTrackIds: [],
    memoryStatistics: { ...statisticsFromTracks(tracks), minimumListenedSeconds: 30 },
  };
  jest
    .mocked(searchOnlinePlaylists)
    .mockResolvedValue({
      items: [
        {
          provider: 'kuwo',
          kind: 'playlists',
          id: 'collection',
          title: '国语流行歌曲',
          description: '',
        },
      ],
      errors: [],
    });
  jest
    .mocked(loadCollectionTrackBatch)
    .mockResolvedValue({ tracks, hasMore: false });
  globalThis.fetch = jest.fn(async url => {
    const index = Number(String(url).match(/albumid=(\d+)/)?.[1]) - 100;
    if (index === 0) return new Promise<Response>(() => {});
    return response(album(index, index === 1 ? recent : '1990-04-01'));
  });
  let first: Awaited<ReturnType<typeof loadHomeMenuPage>> | undefined;
  const work = loadHomeMenuPage(
    'mode-memory',
    [{ id: 'kuwo', name: '酷我', enabled: true }],
    profile,
    [],
    5,
    undefined,
    { signal: controller.signal },
  ).then(
    result => {
      first = result;
    },
    () => {},
  );
  try {
    await jest.advanceTimersByTimeAsync(100);
    expect(first?.tracks).toHaveLength(5);
    expect(first?.tracks.filter(track => isRecentRelease(track))).toHaveLength(
      1,
    );
  } finally {
    controller.abort();
    await work;
    jest.useRealTimers();
  }
});
