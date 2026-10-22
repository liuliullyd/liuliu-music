import React from 'react';
import TestRenderer from 'react-test-renderer';
import { AppProvider, useApp } from '../src/state/AppContext';
import { nativePlayer } from '../src/services/nativePlayer';
import { loadCollectionTrackBatch } from '../src/services/collectionPaging';
import { resolvePlayback, searchOnline } from '../src/services/onlineMusic';
import {
  nearListBottom,
  prefetchListBottom,
} from '../src/components/ListPaging';
import { trackQueueKey } from '../src/domain/types';
import type { Track, NativePlayerState } from '../src/domain/types';

const tracks: Track[] = Array.from({ length: 80 }, (_, i) => ({
  id: `song-${i}`,
  providerId: String(i),
  provider: 'netease',
  title: `歌 ${i}`,
  artist: `艺人 ${i}`,
  album: '专辑',
  duration: 180,
  coverKey: 'train',
  language: '华语',
  genre: '流行',
  mood: '发现',
  releaseYear: 2026,
}));
jest.mock('../src/services/storage', () => {
  const actual = jest.requireActual('../src/services/storage');
  return {
    ...actual,
    loadState: jest.fn(async () => ({
      ...actual.defaultState(),
      settings: { ...actual.defaultState().settings, startupAutoplay: false },
    })),
    saveState: jest.fn(async () => undefined),
  };
});
jest.mock('../src/services/liveDiscovery', () => ({
  loadCategoryFeed: jest.fn(async () => []),
}));
jest.mock('../src/services/collectionPaging', () => ({
  loadCollectionTrackBatch: jest.fn(),
}));
jest.mock('../src/services/onlineMusic', () => ({
  resolvePlaybackWithQuality: jest.fn(async (...args: any[]) => ({ url: await require('../src/services/onlineMusic').resolvePlayback(...args.slice(0, 3)), quality: args[0]?.metadata?._playbackQuality ?? '320k' })),
  resolvePlayback: jest.fn(async () => 'https://audio.example/song.mp3'),
  searchOnline: jest.fn(),
  albumIdentityId: jest.fn(() => ''),
  artistIdentityId: jest.fn(() => ''),
}));
let app: ReturnType<typeof useApp>;
let renderer: TestRenderer.ReactTestRenderer;
let emit: (value: NativePlayerState) => void;
const api = jest.mocked(loadCollectionTrackBatch);
function Probe() {
  app = useApp();
  return null;
}
const playCollection = () =>
  app.playTrack(tracks[0]!, tracks.slice(0, 20), 0, {
    openPlayer: false,
    queueSource: {
      kind: 'collection',
      collectionKind: 'playlists',
      provider: 'netease',
      id: 'collection-a',
      offset: 20,
      hasMore: true,
    },
  });
const progress = async (index: number) => {
  await TestRenderer.act(async () =>
    emit({ ...app.player, index, playing: true }),
  );
};

test('reversing the logical queue preserves current audio and progress and can restore its order', async () => {
  await TestRenderer.act(async () => {
    await playCollection();
  });
  await TestRenderer.act(async () =>
    emit({
      ...app.player,
      mediaId: trackQueueKey(tracks[0]!),
      index: 0,
      playing: true,
      position: 83,
    }),
  );
  const stop = jest.mocked(nativePlayer.stop).mock.calls.length;
  const load = jest.mocked(nativePlayer.loadQueue).mock.calls.length;
  await TestRenderer.act(async () => {
    await app.reverseQueue();
  });
  expect(app.queue.map(trackQueueKey)).toEqual(
    tracks.slice(0, 20).reverse().map(trackQueueKey),
  );
  expect(app.current?.id).toBe(tracks[0]!.id);
  expect(app.player).toMatchObject({ index: 19, playing: true, position: 83 });
  expect(nativePlayer.stop).toHaveBeenCalledTimes(stop);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(load);
  expect(app.queueReversed).toBe(true);
  await TestRenderer.act(async () => {
    await app.reverseQueue();
  });
  expect(app.queue.map(trackQueueKey)).toEqual(
    tracks.slice(0, 20).map(trackQueueKey),
  );
  expect(app.player).toMatchObject({ index: 0, position: 83 });
  expect(app.queueReversed).toBe(false);
});

