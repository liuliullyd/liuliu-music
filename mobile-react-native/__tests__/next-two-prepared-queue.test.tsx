import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, DeviceEventEmitter, NativeModules, type AppStateStatus } from 'react-native';
import { AppProvider, useApp } from '../src/state/AppContext';
import { nativePlayer } from '../src/services/nativePlayer';
import { playerQuality } from '../src/services/playerQuality';
import {
  clearResolvedSourceCache,
  clearRuntimeResolutionCache,
  probeManualSource,
  resolveWithImportedSourcePrewarm,
} from '../src/services/sourceRuntime';
import type { NativePlayerState, Track } from '../src/domain/types';

jest.mock('../src/services/nativePlayer', () => {
  const actual = jest.requireActual('../src/services/nativePlayer');
  return { ...actual, nativePlayer: { ...actual.nativePlayer,
    resumeInterruptedPlayback: jest.fn(async () => false),
    refreshPreparedQueueItem: jest.fn(async () => false),
  } };
});

// Queue integration owns playback; the native splash animation is verified separately.
jest.mock('../src/components/StartupSplash', () => ({
  ...jest.requireActual('../src/components/StartupSplash'), StartupSplashView: () => null,
}));

jest.mock('../src/services/storage', () => {
  const actual = jest.requireActual('../src/services/storage');
  return {
    ...actual,
    saveState: jest.fn(async () => undefined),
    loadState: jest.fn(async () => ({
      ...actual.defaultState(),
      sources: [
        {
          id: 'bound',
          name: '导入音源',
          enabled: true,
          healthy: true,
          script: 'shared-script',
          capabilities: ['wy', 'tx', 'kg', 'kw', 'mg'],
          sourceCapabilities: {
            mg: { qualitys: ['128k'] },
            tx: { qualitys: ['128k'] },
            wy: { qualitys: ['128k'] },
            kg: { qualitys: ['128k'] },
            kw: { qualitys: ['128k'] },
          },
        },
      ],
      settings: {
        ...actual.defaultState().settings,
        quality: '128k',
        startupAutoplay: false,
      },
    })),
  };
});
jest.mock('../src/services/liveDiscovery', () => ({
  ...jest.requireActual('../src/services/liveDiscovery'),
  loadCategoryFeed: jest.fn(async () => []),
  detectHealthyPlatforms: jest.fn(async () => ({
    healthy: ['netease', 'qq', 'kugou', 'kuwo', 'migu'], first: 'migu', sourceIds: ['bound'],
    sourceIdsByProvider: { netease: ['bound'], qq: ['bound'], kugou: ['bound'], kuwo: ['bound'], migu: ['bound'] },
    backendByProvider: { netease: 'wy-route', qq: 'tx-route', kugou: 'kg-route', kuwo: 'kw-route', migu: 'mg-route' },
    byProvider: {}, completed: true, pending: [],
  })),
  startPlatformHealthDetection: jest.fn(
    (_platforms, _sources, _quality, _multi, update) => {
      const health = {
        healthy: ['netease', 'qq', 'kugou', 'kuwo', 'migu'],
        first: 'migu',
        sourceIds: ['bound'],
        sourceIdsByProvider: {
          netease: ['bound'],
          qq: ['bound'],
          kugou: ['bound'],
          kuwo: ['bound'],
          migu: ['bound'],
        },
        backendByProvider: {
          netease: 'wy-route',
          qq: 'tx-route',
          kugou: 'kg-route',
          kuwo: 'kw-route',
          migu: 'mg-route',
        },
        byProvider: {},
        completed: true,
        pending: [],
      };
      update(health);
      return {
        firstPassed: Promise.resolve(health),
        completed: Promise.resolve(health),
      };
    },
  ),
}));
const song = (
  provider: Exclude<Track['provider'], 'custom'>,
  index: number,
): Track => ({
  id: `${provider}-${index}`,
  providerId: String(index),
  provider,
  title: `歌 ${index}`,
  artist: '歌手',
  album: '专辑',
  duration: 240,
  coverKey: 'train',
  language: '华语',
  genre: '流行',
  mood: '发现',
  releaseYear: 2026,
});
const flush = async () => {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
};
let app!: ReturnType<typeof useApp>;
let view!: Renderer.ReactTestRenderer;
let emit!: Parameters<typeof nativePlayer.subscribe>[0];
let nativeState: NativePlayerState;
let nativeQueue: Track[];
const appStateListeners = new Set<(state: AppStateStatus) => void>();
const changeAppState = (state: AppStateStatus) => appStateListeners.forEach(listener => listener(state));
function Probe() {
  app = useApp();
  return null;
}

beforeEach(async () => {
  jest.useFakeTimers();
  appStateListeners.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  });
  jest.mocked(nativePlayer.resumeInterruptedPlayback).mockReset().mockResolvedValue(false);
  jest.mocked(nativePlayer.refreshPreparedQueueItem).mockReset().mockImplementation(async (currentId, index, track) => {
    if (!nativeState.playing || nativeState.mediaId !== currentId || nativeQueue[index]?.providerId !== track.providerId) return false;
    nativeQueue[index] = track;
    return true;
  });
  clearResolvedSourceCache();
  nativeQueue = [];
  nativeState = {
    playing: false,
    index: 0,
    position: 0,
    duration: 240,
    volume: 0.72,
    sleepMode: 'off',
  };
  NativeModules.LiuliuStorage = {
    resolveSourceScriptForHealth: jest.fn(async (_script, platform) => ({
      url: `https://audio.test/${platform}/sample`,
      backend: `${platform}-route`,
    })),
    probeAudioPrefix: jest.fn(async () => ({ sampleBytes: 64 })),
    resolveSourceScriptAddress: jest.fn(async (_script, platform, json) => {
      const info = JSON.parse(json);
      expect(info.__lxPinnedBackend).toBe(`${platform}-route`);
      return {
        url: `https://audio.test/${platform}/${info.songmid}`,
        backend: `${platform}-route`,
      };
    }),
    cancelSourceScriptAddress: jest.fn(async () => true),
    resolveSourceScript: jest.fn(async (_script, platform, json) => ({
      url: `https://audio.test/${platform}/${JSON.parse(json).songmid}`,
      backend: `${platform}-route`,
    })),
    probeAudioUrl: jest.fn(async () => ({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000 })),
    probeBackgroundAudioUrl: jest.fn(async () => ({
      durationSeconds: 240,
      mimeType: 'audio/mpeg',
      bitrate: 128000,
      sampleBytes: 4096,
    })),
    cancelBackgroundAudioProbe: jest.fn(async () => true),
  };
  jest.spyOn(nativePlayer, 'subscribe').mockImplementation(callback => {
    emit = callback;
    return () => undefined;
  });
  jest
    .spyOn(nativePlayer, 'getState')
    .mockImplementation(async () => nativeState);
  jest.spyOn(nativePlayer, 'stop').mockResolvedValue();
  jest.spyOn(nativePlayer, 'waitForPlaybackStart').mockResolvedValue();
  jest.spyOn(nativePlayer, 'loadQueue').mockImplementation(async tracks => {
    nativeQueue = tracks;
    nativeState = {
      ...nativeState,
      playing: true,
      index: 0,
      mediaId: `${tracks[0]!.provider}:${tracks[0]!.providerId}`,
      ended: false,
    };
  });
  jest.spyOn(nativePlayer, 'appendQueue').mockResolvedValue();
  jest.spyOn(nativePlayer, 'insertQueueAroundCurrent').mockResolvedValue();
  jest.spyOn(nativePlayer, 'insertQueueItems').mockImplementation(async (_current, index, tracks) => { nativeQueue.splice(index, 0, ...tracks); });
  jest.spyOn(nativePlayer, 'replaceQueueItem').mockImplementation(async (index, track) => { nativeQueue[index] = track; });
  jest.spyOn(nativePlayer, 'removeQueueItem').mockImplementation(async index => { nativeQueue.splice(index, 1); });
  jest.spyOn(nativePlayer, 'removePreparedQueueItem').mockImplementation(async (current, target, index) => {
    if (nativeState.mediaId !== current || `${nativeQueue[index]?.provider}:${nativeQueue[index]?.providerId}` !== target || target === current) return false;
    nativeQueue.splice(index, 1);
    return true;
  });
  jest.spyOn(nativePlayer, 'reorderQueue').mockImplementation(async (_current, keys) => {
    nativeQueue = keys.map(key => nativeQueue.find(track => `${track.provider}:${track.providerId}` === key)!);
  });
  jest.spyOn(nativePlayer, 'replaceCurrent').mockImplementation(async (track, position, playing) => {
    const index = nativeQueue.findIndex(item => `${item.provider}:${item.providerId}` === nativeState.mediaId);
    nativeQueue[index] = track;
    nativeState = { ...nativeState, position, playing };
  });
  jest.spyOn(nativePlayer, 'play').mockImplementation(async () => { nativeState = { ...nativeState, playing: true }; });
  jest.spyOn(nativePlayer, 'pause').mockResolvedValue();
  jest.spyOn(nativePlayer, 'playIndex').mockImplementation(async index => {
    const target = nativeQueue[index] ?? app.queue[index]!;
    nativeState = { ...nativeState, index, playing: true, position: 0, mediaId: `${target.provider}:${target.providerId}` };
  });
  await act(async () => {
    view = Renderer.create(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10);
  });
}, 15_000);