test('selecting a reversed queue entry and navigating next retains the reversed playback order', async () => {
  await TestRenderer.act(async () => {
    await playCollection();
  });
  api.mockResolvedValue({ tracks: [], hasMore: false } as any);
  await TestRenderer.act(async () => {
    await app.reverseQueue();
  });
  await TestRenderer.act(async () => {
    await app.playTrack(app.queue[0]!, app.queue, 0, { openPlayer: false });
  });
  expect(app.current?.id).toBe(tracks[19]!.id);
  expect(app.queue.slice(0, 3).map(trackQueueKey)).toEqual(
    [tracks[19]!, tracks[18]!, tracks[17]!].map(trackQueueKey),
  );
  await TestRenderer.act(async () => {
    await app.next();
  });
  expect(app.current?.id).toBe(tracks[18]!.id);
  expect(app.queueReversed).toBe(true);
});

test('an in-flight remote page joins the head after reversal without resetting current progress', async () => {
  await TestRenderer.act(async () => {
    await playCollection();
  });
  let finish!: (result: any) => void;
  api.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  let page!: Promise<void>;
  await TestRenderer.act(async () => {
    page = app.loadMoreQueue();
  });
  await TestRenderer.act(async () => {
    await app.reverseQueue();
  });
  await TestRenderer.act(async () => {
    finish({ tracks: tracks.slice(20, 40), hasMore: false });
    await page;
  });
  expect(app.queue.map(trackQueueKey)).toEqual(
    tracks.slice(0, 40).reverse().map(trackQueueKey),
  );
  expect(app.current?.id).toBe(tracks[0]!.id);
  expect(app.player.index).toBe(39);
  expect(api).toHaveBeenCalledTimes(1);
  await TestRenderer.act(async () => {
    await app.reverseQueue();
  });
  expect(app.queue.map(trackQueueKey)).toEqual(
    tracks.slice(0, 40).map(trackQueueKey),
  );
});

test('a fresh queue starts in its input order after a previous queue was reversed', async () => {
  await TestRenderer.act(async () => {
    await playCollection();
  });
  await TestRenderer.act(async () => {
    await app.reverseQueue();
  });
  await TestRenderer.act(async () => {
    await app.playTrack(tracks[40]!, tracks.slice(40, 60), 0, {
      openPlayer: false,
    });
  });
  expect(app.queueReversed).toBe(false);
  expect(app.queue.map(trackQueueKey)).toEqual(
    tracks.slice(40, 60).map(trackQueueKey),
  );
});

test('previous at the reversed head shares a pending remote page and selects its adjacent entry', async () => {
  let finish!: (result: any) => void;
  api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await TestRenderer.act(async () => { await app.reverseQueue(); });
  await TestRenderer.act(async () => { void app.loadMoreQueue(); });
  await TestRenderer.act(async () => {
    await app.playTrack(app.queue[0]!, app.queue, 0, { openPlayer: false });
  });
  expect(app.current?.id).toBe(tracks[19]!.id);
  expect(api).toHaveBeenCalledTimes(1);
  let previous!: Promise<void>;
  await TestRenderer.act(async () => { previous = app.previous(); });
  await TestRenderer.act(async () => {
    finish({ tracks: tracks.slice(20, 40), hasMore: false });
    await previous;
  });
  expect(app.current?.id).toBe(tracks[20]!.id);
  expect(app.queue.map(trackQueueKey)).toEqual(tracks.slice(0, 40).reverse().map(trackQueueKey));
  expect(api).toHaveBeenCalledTimes(1);
  expect(api.mock.calls[0]!.slice(3, 5)).toEqual([20, 20]);
  expect(app.queueReversed).toBe(true);
});

test.each(['podcast', 'audiobook'])(
  '%s episodes keep their progress on reversal and next follows the reversed episode order',
  async kind => {
    const episodes = tracks.slice(0, 10).map((track, index) => ({
      ...track,
      id: `${kind}-${index}`,
      providerId: `${kind}-${index}`,
      title: `${index + 1}集`,
      metadata: { mediaType: kind },
      duration: 1800,
    }));
    await TestRenderer.act(async () => {
      await app.playTrack(episodes[0]!, episodes, 0, { openPlayer: false });
      emit({ ...app.player, mediaId: trackQueueKey(episodes[0]!), index: 0, position: 142, playing: true });
    });
    await TestRenderer.act(async () => { await app.reverseQueue(); });
    expect(app.current?.id).toBe(episodes[0]!.id);
    expect(app.player).toMatchObject({ index: 9, position: 142 });
    await TestRenderer.act(async () => {
      app.setQueueListOpen(true);
      await app.playTrack(app.queue[0]!, app.queue, 0, { openPlayer: false });
    });
    expect(app.current?.id).toBe(episodes[9]!.id);
    await TestRenderer.act(async () => { await app.next(); });
    expect(app.current?.id).toBe(episodes[8]!.id);
    expect(app.queueReversed).toBe(true);
  },
);

test('reversal retains a paused position without starting playback', async () => {
  await TestRenderer.act(async () => emit({ ...app.player, mediaId: trackQueueKey(tracks[0]!), index: 0, playing: false, position: 72 }));
  const load = jest.mocked(nativePlayer.loadQueue).mock.calls.length;
  const stop = jest.mocked(nativePlayer.stop).mock.calls.length;
  await TestRenderer.act(async () => { await app.reverseQueue(); });
  expect(app.player).toMatchObject({ playing: false, position: 72, index: 19 });
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(load);
  expect(nativePlayer.stop).toHaveBeenCalledTimes(stop);
});

test('a real ended event continues to the next entry of the reversed logical queue', async () => {
  api.mockResolvedValue({ tracks: [], hasMore: false } as any);
  await TestRenderer.act(async () => { await app.reverseQueue(); });
  await TestRenderer.act(async () => { await app.playTrack(app.queue[0]!, app.queue, 0, { openPlayer: false }); });
  await TestRenderer.act(async () => { emit({ ...app.player, mediaId: trackQueueKey(tracks[19]!), index: 0, playing: false, ended: true }); });
  expect(app.current?.id).toBe(tracks[18]!.id);
  expect(app.queueReversed).toBe(true);
});

test('queue list preloads before the exact bottom while keeping a bounded threshold', () => {
  const event = {
    contentOffset: { x: 0, y: 600 },
    layoutMeasurement: { width: 400, height: 400 },
    contentSize: { width: 400, height: 1120 },
  } as never;
  expect(nearListBottom(event)).toBe(true);
  expect(nearListBottom(event, 80)).toBe(false);
});

test('shared prefetch threshold starts more than one viewport before the bottom', () => {
  const event = {
    contentOffset: { x: 0, y: 100 },
    layoutMeasurement: { width: 400, height: 400 },
    contentSize: { width: 400, height: 1000 },
  } as never;
  expect(nearListBottom(event)).toBe(false);
  expect(prefetchListBottom(event)).toBe(true);
});