test('validated queue processes every loaded song from top to bottom and next-two consumes its exact evidence without another probe', async () => {
  const tracks = Array.from({ length: 5 }, (_, index) => song('qq', index));
  const native = NativeModules.LiuliuStorage;
  let finish!: (value: any) => void;
  native.probeBackgroundAudioUrl.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(native.resolveSourceScriptAddress.mock.calls.map((call: any[]) => JSON.parse(call[2]).songmid)).toEqual(['1']);
  expect(nativePlayer.insertQueueItems).not.toHaveBeenCalled();
  expect(finish).toBeDefined();
  await act(async () => { finish({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 }); await flush(); });
  expect(native.probeBackgroundAudioUrl.mock.calls.map((call: any[]) => call[0])).toEqual([1, 2, 3, 4].map(id => `https://audio.test/tx/${id}`));
  expect(native.probeAudioUrl).toHaveBeenCalledTimes(1);
  expect(app.queue[1]?.playUrl).toBe('https://audio.test/tx/1');
  expect(playerQuality(app.queue[1]!)).toMatchObject({ label: '标清' });
  const addresses = native.resolveSourceScriptAddress.mock.calls.length;
  const probes = native.probeBackgroundAudioUrl.mock.calls.length;
  await act(async () => { await app.next(); emit(nativeState); await flush(); });
  expect(nativePlayer.playIndex).toHaveBeenCalledWith(1);
  expect(native.resolveSourceScriptAddress).toHaveBeenCalledTimes(addresses);
  expect(native.probeBackgroundAudioUrl).toHaveBeenCalledTimes(probes);
  expect(native.probeAudioUrl).toHaveBeenCalledTimes(1);
  expect(playerQuality(app.current)).toMatchObject({ label: '标清' });
});

test.each(['selection', 'toggle'] as const)('task removal cancels queued audio validation and ignores late playback until a genuine foreground return through %s', async entry => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  const native = NativeModules.LiuliuStorage;
  let finish!: (value: unknown) => void;
  native.probeBackgroundAudioUrl.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => {
    await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } });
    await flush();
  });
  expect(finish).toBeDefined();
  const loadCount = jest.mocked(nativePlayer.loadQueue).mock.calls.length;
  await act(async () => { changeAppState('background'); DeviceEventEmitter.emit('playbackTaskRemoved'); await flush(); });
  expect(app.player.playing).toBe(false);
  expect(native.cancelBackgroundAudioProbe).toHaveBeenCalled();
  await act(async () => {
    finish({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 });
    emit({ ...nativeState, playing: true });
    await flush();
  });
  expect(app.player.playing).toBe(false);
  expect(nativePlayer.insertQueueItems).not.toHaveBeenCalled();
  expect(native.probeBackgroundAudioUrl).toHaveBeenCalledTimes(1);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(loadCount);
  nativeState = { ...nativeState, playing: false, mediaId: undefined };
  await act(async () => { changeAppState('active'); await flush(); });
  expect(nativePlayer.resumeInterruptedPlayback).not.toHaveBeenCalled();
  await act(async () => {
    if (entry === 'toggle') await app.togglePlay();
    else await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } });
    emit(nativeState);
    await flush();
  });
  expect(app.player.playing).toBe(true);
  expect(app.queue).toHaveLength(6);
  expect(app.queue[5]?.playUrl).toBe('https://audio.test/tx/5');
  expect(nativePlayer.insertQueueItems).toHaveBeenCalled();
});

test('task removal invalidates an in-flight selected song before its native load', async () => {
  const tracks = [song('qq', 0), song('qq', 1)];
  let finish!: (value: unknown) => void;
  NativeModules.LiuliuStorage.probeAudioUrl.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let selection!: Promise<void>;
  await act(async () => { selection = app.playTrack(tracks[0]!, tracks); await flush(); });
  expect(finish).toBeDefined();
  await act(async () => { DeviceEventEmitter.emit('playbackTaskRemoved'); await flush(); });
  await act(async () => {
    finish({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000 });
    await selection;
    await flush();
  });
  expect(nativePlayer.loadQueue).not.toHaveBeenCalled();
  expect(app.player.playing).toBe(false);
  expect(app.busy).toBe(false);
});

test('interruption return renews the entire cached queue after actual playback and rolls preparation through songs three four and five', async () => {
  const tracks = Array.from({ length: 7 }, (_, index) => song('qq', index));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  await act(async () => { await app.next(); emit(nativeState); await flush(); });
  const native = NativeModules.LiuliuStorage;
  const currentUrl = nativeQueue[1]!.playUrl;
  native.probeAudioUrl.mockClear();
  native.probeBackgroundAudioUrl.mockClear();
  native.resolveSourceScriptAddress.mockClear();
  native.probeBackgroundAudioUrl.mockImplementation(async (url: string) => {
    if (!url.includes('?renewed')) throw new Error('HTTP 403');
    return { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 };
  });
  native.resolveSourceScriptAddress.mockImplementation(async (_script: string, platform: string, json: string) => ({
    url: `https://audio.test/${platform}/${JSON.parse(json).songmid}?renewed`, backend: `${platform}-route`,
  }));
  native.resolveSourceScript.mockImplementation(native.resolveSourceScriptAddress.getMockImplementation());
  nativeState = { ...nativeState, playing: false, position: 91.25 };
  jest.mocked(nativePlayer.resumeInterruptedPlayback).mockResolvedValue(true);
  await act(async () => { emit(nativeState); changeAppState('active'); await flush(); });
  expect(nativePlayer.refreshPreparedQueueItem).not.toHaveBeenCalled();
  expect(native.probeAudioUrl).not.toHaveBeenCalled();
  expect(native.probeBackgroundAudioUrl).not.toHaveBeenCalled();
  await act(async () => { nativeState = { ...nativeState, playing: true }; emit(nativeState); await flush(); });
  expect(native.resolveSourceScriptAddress.mock.calls.map((call: any[]) => JSON.parse(call[2]).songmid)).toEqual(['0', '2', '3', '4', '5', '6']);
  expect(nativeQueue.filter(track => track.providerId !== '1').every(track => track.playUrl?.endsWith('?renewed'))).toBe(true);
  expect(nativeQueue[1]?.playUrl).toBe(currentUrl);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
  expect(nativeState.position).toBe(91.25);
  const addressCount = native.resolveSourceScriptAddress.mock.calls.length;
  const probeCount = native.probeBackgroundAudioUrl.mock.calls.length;
  for (const id of ['2', '3', '4', '5']) {
    await act(async () => { await app.next(); emit(nativeState); await flush(); });
    expect(app.current?.providerId).toBe(id);
    expect(app.current?.playUrl).toBe(`https://audio.test/tx/${id}?renewed`);
    expect(nativeQueue.find(track => track.providerId === String(Number(id) + 1))?.playUrl).toBe(`https://audio.test/tx/${Number(id) + 1}?renewed`);
  }
  expect(native.resolveSourceScriptAddress).toHaveBeenCalledTimes(addressCount);
  expect(native.probeBackgroundAudioUrl).toHaveBeenCalledTimes(probeCount);
  expect(native.probeAudioUrl).not.toHaveBeenCalled();
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
});

test('valid cached queue addresses are rechecked in order and reused without resolving again on interruption return', async () => {
  const tracks = Array.from({ length: 4 }, (_, index) => song('qq', index));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  const native = NativeModules.LiuliuStorage;
  native.probeAudioUrl.mockClear();
  native.probeBackgroundAudioUrl.mockClear();
  native.resolveSourceScript.mockClear();
  native.resolveSourceScriptAddress.mockClear();
  nativeState = { ...nativeState, playing: false, position: 70 };
  jest.mocked(nativePlayer.resumeInterruptedPlayback).mockResolvedValue(true);
  await act(async () => { emit(nativeState); changeAppState('active'); await flush(); });
  await act(async () => { nativeState = { ...nativeState, playing: true }; emit(nativeState); await flush(); });
  expect(native.probeBackgroundAudioUrl.mock.calls.map((call: any[]) => call[0])).toEqual([1, 2, 3].map(id => `https://audio.test/tx/${id}`));
  expect(native.probeAudioUrl).not.toHaveBeenCalled();
  expect(native.resolveSourceScript).not.toHaveBeenCalled();
  expect(native.resolveSourceScriptAddress).not.toHaveBeenCalled();
  expect(nativePlayer.refreshPreparedQueueItem).not.toHaveBeenCalled();
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
});

test('interruption queue drops an unavailable cached row without scheduler retry before checking the following row', async () => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  const native = NativeModules.LiuliuStorage;
  native.resolveSourceScriptAddress.mockClear();
  native.resolveSourceScriptAddress.mockImplementation(async (_script: string, _platform: string, json: string) => {
    expect(JSON.parse(json).songmid).toBe('3');
    throw new Error('unavailable');
  });
  native.probeBackgroundAudioUrl.mockClear();
  let finishFollowing!: (value: any) => void;
  native.probeBackgroundAudioUrl.mockImplementation(async (url: string) => {
    if (url.endsWith('/3')) throw new Error('HTTP 403');
    if (url.endsWith('/4')) return new Promise(resolve => { finishFollowing = resolve; });
    return { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 };
  });
  nativeState = { ...nativeState, playing: false, position: 70 };
  jest.mocked(nativePlayer.resumeInterruptedPlayback).mockResolvedValue(true);
  await act(async () => { emit(nativeState); changeAppState('active'); await flush(); });
  await act(async () => { nativeState = { ...nativeState, playing: true }; emit(nativeState); await flush(); });
  expect(finishFollowing).toBeDefined();
  expect(app.queue.map(track => track.providerId)).toEqual(['0', '1', '2', '4', '5']);
  await act(async () => {
    finishFollowing({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 });
    await flush();
  });
  expect(app.queue.map(track => track.providerId)).toEqual(['0', '1', '2', '4', '5']);
  expect(native.resolveSourceScriptAddress).toHaveBeenCalledTimes(1);
  expect(native.probeBackgroundAudioUrl.mock.calls.map((call: any[]) => call[0])).toEqual([1, 2, 3, 4, 5].map(id => `https://audio.test/tx/${id}`));
});

test('interruption queue keeps validating later rows while a prepared navigation changes the active generation', async () => {
  const tracks = Array.from({ length: 7 }, (_, index) => song('qq', index));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  const native = NativeModules.LiuliuStorage;
  native.probeBackgroundAudioUrl.mockClear();
  let finish!: (value: any) => void;
  native.probeBackgroundAudioUrl.mockImplementation(async (url: string) => {
    if (url.endsWith('/3') && !finish) return new Promise(resolve => { finish = resolve; });
    return { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 };
  });
  nativeState = { ...nativeState, playing: false, position: 70 };
  jest.mocked(nativePlayer.resumeInterruptedPlayback).mockResolvedValue(true);
  await act(async () => { emit(nativeState); changeAppState('active'); await flush(); });
  await act(async () => { nativeState = { ...nativeState, playing: true }; emit(nativeState); await flush(); });
  expect(finish).toBeDefined();
  await act(async () => { await app.next(); emit(nativeState); await flush(); });
  await act(async () => { finish({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 }); await flush(); });
  expect(app.current?.providerId).toBe('1');
  expect(native.probeBackgroundAudioUrl.mock.calls.some((call: any[]) => call[0].endsWith('/6'))).toBe(true);
  await act(async () => { await app.next(); emit(nativeState); await flush(); });
  expect(nativeQueue.find(track => track.providerId === '4')?.playUrl).toBe('https://audio.test/tx/4');
});