beforeEach(async () => {
  jest.useFakeTimers();
  jest.spyOn(nativePlayer, 'subscribe').mockImplementation(callback => {
    emit = callback;
    return () => undefined;
  });
  jest.spyOn(nativePlayer, 'appendQueue').mockResolvedValue();
  jest.spyOn(nativePlayer, 'stop').mockResolvedValue();
  jest.spyOn(nativePlayer, 'loadQueue').mockResolvedValue();
  api
    .mockReset()
    .mockImplementation(async (_provider, _kind, _id, offset, size = 20) => ({
      tracks: tracks.slice(offset, offset + size),
      hasMore: offset + size < tracks.length,
    }));
  // These manual continuation cases begin with a transient lookahead failure.
  // The normal automatic 20 -> 40 admission is covered in queue-ahead-controller.
  api.mockRejectedValueOnce(new Error('Initial lookahead unavailable'));
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );
  });
  await TestRenderer.act(async () => {
    await playCollection();
  });
  api.mockClear();
});
afterEach(async () => {
  await TestRenderer.act(async () => renderer.unmount());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('publishes each metadata page without inserting unresolved songs into Media3', async () => {
  expect(api).not.toHaveBeenCalled();
  await TestRenderer.act(async () => {
    await app.loadMoreQueue();
  });
  await TestRenderer.act(async () => {
    await app.loadMoreQueue();
  });
  await TestRenderer.act(async () => {
    await app.loadMoreQueue();
  });
  expect(app.queue).toHaveLength(80);
  expect(api.mock.calls.map(call => [call[3], call[4]])).toEqual([
    [20, 20],
    [40, 20],
    [60, 20],
  ]);
  expect(nativePlayer.stop).toHaveBeenCalledTimes(1);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
  expect(nativePlayer.appendQueue).not.toHaveBeenCalled();
});

test('queue prefetch crosses any number of filtered remote pages before publishing the next batch', async () => {
  const later = Array.from({ length: 20 }, (_, index) => ({
    ...tracks[index]!,
    id: `later-${index}`,
    providerId: `later-${index}`,
  }));
  api.mockImplementation(async (_provider, _kind, _id, offset) => ({
    tracks: offset < 140 ? [] : later,
    hasMore: offset < 140,
  }));
  await TestRenderer.act(async () => {
    await app.loadMoreQueue();
  });
  expect(app.queue.slice(20).map(track => track.id)).toEqual(
    later.map(track => track.id),
  );
  expect(api.mock.calls.map(call => call[3])).toEqual([
    20, 40, 60, 80, 100, 120, 140,
  ]);
});

test('a filtered short search still carries its remote continuation into playback', async () => {
  jest
    .mocked(searchOnline)
    .mockResolvedValueOnce({
      tracks: tracks.slice(0, 3),
      rawCount: 20,
      errors: [],
    });
  await TestRenderer.act(async () => {
    await app.runSearch('歌', 'all', 1, 'song');
  });
  expect(app.search.tracks).toHaveLength(3);
  expect(app.search.queueHasMore).toBe(true);
});

test('opening the list during a cold tap cannot prefetch until the selected song actually plays', async () => {
  let release!: () => void;
  jest.spyOn(nativePlayer, 'waitForPlaybackStart').mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        release = resolve;
      }),
  );
  let playing!: Promise<void>;
  await TestRenderer.act(async () => {
    playing = app.playTrack(tracks[5]!, tracks.slice(0, 20), 5, {
      openPlayer: false,
      queueSource: {
        kind: 'collection',
        collectionKind: 'playlists',
        provider: 'netease',
        id: 'cold-list',
        offset: 20,
        hasMore: true,
      },
    });
    await Promise.resolve();
  });
  await TestRenderer.act(async () => {
    await app.loadMoreQueue();
  });
  expect(api).not.toHaveBeenCalled();
  await TestRenderer.act(async () => {
    release();
    await playing;
  });
  await TestRenderer.act(async () => {
    await app.prefetchQueueAt(0);
  });
  expect(api).toHaveBeenCalledTimes(1);
});

test('sixty consecutive player next actions cross each twenty-song boundary without a previous action', async () => {
  jest.spyOn(nativePlayer, 'playIndex').mockResolvedValue();
  await TestRenderer.act(async () => {
    app.open('player');
  });
  for (let index = 1; index <= 60; index += 1) {
    await TestRenderer.act(async () => {
      await app.next();
    });
    expect(app.current?.id).toBe(tracks[index]!.id);
  }
  expect(api.mock.calls.map(call => [call[3], call[4]])).toEqual([
    [20, 20],
    [40, 20],
    [60, 20],
  ]);
  expect(app.queue).toHaveLength(80);
  expect(nativePlayer.appendQueue).not.toHaveBeenCalled();
});