test('a replacement queue rejects a late interruption check without changing the new queue or current song', async () => {
  const tracks = Array.from({ length: 4 }, (_, index) => song('qq', index));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  let finish!: (value: any) => void;
  NativeModules.LiuliuStorage.probeBackgroundAudioUrl.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  nativeState = { ...nativeState, playing: false, position: 70 };
  jest.mocked(nativePlayer.resumeInterruptedPlayback).mockResolvedValue(true);
  await act(async () => { emit(nativeState); changeAppState('active'); await flush(); });
  await act(async () => { nativeState = { ...nativeState, playing: true }; emit(nativeState); await flush(); });
  expect(finish).toBeDefined();
  const replacement = Array.from({ length: 3 }, (_, index) => song('qq', index + 10));
  await act(async () => { await app.playTrack(replacement[0]!, replacement, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  await act(async () => { finish({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 }); await flush(); });
  expect(app.current?.providerId).toBe('10');
  expect(app.queue.map(track => track.providerId)).toEqual(['10', '11', '12']);
  expect(nativeQueue.map(track => track.providerId)).toEqual(['10', '11', '12']);
  expect(nativePlayer.refreshPreparedQueueItem).not.toHaveBeenCalled();
});

test('a late interrupted-neighbour probe cannot replace a song selected by the user', async () => {
  const tracks = Array.from({ length: 4 }, (_, index) => song('qq', index));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  let finish!: (value: any) => void;
  NativeModules.LiuliuStorage.probeBackgroundAudioUrl.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  nativeState = { ...nativeState, playing: false, position: 70 };
  jest.mocked(nativePlayer.resumeInterruptedPlayback).mockResolvedValue(true);
  await act(async () => { emit(nativeState); changeAppState('active'); await flush(); });
  await act(async () => { nativeState = { ...nativeState, playing: true }; emit(nativeState); await flush(); });
  expect(finish).toBeDefined();
  await act(async () => { await app.next(); emit(nativeState); await flush(); });
  await act(async () => { finish({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 }); await flush(); });
  expect(app.current?.providerId).toBe('1');
  expect(nativePlayer.refreshPreparedQueueItem).not.toHaveBeenCalled();
});

test('validated queue removes a song whose URLs fail audio validation before processing the next row', async () => {
  const tracks = Array.from({ length: 4 }, (_, index) => song('qq', index));
  const native = NativeModules.LiuliuStorage, order: string[] = [];
  native.probeBackgroundAudioUrl.mockImplementation(async (url: string) => {
    const id = url.split('/').pop()!; order.push(id);
    if (id === '1') throw new Error('HTTP 403');
    expect(app.queue.some(track => track.providerId === '1')).toBe(false);
    return { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 };
  });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(app.queue.map(track => track.providerId)).toEqual(['0', '2', '3']);
  expect(order.slice(-2)).toEqual(['2', '3']);
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0', '2', '3']);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
});

test('validated queue exhausts the allowed quality order before dropping a row and stops at the first good result', async () => {
  await act(async () => { app.setSetting('quality', 'hires'); app.setSetting('wifiQuality', 'hires'); await flush(); });
  const tracks = Array.from({ length: 3 }, (_, index) => song('qq', index));
  const native = NativeModules.LiuliuStorage;
  native.resolveSourceScriptAddress.mockImplementation(async (_script: string, platform: string, json: string, quality: string) => ({
    url: `https://audio.test/${platform}/${JSON.parse(json).songmid}/${quality}`, backend: `${platform}-route`,
  }));
  native.probeBackgroundAudioUrl.mockImplementation(async (url: string) => {
    if (url.includes('/1/')) throw new Error('HTTP 403');
    expect(app.queue.some(track => track.providerId === '1')).toBe(false);
    return { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 };
  });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  const qualitiesFor = (id: string) => native.resolveSourceScriptAddress.mock.calls
    .filter((call: any[]) => JSON.parse(call[2]).songmid === id).map((call: any[]) => call[3]);
  expect([...new Set(qualitiesFor('1'))]).toEqual(['hires', 'flac24bit', 'flac', '320k', '128k']);
  expect(qualitiesFor('2')).toEqual(['hires']);
  expect(app.queue.map(track => track.providerId)).toEqual(['0', '2']);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
});

test('validated queue still drops another failed row after prepared navigation changes playback generation', async () => {
  const tracks = Array.from({ length: 4 }, (_, index) => song('qq', index));
  const native = NativeModules.LiuliuStorage;
  let block = true;
  native.probeBackgroundAudioUrl.mockImplementation(async (url: string) => {
    if (url.endsWith('/2')) {
      if (block) return new Promise(() => undefined);
      throw new Error('HTTP 403');
    }
    return { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 };
  });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0', '1']);
  await act(async () => { block = false; await app.next(); emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe('1');
  expect(app.queue.map(track => track.providerId)).toEqual(['0', '1', '3']);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
});

test('memory statistics count confirmed playback once, ignore pause/resume/ticks, and include a natural transition and a new same-song playback', async () => {
  const tracks = [song('qq', 0), song('qq', 1)].map(track => ({ ...track, metadata: { genre: 'rock', language: 'English' } }));
  let start!: () => void;
  jest.mocked(nativePlayer.waitForPlaybackStart).mockImplementationOnce(() => new Promise(resolve => { start = resolve; }));
  let selected!: Promise<void>;
  await act(async () => { selected = app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(app.state!.profile.memoryStatistics?.samples ?? 0).toBe(0);
  await act(async () => { start(); await selected; emit(nativeState); await flush(); });
  expect(app.state!.profile.memoryStatistics?.samples).toBe(1);
  await act(async () => {
    emit({ ...nativeState, playing: false }); emit({ ...nativeState, position: 12, playing: true });
    await jest.advanceTimersByTimeAsync(2400); await flush();
  });
  expect(app.state!.profile.memoryStatistics?.samples).toBe(1);
  await act(async () => { nativeState = { ...nativeState, index: 1, mediaId: 'qq:1', playing: true }; emit(nativeState); await flush(); });
  expect(app.state!.profile.memoryStatistics?.samples).toBe(2);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); emit(nativeState); await flush(); });
  expect(app.state!.profile.memoryStatistics?.samples).toBe(3);
  expect(app.state!.history).toHaveLength(2);
});

test('actual playback prepares exactly two warmed neighbours in order, retaining actual quality and using prepared navigation', async () => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  let started!: () => void;
  jest.mocked(nativePlayer.waitForPlaybackStart).mockImplementationOnce(() => new Promise(resolve => { started = resolve; }));
  let selection!: Promise<void>;
  await act(async () => { selection = app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(app.queue.map(track => track.id)).toEqual(tracks.map(track => track.id));
  expect(nativePlayer.insertQueueItems).not.toHaveBeenCalled();
  expect(NativeModules.LiuliuStorage.resolveSourceScriptAddress).not.toHaveBeenCalled();
  await act(async () => { started(); await selection; await flush(); });
  expect(jest.mocked(nativePlayer.insertQueueItems).mock.calls.map(call => [call[0], call[1], call[2].map(track => track.providerId)])).toEqual([
    ['qq:0', 1, ['1']], ['qq:0', 2, ['2']],
  ]);
  expect(NativeModules.LiuliuStorage.probeAudioUrl.mock.calls.map((call: any[]) => call[0])).toEqual(['https://audio.test/tx/0']);
  expect(NativeModules.LiuliuStorage.probeBackgroundAudioUrl.mock.calls.map((call: any[]) => call[0]))
    .toEqual([1, 2, 3, 4, 5].map(id => `https://audio.test/tx/${id}`));
  expect(app.queue[1]?.metadata).toMatchObject({ _playbackQuality: '128k', _playbackPreference: '128k', _prewarmedUrl: false });
  const resolveCount = NativeModules.LiuliuStorage.resolveSourceScript.mock.calls.length;
  await act(async () => { await app.next(); await flush(); });
  expect(nativePlayer.playIndex).toHaveBeenCalledWith(1);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
  expect(NativeModules.LiuliuStorage.resolveSourceScript).toHaveBeenCalledTimes(resolveCount);
  expect(app.current?.providerId).toBe('1');
});

test('a neighbour discovering higher audio on the same checked route keeps the first cached URL ready for promotion and next', async () => {
  await act(async () => { app.setSetting('quality', 'hires'); app.setSetting('wifiQuality', 'hires'); await flush(); });
  const route = 'GET:https://resolver.test/shared';
  const resolve = jest.fn(async (_script, platform, json) => ({
    url: `https://audio.test/${platform}/${JSON.parse(json).songmid}`,
    backend: `${platform}-route`, backendUrls: [{ url: 'https://resolver.test/shared', requestRoute: route }],
  }));
  NativeModules.LiuliuStorage.resolveSourceScript.mockImplementation(resolve);
  NativeModules.LiuliuStorage.resolveSourceScriptAddress.mockImplementation(resolve);
  const low = { durationSeconds: 240, mimeType: 'audio/flac', bitsPerSample: 16, sampleRate: 44100, sampleBytes: 4096 };
  const high = { ...low, bitsPerSample: 24, sampleRate: 96000 };
  let finishSecond!: (value: any) => void;
  NativeModules.LiuliuStorage.probeBackgroundAudioUrl.mockImplementation(async (url: string) =>
    url.endsWith('/2') ? new Promise(resolve => { finishSecond = resolve; }) : low);
  NativeModules.LiuliuStorage.probeAudioUrl.mockResolvedValue(low);
  const tracks = Array.from({ length: 3 }, (_, index) => song('qq', index));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(finishSecond).toBeDefined();
  expect(app.queue[1]?.metadata?._playbackQuality).toBe('flac');
  await act(async () => { finishSecond(high); await flush(); });
  expect(jest.mocked(nativePlayer.insertQueueItems).mock.calls.flatMap(call => call[2].map(track => track.providerId))).toEqual(['1', '2']);
  expect(NativeModules.LiuliuStorage.resolveSourceScript.mock.calls.filter((call: any[]) => JSON.parse(call[2]).songmid === '1')).toHaveLength(0);
  expect(app.queue[1]?.playUrl).toBe('https://audio.test/tx/1');
  const requests = resolve.mock.calls.length;
  await act(async () => { await app.next(); await flush(); });
  expect(nativePlayer.playIndex).toHaveBeenCalledWith(1);
  expect(resolve).toHaveBeenCalledTimes(requests);
});

test('a cold or failed first neighbour never promotes the second across a logical gap', async () => {
  const tracks = Array.from({ length: 4 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  let finishFirst!: (value: any) => void;
  NativeModules.LiuliuStorage.probeBackgroundAudioUrl.mockImplementation(async (url: string) => url.endsWith('/1')
    ? new Promise(resolve => { finishFirst = resolve; })
    : { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(nativePlayer.insertQueueItems).not.toHaveBeenCalled();
  expect(NativeModules.LiuliuStorage.resolveSourceScript).toHaveBeenCalledTimes(1);
  await act(async () => { finishFirst({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 }); await flush(); });
  expect(jest.mocked(nativePlayer.insertQueueItems).mock.calls.flatMap(call => call[2].map(track => track.providerId))).toEqual(['1', '2']);
});

test('navigation waits for native insertion and keeps the prepared queue mapping even after generation changes', async () => {
  const tracks = Array.from({ length: 5 }, (_, index) => song('qq', index));
  let finishInsert!: () => void;
  jest.mocked(nativePlayer.insertQueueItems).mockImplementationOnce((_current, index, tracks) => new Promise(resolve => { finishInsert = () => { nativeQueue.splice(index, 0, ...tracks); resolve(); }; }));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(nativePlayer.insertQueueItems).toHaveBeenCalledTimes(1);
  let next!: Promise<void>;
  await act(async () => { next = app.next(); await flush(); });
  expect(nativePlayer.playIndex).not.toHaveBeenCalled();
  await act(async () => { finishInsert(); await next; await flush(); });
  expect(nativePlayer.playIndex).toHaveBeenCalledWith(1);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
  expect(app.current?.providerId).toBe('1');
});

test('pause excludes a late neighbour native promotion without stopping or reloading current audio', async () => {
  const tracks = Array.from({ length: 4 }, (_, index) => song('qq', index));
  let finishProbe!: (value: any) => void;
  NativeModules.LiuliuStorage.probeBackgroundAudioUrl.mockImplementation(async (url: string) => url.endsWith('/1')
    ? new Promise(resolve => { finishProbe = resolve; })
    : { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000 });
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  const stops = jest.mocked(nativePlayer.stop).mock.calls.length;
  await act(async () => { await app.togglePlay(); finishProbe({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000 }); await flush(); });
  expect(nativePlayer.insertQueueItems).not.toHaveBeenCalled();
  expect(nativePlayer.stop).toHaveBeenCalledTimes(stops);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
  expect(app.current?.providerId).toBe('0');
});

test.each(['next', 'natural', 'queue-tap'] as const)('%s advances the two prepared neighbours by retaining C and preparing only D, then only E', async mode => {
  const tracks = Array.from({ length: 7 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  const probe = NativeModules.LiuliuStorage.probeBackgroundAudioUrl as jest.Mock;
  const urls = () => probe.mock.calls.map((call: any[]) => call[0]);
  expect(urls()).toEqual([1, 2, 3, 4, 5, 6].map(id => `https://audio.test/tx/${id}`));
  for (const index of [1, 2]) {
    await act(async () => {
      if (mode === 'next') await app.next();
      else if (mode === 'queue-tap') await app.playTrack(app.queue[index]!, app.queue, index);
      else { nativeState = { ...nativeState, mediaId: `qq:${index}`, index, position: 19, playing: true }; emit(nativeState); }
      await flush();
    });
    expect(urls()).toEqual([1, 2, 3, 4, 5, 6].map(id => `https://audio.test/tx/${id}`));
    expect(NativeModules.LiuliuStorage.probeAudioUrl).toHaveBeenCalledTimes(1);
    expect(jest.mocked(nativePlayer.insertQueueItems).mock.calls.flatMap(call => call[2].map(track => track.providerId)))
      .toEqual(Array.from({ length: index + 2 }, (_, id) => String(id + 1)));
    expect(nativePlayer.replaceQueueItem).not.toHaveBeenCalled();
    expect(nativePlayer.removePreparedQueueItem).not.toHaveBeenCalled();
    expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
  }
});

test('switching to ready B preempts unfinished C and resumes ordered validation without probing ready B again', async () => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  let finishC!: (value: any) => void;
  const probe = NativeModules.LiuliuStorage.probeBackgroundAudioUrl as jest.Mock;
  probe.mockImplementation(async (url: string) => url.endsWith('/2')
    ? new Promise(resolve => { finishC = resolve; })
    : { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(finishC).toBeDefined();
  await act(async () => { await app.next(); await flush(); });
  expect(app.current?.providerId).toBe('1');
  expect(probe.mock.calls.filter((call: any[]) => call[0].endsWith('/2'))).toHaveLength(2);
  await act(async () => { finishC({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 }); await flush(); });
  expect(probe.mock.calls.map((call: any[]) => call[0])).toEqual([1, 2, 2, 3, 4, 5].map(id => `https://audio.test/tx/${id}`));
  expect(NativeModules.LiuliuStorage.probeAudioUrl).toHaveBeenCalledTimes(1);
  expect(jest.mocked(nativePlayer.insertQueueItems).mock.calls.flatMap(call => call[2].map(track => track.providerId))).toEqual(['1', '2', '3']);
});

test.each(['open-list', 'close-list', 'open-player'] as const)('%s during an in-flight neighbour preserves preparation and leaves the sliding window full', async mode => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  if (mode === 'close-list') await act(async () => { app.setQueueListOpen(true); });
  let finishC!: (value: any) => void;
  const audio = { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 };
  const probe = NativeModules.LiuliuStorage.probeBackgroundAudioUrl as jest.Mock;
  probe.mockImplementation(async (url: string) => url.endsWith('/2')
    ? new Promise(resolve => { finishC = resolve; }) : audio);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { openPlayer: false, queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0', '1']);
  await act(async () => {
    if (mode === 'open-player') app.open('player');
    else app.setQueueListOpen(mode === 'open-list');
    await flush();
  });
  await act(async () => { finishC(audio); await flush(); });
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0', '1', '2']);
  await act(async () => { await app.next(); emit(nativeState); await flush(); });
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0', '1', '2', '3']);
  expect(probe.mock.calls.map((call: any[]) => call[0])).toEqual([1, 2, 3, 4, 5].map(id => `https://audio.test/tx/${id}`));
  expect(jest.mocked(nativePlayer.insertQueueItems).mock.calls.flatMap(call => call[2].map(track => track.providerId))).toEqual(['1', '2', '3']);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
  expect(nativePlayer.replaceQueueItem).not.toHaveBeenCalled();
  expect(nativePlayer.removePreparedQueueItem).not.toHaveBeenCalled();
});

test('natural Media3 transitions advance the prepared window and preserve current progress', async () => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  const stops = jest.mocked(nativePlayer.stop).mock.calls.length;
  await act(async () => { nativeState = { ...nativeState, mediaId: 'qq:1', index: 1, position: 37, playing: true }; emit(nativeState); await flush(); });
  expect(jest.mocked(nativePlayer.insertQueueItems).mock.calls.flatMap(call => call[2].map(track => track.providerId))).toEqual(['1', '2', '3']);
  expect(app.current?.providerId).toBe('1');
  expect(app.player.position).toBe(37);
  expect(nativePlayer.stop).toHaveBeenCalledTimes(stops);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
  expect(nativePlayer.playIndex).not.toHaveBeenCalled();
});

test('manual prepared next outside the player page retains the fast native path', async () => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false }, openPlayer: false }); await flush(); });
  expect(app.page).toBe('root');
  await act(async () => { await app.next(); await flush(); });
  expect(nativePlayer.playIndex).toHaveBeenCalledWith(1);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
  expect(app.current?.providerId).toBe('0');
  await act(async () => { emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe('1');
});

test('a partial native tail still advances into unresolved logical metadata after leaving player', async () => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  let finishThird!: (value: any) => void;
  NativeModules.LiuliuStorage.probeBackgroundAudioUrl.mockImplementation(async (url: string) => url.endsWith('/3')
    ? new Promise(resolve => { finishThird = resolve; })
    : { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false }, openPlayer: false }); await flush(); });
  await act(async () => { nativeState = { ...nativeState, mediaId: 'qq:2', index: 2, position: 240, playing: false, ended: true }; emit(nativeState); await flush(); });
  await act(async () => { finishThird({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 }); await flush(); });
  expect(app.current?.providerId).toBe('3');
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(2);
});

test('source changes cancel a late native promotion and preserve current audio', async () => {
  const tracks = Array.from({ length: 4 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  let finishProbe!: (value: any) => void;
  NativeModules.LiuliuStorage.probeBackgroundAudioUrl.mockImplementation(async (url: string) => url.endsWith('/1')
    ? new Promise(resolve => { finishProbe = resolve; })
    : { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000 });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  const stops = jest.mocked(nativePlayer.stop).mock.calls.length;
  await act(async () => { app.toggleSource('bound'); finishProbe({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000 }); await flush(); });
  expect(nativePlayer.insertQueueItems).not.toHaveBeenCalled();
  expect(nativePlayer.stop).toHaveBeenCalledTimes(stops);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
});

test('cache cleanup excludes a late native promotion', async () => {
  const tracks = Array.from({ length: 4 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  let finishProbe!: (value: any) => void;
  NativeModules.LiuliuStorage.probeBackgroundAudioUrl.mockImplementation(async (url: string) => url.endsWith('/1')
    ? new Promise(resolve => { finishProbe = resolve; })
    : { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000 });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  await act(async () => { clearRuntimeResolutionCache(); finishProbe({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000 }); await flush(); });
  expect(nativePlayer.insertQueueItems).not.toHaveBeenCalled();
});

test('source invalidation discards prepared future entries and preserves current position', async () => {
  const tracks = Array.from({ length: 5 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0', '1', '2']);
  await act(async () => { nativeState = { ...nativeState, position: 83 }; emit(nativeState); app.toggleSource('bound'); await flush(); });
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0']);
  expect(app.queue.map(track => track.providerId)).toEqual(['0', '1', '2', '3', '4']);
  expect(app.player.position).toBe(83);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
});

test('quality change cancels late old-quality preparation and never keeps old future native items', async () => {
  const tracks = Array.from({ length: 5 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  let finishProbe!: (value: any) => void;
  NativeModules.LiuliuStorage.probeBackgroundAudioUrl.mockImplementation(async (url: string) => url.endsWith('/1')
    ? new Promise(resolve => { finishProbe = resolve; })
    : { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000 });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  await act(async () => { await app.changeQuality('320k'); finishProbe({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000 }); await flush(); });
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0']);
  expect(nativePlayer.insertQueueItems).not.toHaveBeenCalled();
  expect(app.state!.settings.quality).toBe('320k');
});

test('removing a prepared neighbour retains logical order and fills the next-two contiguous window', async () => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  const stops = jest.mocked(nativePlayer.stop).mock.calls.length;
  await act(async () => { await app.removeQueueTrack(tracks[1]!.id); await flush(); });
  expect(app.queue.map(track => track.providerId)).toEqual(['0', '2', '3', '4', '5']);
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0', '2', '3']);
  expect(nativePlayer.stop).toHaveBeenCalledTimes(stops);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
});

test('prepared track actual fallback quality survives manual selection without source resolution', async () => {
  const tracks = Array.from({ length: 5 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { app.setSetting('quality', '320k'); });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(app.queue[1]?.metadata).toMatchObject({ _playbackPreference: '320k', _playbackQuality: '128k' });
  const resolves = NativeModules.LiuliuStorage.resolveSourceScript.mock.calls.length;
  const addresses = NativeModules.LiuliuStorage.resolveSourceScriptAddress.mock.calls.length;
  await act(async () => { await app.next(); await flush(); });
  expect(nativePlayer.playIndex).toHaveBeenCalledWith(1);
  expect(NativeModules.LiuliuStorage.resolveSourceScript).toHaveBeenCalledTimes(resolves);
  expect(NativeModules.LiuliuStorage.resolveSourceScriptAddress).toHaveBeenCalledTimes(addresses);
  expect(app.current?.metadata?._playbackQuality).toBe('128k');
});

test('shuffle preserves full logical selection instead of selecting only prepared neighbours', async () => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { app.setSetting('shuffle', true); });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0']);
  expect(app.queue[4]?.playUrl).toBe('https://audio.test/tx/4');
  jest.spyOn(Math, 'random').mockReturnValue(0.7);
  await act(async () => { nativeState = { ...nativeState, playing: false, ended: true, position: 240 }; emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe('4');
  expect(nativePlayer.insertQueueItems).not.toHaveBeenCalled();
});

test.each([1, -1] as const)('manual %s uses shuffle over the complete logical queue', async direction => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  await act(async () => { await app.setPlaybackMode('shuffle'); await flush(); });
  expect(app.state!.settings.shuffle).toBe(true);
  jest.spyOn(Math, 'random').mockReturnValue(0.7);
  await act(async () => { await (direction === 1 ? app.next() : app.previous()); await flush(); });
  expect(app.current?.providerId).toBe('4');
  expect(app.queue).toHaveLength(6);
});

test('manual next still leaves repeat-one and follows sequence after switching back', async () => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  await act(async () => { await app.setPlaybackMode('repeat-one'); await flush(); });
  await act(async () => { await app.next(); await flush(); });
  expect(app.current?.providerId).toBe('1');
  await act(async () => { await app.setPlaybackMode('sequence'); await app.next(); await flush(); });
  expect(app.current?.providerId).toBe('2');
});

test('switching to shuffle removes played and future prepared neighbours before native shuffle without changing progress', async () => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  await act(async () => { nativeState = { ...nativeState, mediaId: 'qq:1', index: 1, position: 72 }; emit(nativeState); await flush(); });
  const stops = jest.mocked(nativePlayer.stop).mock.calls.length;
  const shuffle = jest.spyOn(nativePlayer, 'setShuffle').mockImplementation(async enabled => {
    if (enabled) expect(nativeQueue.map(track => track.providerId)).toEqual(['1']);
  });
  await act(async () => { await app.setPlaybackMode('shuffle'); await flush(); });
  expect(shuffle).toHaveBeenCalledWith(true);
  expect(nativeQueue.map(track => track.providerId)).toEqual(['1']);
  expect(app.player.position).toBe(72);
  expect(app.queue).toHaveLength(6);
  expect(nativePlayer.stop).toHaveBeenCalledTimes(stops);
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
});

test('auto-next disabled retains the current ended-song boundary and performs no native neighbour insertion', async () => {
  const tracks = Array.from({ length: 5 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { app.setSetting('autoNext', false); });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  await act(async () => { nativeState = { ...nativeState, playing: false, ended: true, position: 240 }; emit(nativeState); await flush(); });
  expect(nativePlayer.insertQueueItems).not.toHaveBeenCalled();
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0']);
  expect(app.current?.providerId).toBe('0');
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
});

test('repeat-one keeps current native repeat behavior while allowing next-two preparation', async () => {
  const tracks = Array.from({ length: 5 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  const repeat = jest.spyOn(nativePlayer, 'setRepeatMode');
  await act(async () => { app.setSetting('repeat', 'one'); });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } }); await flush(); });
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0', '1', '2']);
  expect(repeat).toHaveBeenLastCalledWith('one');
  expect(nativePlayer.playIndex).not.toHaveBeenCalled();
  expect(app.current?.providerId).toBe('0');
});

test('a fully prepared finite queue outside player returns to logical shuffle after mode change', async () => {
  const tracks = Array.from({ length: 3 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false }, openPlayer: false }); await flush(); });
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0', '1', '2']);
  await act(async () => { await app.setPlaybackMode('shuffle'); await flush(); });
  jest.spyOn(Math, 'random').mockReturnValue(0.7);
  await act(async () => { nativeState = { ...nativeState, playing: false, ended: true, position: 240 }; emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe('2');
  expect(nativeQueue.map(track => track.providerId)).toEqual(['2']);
});

test.each(['cache', 'source', 'quality'] as const)('finite outside-player queue restores logical tail continuation after %s invalidation', async invalidation => {
  const tracks = Array.from({ length: 3 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  const repeat = jest.spyOn(nativePlayer, 'setRepeatMode');
  await act(async () => { app.setSetting('repeat', 'all'); });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false }, openPlayer: false }); await flush(); });
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0', '1', '2']);
  expect(repeat).toHaveBeenLastCalledWith('all');
  let completeWarm!: (value: any) => void;
  NativeModules.LiuliuStorage.probeBackgroundAudioUrl.mockImplementationOnce(() => new Promise(resolve => { completeWarm = resolve; }));
  await act(async () => {
    if (invalidation === 'cache') { clearRuntimeResolutionCache(); emit({ ...nativeState, position: 93 }); }
    else if (invalidation === 'source') { app.toggleSource('bound'); app.toggleSource('bound'); }
    else await app.changeQuality('320k');
    await flush();
  });
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0']);
  expect(app.queue.map(track => track.providerId)).toEqual(['0', '1', '2']);
  expect(repeat).toHaveBeenLastCalledWith('off');
  await act(async () => { nativeState = { ...nativeState, playing: false, ended: true, position: 240 }; emit(nativeState); await flush(); });
  if (completeWarm) await act(async () => { completeWarm({ durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 }); await flush(); });
  expect(app.current?.providerId).toBe('1');
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(2);
});

test('a natural transition during pending partial-repeat restoration never removes the new current item', async () => {
  const tracks = Array.from({ length: 3 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { app.setSetting('repeat', 'all'); });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false }, openPlayer: false }); await flush(); });
  let restoreRepeat!: () => void;
  jest.spyOn(nativePlayer, 'setRepeatMode').mockImplementationOnce(() => new Promise(resolve => { restoreRepeat = resolve; }));
  jest.mocked(nativePlayer.removePreparedQueueItem).mockImplementation(async (current, target, index) => {
    expect(`${nativeQueue[index]?.provider}:${nativeQueue[index]?.providerId}`).not.toBe(nativeState.mediaId);
    if (nativeState.mediaId !== current || `${nativeQueue[index]?.provider}:${nativeQueue[index]?.providerId}` !== target) return false;
    nativeQueue.splice(index, 1);
    return true;
  });
  await act(async () => { clearRuntimeResolutionCache(); emit({ ...nativeState, position: 239 }); await flush(); });
  await act(async () => {
    nativeState = { ...nativeState, mediaId: 'qq:1', index: 1, position: 1, playing: true };
    emit(nativeState); restoreRepeat(); await flush();
  });
  expect(nativeQueue.map(track => track.providerId)).toContain('1');
  expect(app.current?.providerId).toBe('1');
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
});