test('bottom and playback threshold share an in-flight request; failures retry the same cursor', async () => {
  let reject!: (error: Error) => void;
  api.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await TestRenderer.act(async () => {
    app.loadMoreQueue();
    app.loadMoreQueue();
  });
  await progress(17);
  expect(api).toHaveBeenCalledTimes(1);
  await TestRenderer.act(async () => reject(new Error('offline')));
  expect(app.queue).toHaveLength(20);
  expect(app.queuePage.error).toBe('offline');
  await TestRenderer.act(async () => {
    await app.loadMoreQueue();
  });
  expect(api.mock.calls.map(call => call[3])).toEqual([20, 20]);
  expect(app.queue).toHaveLength(40);
  expect(app.queuePage.error).toBe('');
});

test('manual next publishes the fetched page and prefetches the following page after starting its target', async () => {
  let finish!: (value: { tracks: Track[]; hasMore: boolean }) => void;
  const playIndex = jest.spyOn(nativePlayer, 'playIndex').mockResolvedValue();
  api.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );

  let loading!: Promise<void>;
  let navigation!: Promise<void>;
  await TestRenderer.act(async () => {
    loading = app.loadMoreQueue();
    await Promise.resolve();
  });
  await progress(19);
  await TestRenderer.act(async () => {
    navigation = app.next();
    await Promise.resolve();
  });
  expect(app.message).toBe('');
  expect(playIndex).not.toHaveBeenCalled();

  await TestRenderer.act(async () => {
    finish({ tracks: tracks.slice(20, 40), hasMore: true });
    await Promise.all([loading, navigation]);
  });
  expect(playIndex).not.toHaveBeenCalled();
  expect(nativePlayer.loadQueue).toHaveBeenCalled();
  expect(app.message).toBe('');
  expect(app.queue).toHaveLength(40);
  expect(api.mock.calls.map(call => call[3])).toEqual([20]);
});

test('manual previous cold-starts a logical target while the old queue hydrates', async () => {
  const releases: (() => void)[] = [];
  const waitForPlaybackStart = jest
    .spyOn(nativePlayer, 'waitForPlaybackStart')
    .mockImplementation(
      () => new Promise<void>(resolve => releases.push(resolve)),
    );
  const playIndex = jest.spyOn(nativePlayer, 'playIndex').mockResolvedValue();
  const logicalQueue = app.queue.map(track => ({
    ...track,
    playUrl: undefined,
  }));
  let hydration!: Promise<void>;
  await TestRenderer.act(async () => {
    hydration = app.playTrack(logicalQueue[5]!, logicalQueue, 5, {
      openPlayer: false,
    });
    await Promise.resolve();
    await Promise.resolve();
  });
  let navigation!: Promise<void>;
  await TestRenderer.act(async () => {
    navigation = app.previous();
    await Promise.resolve();
  });
  expect(app.message).toBe('');
  expect(playIndex).not.toHaveBeenCalled();
  expect(releases.length).toBeGreaterThanOrEqual(1);

  await TestRenderer.act(async () => {
    while (releases.length) releases.shift()?.();
    await Promise.resolve();
    while (releases.length) releases.shift()?.();
    await Promise.all([hydration, navigation]);
  });
  expect(playIndex).not.toHaveBeenCalled();
  expect(
    (nativePlayer.loadQueue as jest.Mock).mock.calls.length,
  ).toBeGreaterThanOrEqual(2);
  expect(app.player.index).toBe(4);
  expect(app.message).toBe('');
  expect(waitForPlaybackStart).toHaveBeenCalled();
});