test('guarded removal rejects a natural transition after readiness was read and preserves the native mirror', async () => {
  const tracks = Array.from({ length: 3 }, (_, index) => song('qq', index));
  await probeManualSource(song('qq', 99), app.state!.sources[0]!);
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false }, openPlayer: false }); await flush(); });
  let guardRejected = false;
  jest.mocked(nativePlayer.removePreparedQueueItem).mockImplementationOnce(async (current, target, index) => {
    // The queued native operation observes a transition JS has not received yet.
    nativeState = { ...nativeState, mediaId: 'qq:2', index: 2, playing: true, position: 1 };
    guardRejected = nativeState.mediaId !== current || `${nativeQueue[index]?.provider}:${nativeQueue[index]?.providerId}` !== target || target === nativeState.mediaId;
    return false;
  });
  await act(async () => { clearRuntimeResolutionCache(); emit({ ...nativeState, position: 239 }); await flush(); });
  expect(guardRejected).toBe(true);
  expect(nativeQueue.map(track => track.providerId)).toEqual(['0', '1', '2']);
  expect(nativePlayer.removeQueueItem).not.toHaveBeenCalled();
  await act(async () => { emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe('2');
  await act(async () => { await app.previous(); emit(nativeState); await flush(); });
  expect(nativePlayer.playIndex).toHaveBeenCalledWith(1);
  expect(app.current?.providerId).toBe('1');
  expect(nativePlayer.loadQueue).toHaveBeenCalledTimes(1);
});
afterEach(async () => {
  await act(async () => view.unmount());
  clearResolvedSourceCache();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('PSA02 an old poll cannot restore the outgoing song after a new native selection; explicit previous still works', async () => {
  const tracks = Array.from({ length: 5 }, (_, index) => song('qq', index));
  await act(async () => {
    await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } });
    await flush();
  });
  const outgoing = { ...nativeState };
  let finishPoll!: (value: NativePlayerState) => void;
  jest.mocked(nativePlayer.getState).mockImplementationOnce(() => new Promise(resolve => { finishPoll = resolve; }));
  await act(async () => { await jest.advanceTimersByTimeAsync(800); });
  expect(finishPoll).toBeDefined();
  await act(async () => { await app.next(); emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe('1');
  await act(async () => { finishPoll(outgoing); await flush(); });
  expect(app.current?.providerId).toBe('1');
  await act(async () => { await app.previous(); emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe('0');
});

test.each(['natural', 'progress'] as const)('PSA02 a late poll cannot overwrite a newer %s native event in the same queue generation', async kind => {
  const tracks = Array.from({ length: 5 }, (_, index) => song('qq', index));
  await act(async () => {
    await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } });
    await flush();
  });
  const outgoing = { ...nativeState };
  let finishPoll!: (value: NativePlayerState) => void;
  jest.mocked(nativePlayer.getState).mockImplementationOnce(() => new Promise(resolve => { finishPoll = resolve; }));
  await act(async () => { await jest.advanceTimersByTimeAsync(800); });
  await act(async () => {
    nativeState = { ...nativeState, position: 80, ...(kind === 'natural' ? { index: 1, mediaId: 'qq:1' } : {}) };
    emit(nativeState);
    await flush();
  });
  const identity = app.current?.providerId;
  expect(app.player.position).toBe(80);
  await act(async () => { finishPoll(outgoing); await flush(); });
  expect(app.current?.providerId).toBe(identity);
  expect(app.player.position).toBe(80);
});

test('PSA02 an older poll cannot rewind a newer poll when their responses arrive in reverse order', async () => {
  const tracks = Array.from({ length: 5 }, (_, index) => song('qq', index));
  await act(async () => {
    await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } });
    await flush();
  });
  const outgoing = { ...nativeState };
  let finishPoll!: (value: NativePlayerState) => void;
  jest.mocked(nativePlayer.getState).mockImplementationOnce(() => new Promise(resolve => { finishPoll = resolve; }));
  await act(async () => { await jest.advanceTimersByTimeAsync(800); });
  jest.mocked(nativePlayer.getState).mockResolvedValueOnce({ ...nativeState, position: 80 });
  await act(async () => { await jest.advanceTimersByTimeAsync(800); await flush(); });
  expect(app.player.position).toBe(80);
  await act(async () => { finishPoll(outgoing); await flush(); });
  expect(app.player.position).toBe(80);
});



test('PSA02 a successful playlist cache survives elapsed time and a prepared next/previous round trip without requests or probes', async () => {
  const tracks = Array.from({ length: 5 }, (_, i) => song('qq', i));
  await act(async () => {
    await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } });
    await flush();
  });
  const native = NativeModules.LiuliuStorage;
  const requests = native.resolveSourceScriptAddress.mock.calls.length;
  const foreground = native.probeAudioUrl.mock.calls.length;
  const background = native.probeBackgroundAudioUrl.mock.calls.length;
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60 * 1000);
  await act(async () => { await app.next(); emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe('1');
  await act(async () => { await app.previous(); emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe('0');
  expect(native.resolveSourceScriptAddress).toHaveBeenCalledTimes(requests);
  expect(native.probeAudioUrl).toHaveBeenCalledTimes(foreground);
  expect(native.probeBackgroundAudioUrl).toHaveBeenCalledTimes(background);
  now.mockRestore();
});

test('PSA02 selecting an already validated item outside the prepared native window reuses its success without another audio probe', async () => {
  const tracks = Array.from({ length: 5 }, (_, i) => song('qq', i));
  await act(async () => {
    await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } });
    await flush();
  });
  const native = NativeModules.LiuliuStorage;
  const requests = native.resolveSourceScriptAddress.mock.calls.length;
  const foreground = native.probeAudioUrl.mock.calls.length;
  const background = native.probeBackgroundAudioUrl.mock.calls.length;
  expect(app.queue[4]!.metadata?._prewarmedAudio).toBeTruthy();
  await act(async () => {
    await app.playTrack(app.queue[4]!, app.queue, 4, { openPlayer: false });
    await flush();
  });
  expect(app.current?.providerId).toBe('4');
  expect(native.resolveSourceScriptAddress).toHaveBeenCalledTimes(requests);
  expect(native.probeBackgroundAudioUrl).toHaveBeenCalledTimes(background);
  expect(native.probeAudioUrl).toHaveBeenCalledTimes(foreground);
});