test('rapid previous swipes preserve both navigation intents while parsing is pending', async () => {
  const releases: (() => void)[] = [];
  jest
    .spyOn(nativePlayer, 'waitForPlaybackStart')
    .mockImplementation(
      () => new Promise<void>(resolve => releases.push(resolve)),
    );
  const logicalQueue = app.queue.map(track => ({
    ...track,
    playUrl: undefined,
  }));
  let initial!: Promise<void>;
  await TestRenderer.act(async () => {
    initial = app.playTrack(logicalQueue[5]!, logicalQueue, 5, {
      openPlayer: false,
    });
    await Promise.resolve();
    await Promise.resolve();
  });
  let first!: Promise<void>;
  let second!: Promise<void>;
  await TestRenderer.act(async () => {
    first = app.previous();
    second = app.previous();
    await Promise.resolve();
  });
  expect(
    jest.mocked(nativePlayer.stop).mock.calls.length,
  ).toBeGreaterThanOrEqual(3);
  await TestRenderer.act(async () => {
    while (releases.length) releases.shift()?.();
    await Promise.all([initial, first, second]);
  });
  expect(app.player.index).toBe(3);
});

test('removing a non-current queue entry preserves playback and shifts the logical index only when needed', async () => {
  const removeQueueItem = jest
    .spyOn(nativePlayer, 'removeQueueItem')
    .mockResolvedValue();
  jest.mocked(nativePlayer.stop).mockClear();
  const removedId = app.queue[5]!.id;
  await TestRenderer.act(async () => {
    await app.removeQueueTrack(removedId);
  });
  expect(removeQueueItem).not.toHaveBeenCalled();
  expect(nativePlayer.stop).not.toHaveBeenCalled();
  expect(app.queue.some(track => track.id === removedId)).toBe(false);
  expect(app.player.index).toBe(0);
});

test('removing a failed prewarm row by queue identity preserves the active song and continuation cursor', async () => {
  const sameIdAlternateIdentity: Track = {
    ...tracks[5]!,
    providerId: 'alternate-5',
  };
  const page = [
    ...tracks.slice(0, 6),
    sameIdAlternateIdentity,
    ...tracks.slice(6, 20),
  ];
  await TestRenderer.act(async () => {
    await app.playTrack(page[0]!, page, 0, {
      openPlayer: false,
      queueSource: {
        kind: 'collection',
        collectionKind: 'playlists',
        provider: 'netease',
        id: 'collection-a',
        offset: 20,
        hasMore: true,
      },
    });
  });
  const active = trackQueueKey(app.current!);
  const removedKey = trackQueueKey(sameIdAlternateIdentity);
  const retainedSameIdKey = trackQueueKey(tracks[5]!);
  const stopCalls = jest.mocked(nativePlayer.stop).mock.calls.length;

  await TestRenderer.act(async () => {
    await app.removeQueueTrack(sameIdAlternateIdentity.id, removedKey);
  });

  expect(app.queue.some(track => trackQueueKey(track) === removedKey)).toBe(false);
  expect(app.queue.some(track => trackQueueKey(track) === retainedSameIdKey)).toBe(true);
  expect(trackQueueKey(app.current!)).toBe(active);
  expect(app.queuePage.hasMore).toBe(true);
  expect(nativePlayer.stop).toHaveBeenCalledTimes(stopCalls);
});

test('removing the current queue entry stops it and starts the following entry', async () => {
  const removeQueueItem = jest
    .spyOn(nativePlayer, 'removeQueueItem')
    .mockResolvedValue();
  const playIndex = jest.spyOn(nativePlayer, 'playIndex').mockResolvedValue();
  jest.mocked(nativePlayer.stop).mockClear();
  const removedId = app.current!.id;
  await TestRenderer.act(async () => {
    await app.removeQueueTrack(removedId);
  });
  expect(nativePlayer.stop).toHaveBeenCalledTimes(2);
  expect(removeQueueItem).toHaveBeenCalledWith(0);
  expect(playIndex).not.toHaveBeenCalled();
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(2);
  expect(app.current?.id).not.toBe(removedId);
  expect(app.player.playing).toBe(true);
});