test.each(['paused', 'playing', 'error'] as const)('PSA03 prepared navigation ignores an outgoing %s native event while target actual-playing is pending', async kind => {
  const tracks = Array.from({ length: 5 }, (_, i) => song('qq', i));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0); await flush(); });
  const outgoing = { ...nativeState };
  let finish!: () => void;
  jest.mocked(nativePlayer.waitForPlaybackStart).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  let navigation!: Promise<void>;
  await act(async () => { navigation = app.next(); await flush(); });
  expect(finish).toBeDefined();
  expect(app.current?.providerId).toBe('1');
  await act(async () => { emit({ ...outgoing, playing: kind === 'playing', ...(kind === 'error' ? { error: 'old song failed' } : {}) }); await flush(); });
  expect(app.current?.providerId).toBe('1');
  await act(async () => { finish(); await navigation; emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe('1');
});

test('PSA03 reversing a pending prepared next never issues a fallback skip from the cancelled request', async () => {
  const tracks = Array.from({ length: 5 }, (_, i) => song('qq', i));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0); await flush(); });
  jest.mocked(nativePlayer.waitForPlaybackStart).mockImplementationOnce(() => new Promise<void>(() => undefined));
  let next!: Promise<void>;
  await act(async () => { next = app.next(); await flush(); });
  expect(nativePlayer.playIndex).toHaveBeenCalledWith(1);
  await act(async () => { await app.previous(); await next.catch(() => undefined); emit(nativeState); await flush(); });
  expect(jest.mocked(nativePlayer.playIndex).mock.calls.map(call => call[0])).toEqual([1, 0]);
  expect(app.current?.providerId).toBe('0');
});