test('switching queues invalidates a delayed old-page response', async () => {
  let finish!: (value: { tracks: Track[]; hasMore: boolean }) => void;
  api.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await TestRenderer.act(async () => {
    app.loadMoreQueue();
  });
  await TestRenderer.act(async () => {
    await app.playTrack(tracks[60]!, tracks.slice(60), 0, {
      openPlayer: false,
    });
  });
  await TestRenderer.act(async () =>
    finish({ tracks: tracks.slice(20, 40), hasMore: true }),
  );
  expect(app.queue.map(track => track.id)).toEqual(
    tracks.slice(60).map(track => track.id),
  );
  expect(nativePlayer.appendQueue).not.toHaveBeenCalled();
});

test('selecting an existing queue entry retains its collection continuation and stop-before-resolve', async () => {
  jest.mocked(resolvePlayback).mockClear();
  await TestRenderer.act(async () => {
    await app.playTrack(app.queue[4]!, app.queue, 4, { openPlayer: false });
  });
  expect(app.player.index).toBe(4);
  expect(
    jest.mocked(nativePlayer.stop).mock.invocationCallOrder[1],
  ).toBeLessThan(jest.mocked(resolvePlayback).mock.invocationCallOrder[0]!);
  await TestRenderer.act(async () => {
    await app.loadMoreQueue();
  });
  expect(api).toHaveBeenCalledWith(
    'netease',
    'playlists',
    'collection-a',
    20,
    20,
  );
  expect(app.player.index).toBe(4);
  expect(api).toHaveBeenCalledWith('netease', 'playlists', 'collection-a', 40, 20);
  expect(app.queue).toHaveLength(60);
});

test('selecting an early logical-queue entry keeps its position without hydrating neighbours', async () => {
  const page = tracks.slice(20, 40);
  const releases: (() => void)[] = [];
  jest
    .spyOn(nativePlayer, 'waitForPlaybackStart')
    .mockImplementation(
      () => new Promise<void>(resolve => releases.push(resolve)),
    );
  jest.mocked(nativePlayer.loadQueue).mockClear();
  const insert = jest
    .spyOn(nativePlayer, 'insertQueueAroundCurrent')
    .mockClear();
  let initialPlayback!: Promise<void>;
  await TestRenderer.act(async () => {
    initialPlayback = app.playTrack(page[0]!, page, 0, {
      openPlayer: false,
      queueSource: {
        kind: 'collection',
        collectionKind: 'playlists',
        provider: 'netease',
        id: 'collection-c',
        offset: 40,
        hasMore: true,
      },
    });
    await Promise.resolve();
    await Promise.resolve();
  });
  const originalOrder = app.queue.map(track => track.id);
  expect(originalOrder).toEqual(page.map(track => track.id));

  let selectedPlayback!: Promise<void>;
  await TestRenderer.act(async () => {
    selectedPlayback = app.playTrack(app.queue[5]!, app.queue, 5, {
      openPlayer: false,
    });
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(app.queue.map(track => track.id)).toEqual(originalOrder);
  expect(app.player.index).toBe(5);
  await TestRenderer.act(async () => {
    emit({ ...app.player, index: 0, playing: true });
  });
  expect(app.player.index).toBe(5);

  await TestRenderer.act(async () => {
    releases.forEach(release => release());
    await Promise.all([initialPlayback, selectedPlayback]);
  });
  expect(insert).not.toHaveBeenCalled();
  expect(app.queue.slice(0, originalOrder.length).map(track => track.id)).toEqual(originalOrder);
  expect(app.queue).toHaveLength(40);
  expect(app.player.index).toBe(5);

  api.mockClear();
  await TestRenderer.act(async () => {
    await app.loadMoreQueue();
  });
  expect(api).toHaveBeenCalledWith(
    'netease',
    'playlists',
    'collection-c',
    60,
    20,
  );
  insert.mockRestore();
});

test('a cold non-first selection starts alone and publishes the remaining queue as metadata', async () => {
  jest.mocked(resolvePlayback).mockClear();
  jest.mocked(nativePlayer.loadQueue).mockClear();
  const hydrate = jest.spyOn(nativePlayer, 'insertQueueAroundCurrent');
  const page = tracks.slice(20, 50);
  const expectedQueue = [
    page[4]!,
    ...page.filter((_, itemIndex) => itemIndex !== 4),
  ].slice(0, 20);
  await TestRenderer.act(async () => {
    await app.playTrack(page[4]!, page, 4, {
      openPlayer: false,
      queueSource: {
        kind: 'collection',
        collectionKind: 'playlists',
        provider: 'netease',
        id: 'collection-b',
        offset: 40,
        hasMore: true,
      },
    });
  });
  expect(nativePlayer.loadQueue).toHaveBeenCalledWith(
    [expect.objectContaining({ id: 'song-24' })],
    0,
    true,
  );
  expect(hydrate).not.toHaveBeenCalled();
  expect(app.queue.slice(0, 20).map(track => track.id)).toEqual(
    expectedQueue.map(track => track.id),
  );
  expect(app.queue).toHaveLength(40);
  expect(app.player.index).toBe(0);
  hydrate.mockRestore();
});

test('a failed cold start reports the selected entry without silently advancing', async () => {
  const page = tracks.slice(40, 60);
  jest.mocked(resolvePlayback).mockClear();
  jest
    .mocked(resolvePlayback)
    .mockRejectedValueOnce(new Error('该歌曲为试听片段，已从列表移除'));
  jest.mocked(nativePlayer.loadQueue).mockClear();

  await TestRenderer.act(async () => {
    await app.playTrack(page[0]!, page, 0, { openPlayer: false });
  });

  expect(resolvePlayback).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ id: 'song-40' }),
    expect.anything(),
    expect.anything(),
  );
  expect(resolvePlayback).toHaveBeenCalledTimes(1);
  expect(nativePlayer.loadQueue).not.toHaveBeenCalled();
  expect(app.current?.id).not.toBe('song-40');
  expect(app.message).toBe('当前歌曲没有可播放的在线音源');
});

test.each(['netease', 'qq', 'kugou', 'kuwo', 'migu'] as const)(
  'a cold %s Home tap resolves only the selected song until native playback is real',
  async provider => {
    const page = tracks.slice(20, 40).map((track, index) => ({
      ...track,
      id: `${provider}-cold-${index}`,
      providerId: `${provider}-${index}`,
      provider,
    }));
    let releasePlayback!: () => void;
    const waitForPlaybackStart = jest
      .spyOn(nativePlayer, 'waitForPlaybackStart')
      .mockImplementation(
        () =>
          new Promise<void>(resolve => {
            releasePlayback = resolve;
          }),
      );
    jest.mocked(resolvePlayback).mockClear();
    jest.mocked(nativePlayer.loadQueue).mockClear();
    const insert = jest
      .spyOn(nativePlayer, 'insertQueueAroundCurrent')
      .mockClear();

    let playing!: Promise<void>;
    await TestRenderer.act(async () => {
      playing = app.playTrack(page[4]!, page, 4, { openPlayer: false });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resolvePlayback).toHaveBeenCalledTimes(1);
    expect(resolvePlayback).toHaveBeenCalledWith(
      expect.objectContaining({ provider, id: `${provider}-cold-4` }),
      expect.anything(),
      expect.anything(),
    );
    expect(nativePlayer.loadQueue).toHaveBeenCalledWith(
      [expect.objectContaining({ id: `${provider}-cold-4` })],
      0,
      true,
    );
    expect(waitForPlaybackStart).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
    expect(app.queue.map(track => track.id)).toEqual([
      `${provider}-cold-4`,
      ...page.filter((_, itemIndex) => itemIndex !== 4).map(track => track.id),
    ]);
    expect(app.player.index).toBe(0);

    await TestRenderer.act(async () => {
      releasePlayback();
      await playing;
    });
    expect(insert).not.toHaveBeenCalled();
    expect(app.queue.map(track => track.id)).toEqual([
      `${provider}-cold-4`,
      ...page.filter((_, itemIndex) => itemIndex !== 4).map(track => track.id),
    ]);
    expect(app.player.index).toBe(0);
  },
);