test('PSA03 already prepared navigation does not wait on a redundant separate native stop', async () => {
  const tracks = Array.from({ length: 5 }, (_, i) => song('qq', i));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0); await flush(); });
  let releaseStop!: () => void;
  jest.mocked(nativePlayer.stop).mockImplementationOnce(() => new Promise<void>(resolve => { releaseStop = resolve; }));
  let navigation!: Promise<void>;
  await act(async () => { navigation = app.next(); await flush(); });
  const switched = jest.mocked(nativePlayer.playIndex).mock.calls.map(call => call[0]);
  await act(async () => { releaseStop?.(); await navigation; await flush(); });
  expect(switched).toEqual([1]);
});

test('PSA03 a delayed native acknowledgement from the superseded direction cannot install another playback gate', async () => {
  const tracks = Array.from({ length: 5 }, (_, i) => song('qq', i));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0); await flush(); });
  const playIndex = jest.mocked(nativePlayer.playIndex);
  const original = playIndex.getMockImplementation()!;
  let acknowledge!: () => void;
  playIndex.mockImplementationOnce(async (index, position) => {
    await original(index, position);
    await new Promise<void>(resolve => { acknowledge = resolve; });
  });
  jest.mocked(nativePlayer.waitForPlaybackStart).mockClear();
  let next!: Promise<void>;
  await act(async () => { next = app.next(); await flush(); });
  await act(async () => { await app.previous(); await flush(); });
  await act(async () => { acknowledge(); await next; emit(nativeState); await flush(); });
  expect(jest.mocked(nativePlayer.waitForPlaybackStart).mock.calls.map(call => call[1])).toEqual(['qq:0']);
  expect(app.current?.providerId).toBe('0');
});

test('PSA03 six rapid next/previous reversals never dispatch an unrequested third song', async () => {
  const tracks = Array.from({ length: 5 }, (_, i) => song('qq', i));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0); await flush(); });
  for (let i = 0; i < 6; i += 1) {
    jest.mocked(nativePlayer.waitForPlaybackStart).mockImplementationOnce(() => new Promise<void>(() => undefined));
    let next!: Promise<void>;
    await act(async () => { next = app.next(); await flush(); });
    await act(async () => { await app.previous(); await next.catch(() => undefined); emit(nativeState); await flush(); });
    expect(app.current?.providerId).toBe('0');
  }
  expect(jest.mocked(nativePlayer.playIndex).mock.calls.map(call => call[0])).toEqual(Array.from({length:6}, () => [1,0]).flat());
});

test('PSA03 a prepared target switches before an unrelated background probe acknowledges cancellation', async () => {
  const tracks = Array.from({ length: 5 }, (_, i) => song('qq', i));
  const native = NativeModules.LiuliuStorage;
  let entered = false;
  native.probeBackgroundAudioUrl.mockImplementation(async (url: string) => {
    if (url.endsWith('/3')) { entered = true; return new Promise(() => undefined); }
    return { durationSeconds: 240, mimeType: 'audio/mpeg', bitrate: 128000, sampleBytes: 4096 };
  });
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0); await flush(); });
  expect(entered).toBe(true);
  let acknowledge!: (value: boolean) => void;
  native.cancelBackgroundAudioProbe.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
  let navigation!: Promise<void>;
  await act(async () => { navigation = app.next(); await flush(); });
  const switched = jest.mocked(nativePlayer.playIndex).mock.calls.map(call => call[0]);
  await act(async () => { acknowledge(true); await navigation; emit(nativeState); await flush(); });
  expect(switched).toEqual([1]);
  expect(app.current?.providerId).toBe('1');
});

test.each([1, 2])('failed next removes %i unavailable songs and continues forward without replaying the outgoing song', async failures => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  const native = NativeModules.LiuliuStorage;
  let cancelProbe!: (error: Error) => void;
  native.probeBackgroundAudioUrl.mockImplementationOnce(() => new Promise((_resolve, reject) => { cancelProbe = reject; }));
  native.cancelBackgroundAudioProbe.mockImplementation(async () => { cancelProbe(new Error('cancelled')); return true; });
  await act(async () => {
    await app.playTrack(tracks[0]!, tracks, 0, { queueSource: { kind: 'list', hasMore: false } });
    await flush();
  });
  native.resolveSourceScript.mockImplementation(async (_script: string, platform: string, json: string) => {
    const id = JSON.parse(json).songmid;
    if (Number(id) > 0 && Number(id) <= failures) throw new Error('no available source');
    return { url: `https://audio.test/${platform}/${id}`, backend: `${platform}-route` };
  });
  await act(async () => {
    const navigation = app.next();
    await flush();
    cancelProbe(new Error('no available source'));
    await navigation;
    emit(nativeState);
    await flush();
  });
  expect(app.current?.providerId).toBe(String(failures + 1));
  expect(app.queue.map(track => track.providerId)).toEqual(['0', ...Array.from({ length: 5 - failures }, (_, i) => String(i + failures + 1))]);
  await act(async () => { await app.next(); emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe(String(failures + 2));
});

test.each([1, 2])('a prepared next failure removes %i songs and advances by identity', async failures => {
  const tracks = Array.from({ length: 6 }, (_, index) => song('qq', index));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0); await flush(); });
  for (let index = 0; index < failures; index += 1)
    jest.mocked(nativePlayer.waitForPlaybackStart).mockRejectedValueOnce(new Error('unavailable prepared audio'));
  await act(async () => { await app.next(); emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe(String(failures + 1));
  expect(app.queue.map(track => track.providerId)).toEqual(['0', ...Array.from({ length: 5 - failures }, (_, index) => String(index + failures + 1))]);
  await act(async () => { await app.next(); emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe(String(failures + 2));
});

test('failure at the queue end releases the failed display gate and permits replaying the remaining valid song', async () => {
  const tracks = Array.from({ length: 2 }, (_, index) => song('qq', index));
  await act(async () => { await app.playTrack(tracks[0]!, tracks, 0); await flush(); });
  const outgoing = { ...nativeState };
  jest.mocked(nativePlayer.waitForPlaybackStart).mockRejectedValueOnce(new Error('unavailable prepared audio'));
  await act(async () => { await app.next(); await flush(); });
  expect(app.queue.map(track => track.providerId)).toEqual(['0']);
  expect(app.player.playing).toBe(false);
  await act(async () => {
    await app.togglePlay();
    emit({ ...outgoing, playing: true });
    await flush();
  });
  expect(app.current?.providerId).toBe('0');
  expect(app.player.mediaId).toBe('qq:0');
  expect(app.player.playing).toBe(true);
});

test('PSA03 a failed prepared scene stop acknowledgement cannot overwrite a newer reverse navigation cursor', async () => {
  const tracks = Array.from({ length: 5 }, (_, i) => song('qq', i));
  await act(async () => {
    await app.playTrack(tracks[0]!, tracks, 0, { queueSource: {
      kind: 'home-menu', hasMore: false, cursor: {
        choiceId: 'scene-focus', profile: {
          artists: {}, genres: {}, languages: {}, moods: {}, timeSlots: {},
          longTermTrackIds: [], shortTermTrackIds: [], sessionTrackIds: [],
        }, history: [], seenSongs: [], providers: [],
      },
    } });
    await flush();
  });
  let acknowledgeStop!: () => void;
  jest.mocked(nativePlayer.stop).mockImplementationOnce(() => new Promise<void>(resolve => { acknowledgeStop = resolve; }));
  jest.mocked(nativePlayer.waitForPlaybackStart).mockRejectedValueOnce(new Error('prepared scene failed to start'));
  let failedNext!: Promise<void>;
  await act(async () => { failedNext = app.next(); await flush(); });
  expect(acknowledgeStop).toBeDefined();
  expect(jest.mocked(nativePlayer.playIndex).mock.calls.map(call => call[0])).toEqual([1]);
  jest.mocked(nativePlayer.waitForPlaybackStart).mockImplementationOnce(() => new Promise<void>(() => undefined));
  let reverse!: Promise<void>;
  await act(async () => { reverse = app.previous(); await flush(); });
  expect(app.current?.providerId).toBe('0');
  expect(jest.mocked(nativePlayer.playIndex).mock.calls.map(call => call[0])).toEqual([1, 0]);
  await act(async () => { acknowledgeStop(); await failedNext; await flush(); });
  await act(async () => { await app.next(); await reverse.catch(() => undefined); emit(nativeState); await flush(); });
  expect(app.current?.providerId).toBe('1');
  expect(jest.mocked(nativePlayer.playIndex).mock.calls.map(call => call[0])).toEqual([1, 0, 1]);
});
