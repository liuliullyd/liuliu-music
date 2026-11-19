import { NativeModules } from 'react-native';
import type { SourceSetting, Track } from '../src/domain/types';
import {
  clearResolvedSourceCache,
  probeManualSource,
  resolveWithImportedSource,
  resolveWithImportedSourceAddress,
  resolveWithImportedSourcePrewarm,
  hasValidatedPlaybackPrewarm,
  requirePlaybackPrewarmRevalidation,
} from '../src/services/sourceRuntime';
import { isRuntimeTrackBlocked } from '../src/services/trackPlaybackPolicy';
import { UrlPrewarmScheduler } from '../src/services/urlPrewarmScheduler';


const platforms = { netease: 'wy', qq: 'tx', kugou: 'kg', kuwo: 'kw', migu: 'mg' } as const;
type Provider = keyof typeof platforms;

const modes = ['playback', 'prewarm'] as const;
type Mode = typeof modes[number];
const source: SourceSetting = {
  id: 'route-isolation-fixture', name: '用户导入源', enabled: true, healthy: true,
  script: 'synthetic-source', capabilities: Object.values(platforms),
};
const song = (provider: Provider, id: string, qualities = ['128k']): Track => ({
  id, provider, providerId: id, title: id, artist: '歌手', album: '专辑', duration: 180,
  coverKey: 'train', language: '华语', genre: '流行', mood: '轻松', releaseYear: 2026,
  metadata: { _types: Object.fromEntries(qualities.map(quality => [quality, {}])) },
});
const endpoint = (platform: string, backend = 'launch-fixed') => ({
  backend, url: `https://resolver.test/${platform}/${backend}`,
  requestRoute: `GET:https://resolver.test/${platform}/${backend}`,
});
const response = (platform: string, id: string, backend = 'launch-fixed', quality = '128k') => ({
  url: `https://audio.test/${platform}/${id}/${quality}`, quality, backend,
  backendUrls: [endpoint(platform, backend)],
});
function bridge() {
  const resolve = jest.fn(async (_script: string, platform: string, json: string, quality: string) =>
    response(platform, JSON.parse(json).songmid, JSON.parse(json).__lxPinnedBackend ?? 'launch-fixed', quality));
  const probe = jest.fn(async (url: string) => ({
    durationSeconds: 180, resolvedUrl: url, sampleBytes: 4096,
    mimeType: 'audio/mpeg', bitrate: url.endsWith('/320k') ? 320000 : 128000,
  }));
  const health = jest.fn(async (_script: string, platform: string) => response(platform, 'health'));
  const prefix = jest.fn(async () => ({ sampleBytes: 4096 }));
  NativeModules.LiuliuStorage = {
    resolveSourceScript: resolve, resolveSourceScriptAddress: resolve,
    cancelSourceScriptAddress: jest.fn(async () => true),
    probeAudioUrl: probe, probeAudioUrlCancellable: probe, cancelAudioProbe: jest.fn(async () => true), probeBackgroundAudioUrl: probe,
    cancelBackgroundAudioProbe: jest.fn(async () => true),
    resolveSourceScriptForHealth: health, probeAudioPrefix: prefix,
  };
  return { resolve, probe, health, prefix };
}
const run = (mode: Mode, track: Track, quality: '128k' | '320k' = '128k') => mode === 'playback'
  ? resolveWithImportedSource(track, [source], quality)
  : resolveWithImportedSourcePrewarm(track, [source], quality);

beforeEach(clearResolvedSourceCache);
afterEach(() => { clearResolvedSourceCache(); jest.restoreAllMocks(); });


const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };

test('superseding foreground playback cancels its interfaces without trying lower qualities', async () => {
  const native = bridge();
  const pending = deferred<ReturnType<typeof response>>();
  native.resolve.mockReturnValue(pending.promise);
  const abort = new AbortController();
  const track = song('qq', 'superseded', ['flac', '320k', '128k']);
  const result = resolveWithImportedSource(track, [source], 'flac', false, undefined, false, true, abort.signal)
    .catch(error => error);
  await flush();
  const attempts = native.resolve.mock.calls.length;
  expect(attempts).toBeGreaterThan(0);
  abort.abort();
  await expect(result).resolves.toMatchObject({ name: 'AbortError' });
  expect(NativeModules.LiuliuStorage.cancelSourceScriptAddress).toHaveBeenCalledTimes(attempts);
  expect(native.resolve).toHaveBeenCalledTimes(attempts);
  expect(native.probe).not.toHaveBeenCalled();
  expect(isRuntimeTrackBlocked(track)).toBe(false);
  pending.resolve(response('tx', 'late'));
  await flush();
  expect(hasValidatedPlaybackPrewarm(track, [source], 'flac')).toBe(false);
});

test('an immediate new selection of the same song replaces an aborted foreground flight', async () => {
  const native = bridge();
  const pending = deferred<ReturnType<typeof response>>();
  native.resolve.mockReturnValue(pending.promise);
  const track = song('qq', 'select-again');
  const abort = new AbortController();
  const old = resolveWithImportedSource(track, [source], '128k', false, undefined, false, true, abort.signal)
    .catch(error => error);
  await flush();
  abort.abort();
  native.resolve.mockImplementation(async (_script, platform, json, quality) =>
    response(platform, JSON.parse(json).songmid, 'new-winner', quality));
  const selected = resolveWithImportedSource(track, [source], '128k', false, undefined, false, true, new AbortController().signal);
  await expect(selected).resolves.toMatchObject({ backend: 'new-winner' });
  await expect(old).resolves.toMatchObject({ name: 'AbortError' });
  pending.resolve(response('tx', 'late', 'old-winner'));
  await flush();
  await expect(resolveWithImportedSource(track, [source], '128k', false, undefined, true))
    .resolves.toMatchObject({ backend: 'new-winner' });
});

test('cancelling foreground audio validation preserves existing valid evidence', async () => {
  const native = bridge();
  const track = song('qq', 'cached-cancel');
  await resolveWithImportedSource(track, [source], '128k');
  const pending = deferred<Awaited<ReturnType<typeof native.probe>>>();
  native.probe.mockReturnValue(pending.promise);
  const abort = new AbortController();
  const selected = resolveWithImportedSource(track, [source], '128k', false, undefined, false, true, abort.signal)
    .catch(error => error);
  await flush();
  abort.abort();
  await expect(selected).resolves.toMatchObject({ name: 'AbortError' });
  expect(NativeModules.LiuliuStorage.cancelAudioProbe).toHaveBeenCalledTimes(1);
  expect(hasValidatedPlaybackPrewarm(track, [source], '128k')).toBe(true);
  expect(isRuntimeTrackBlocked(track)).toBe(false);
  pending.resolve({ durationSeconds: 0, resolvedUrl: 'https://audio.test/late-invalid.mp3', sampleBytes: 0, mimeType: 'audio/mpeg', bitrate: 128000 });
  await flush();
  expect(hasValidatedPlaybackPrewarm(track, [source], '128k')).toBe(true);
});
async function registerThree(native: ReturnType<typeof bridge>) {
  for (const backend of ['launch-fixed', 'second-fixed', 'third-fixed', 'launch-fixed']) {
    native.health.mockResolvedValueOnce(response('tx', 'health', backend));
    await probeManualSource(song('qq', 'health-' + backend), source);
  }
}
function failPreferred(native: ReturnType<typeof bridge>) {
  native.resolve.mockImplementation(async (_script, platform, json, quality) => {
    const info = JSON.parse(json);
    if (info.__lxPinnedBackend === 'launch-fixed') throw new Error('HTTP 503');
    return response(platform, info.songmid, info.__lxPinnedBackend, quality);
  });
}

describe.each(modes)('%s prefers the last successful interface', mode => {
  test('reuses the winner for the next song without starting alternatives', async () => {
    const native = bridge(); await registerThree(native);
    failPreferred(native);
    await expect(run(mode, song('qq', 'first'))).resolves.toMatchObject({ backend: 'second-fixed' });
    expect(native.resolve).toHaveBeenCalledTimes(3);
    native.resolve.mockClear();
    await expect(run(mode, song('qq', 'next'))).resolves.toMatchObject({ backend: 'second-fixed' });
    expect(native.resolve).toHaveBeenCalledTimes(1);
    expect(JSON.parse(native.resolve.mock.calls[0][2]).__lxPinnedBackendRoutes)
      .toEqual([endpoint('tx', 'second-fixed').requestRoute]);
  });
  test('races the remaining interfaces after the preferred one fails and cancels the slower resolver', async () => {
    const native = bridge(); await registerThree(native);
    const slow = deferred<ReturnType<typeof response>>();
    native.resolve.mockImplementation((_script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (info.__lxPinnedBackend === 'launch-fixed') return Promise.reject(new Error('HTTP 503'));
      if (info.__lxPinnedBackend === 'second-fixed') return slow.promise;
      return Promise.resolve(response(platform, info.songmid, 'third-fixed', quality));
    });
    const result = run(mode, song('qq', 'race'));
    await flush();
    expect(native.resolve).toHaveBeenCalledTimes(3);
    await expect(result).resolves.toMatchObject({ backend: 'third-fixed', audio: { sampleBytes: 4096 } });
    expect(NativeModules.LiuliuStorage.cancelSourceScriptAddress).toHaveBeenCalledTimes(1);
    slow.resolve(response('tx', 'late', 'second-fixed')); await flush();
    await expect(resolveWithImportedSource(song('qq', 'race'), [source], '128k', false, undefined, true))
      .resolves.toMatchObject({ backend: 'third-fixed' });
  });
  test('bad audio from one fallback leaves the pending winner eligible', async () => {
    const native = bridge(); await registerThree(native); failPreferred(native);
    native.probe.mockImplementation(async url => {
      if (url.includes('/bad/')) throw Object.assign(new Error('no audio'), { code: 'AUDIO_NO_TRACK' });
      await flush();
      return { durationSeconds: 180, resolvedUrl: url, sampleBytes: 4096, mimeType: 'audio/mpeg', bitrate: 128000 };
    });
    native.resolve.mockImplementation(async (_script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (info.__lxPinnedBackend === 'launch-fixed') throw new Error('HTTP 503');
      return response(platform, info.__lxPinnedBackend === 'second-fixed' ? 'bad' : 'good', info.__lxPinnedBackend, quality);
    });
    const track = song('qq', 'audio-race');
    await expect(run(mode, track)).resolves.toMatchObject({ backend: 'third-fixed' });
    expect(isRuntimeTrackBlocked(track)).toBe(false);
  });
  test('cancels a losing audio probe and ignores its late invalid evidence', async () => {
    const native = bridge(); await registerThree(native); failPreferred(native);
    const slow = deferred<Awaited<ReturnType<typeof native.probe>>>();
    native.probe.mockImplementation(url => url.includes('/slow/') ? slow.promise :
      Promise.resolve({ durationSeconds: 180, resolvedUrl: url, sampleBytes: 4096, mimeType: 'audio/mpeg', bitrate: 128000 }));
    native.resolve.mockImplementation(async (_script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (info.__lxPinnedBackend === 'launch-fixed') throw new Error('HTTP 503');
      return response(platform, info.__lxPinnedBackend === 'second-fixed' ? 'slow' : 'winner', info.__lxPinnedBackend, quality);
    });
    const track = song('qq', 'audio-cancel');
    await expect(run(mode, track)).resolves.toMatchObject({ backend: 'third-fixed' });
    const cancel = mode === 'playback' ? NativeModules.LiuliuStorage.cancelAudioProbe :
      NativeModules.LiuliuStorage.cancelBackgroundAudioProbe;
    expect(cancel).toHaveBeenCalledTimes(1);
    slow.resolve({ durationSeconds: 0, resolvedUrl: 'https://audio.test/invalid', sampleBytes: 0, mimeType: 'audio/mpeg', bitrate: 128000 });
    await flush();
    expect(isRuntimeTrackBlocked(track)).toBe(false);
    await expect(resolveWithImportedSource(track, [source], '128k', false, undefined, true))
      .resolves.toMatchObject({ backend: 'third-fixed' });
  });
  test('tries the next allowed quality after all interfaces reject the first tier', async () => {
    const native = bridge(); await registerThree(native);
    native.probe.mockImplementation(async url => {
      if (url.endsWith('/320k')) throw Object.assign(new Error('no audio'), { code: 'AUDIO_NO_TRACK' });
      return { durationSeconds: 180, resolvedUrl: url, sampleBytes: 4096, mimeType: 'audio/mpeg', bitrate: 128000 };
    });
    const track = song('qq', 'quality-fallback', ['320k', '128k']);
    await expect(run(mode, track, '320k')).resolves.toMatchObject({ requestedQuality: '128k', quality: '128k' });
    expect(native.resolve.mock.calls.map(call => call[3])).toEqual(['320k', '320k', '320k', '128k']);
    expect(isRuntimeTrackBlocked(track)).toBe(false);
  });
  test('records terminal audio failure once all allowed qualities have failed', async () => {
    const native = bridge(); await registerThree(native);
    native.probe.mockRejectedValue(Object.assign(new Error('no audio'), { code: 'AUDIO_NO_TRACK' }));
    const track = song('qq', 'quality-failure', ['320k', '128k']);
    await expect(run(mode, track, '320k')).rejects.toThrow('音频轨道');
    expect(native.resolve.mock.calls.map(call => call[3])).toEqual(['320k', '320k', '320k', '128k', '128k', '128k']);
    expect(isRuntimeTrackBlocked(track)).toBe(true);
    expect(hasValidatedPlaybackPrewarm(track, [source], '320k')).toBe(false);
  });
  test('configuration reset cancels both fallback branches and rejects their late results', async () => {
    const native = bridge(); await registerThree(native);
    const slow = deferred<ReturnType<typeof response>>();
    native.resolve.mockImplementation((_script, _platform, json) =>
      JSON.parse(json).__lxPinnedBackend === 'launch-fixed' ? Promise.reject(new Error('HTTP 503')) : slow.promise);
    const track = song('qq', 'reset');
    const result = run(mode, track);
    const observed = result.catch(error => error);
    await flush();
    expect(native.resolve).toHaveBeenCalledTimes(3);
    clearResolvedSourceCache();
    await expect(observed).resolves.toBeInstanceOf(Error);
    expect(NativeModules.LiuliuStorage.cancelSourceScriptAddress).toHaveBeenCalledTimes(2);
    slow.resolve(response('tx', 'late')); await flush();
    expect(native.probe).not.toHaveBeenCalled();
    expect(hasValidatedPlaybackPrewarm(track, [source], '128k')).toBe(false);
  });
});

test('prewarm cancellation waits for both native acknowledgements before releasing its slot', async () => {
  const native = bridge(); await registerThree(native);
  const slow = deferred<ReturnType<typeof response>>();
  native.resolve.mockImplementation((_script, _platform, json) =>
    JSON.parse(json).__lxPinnedBackend === 'launch-fixed' ? Promise.reject(new Error('HTTP 503')) : slow.promise);
  const firstAck = deferred<boolean>(), secondAck = deferred<boolean>();
  NativeModules.LiuliuStorage.cancelSourceScriptAddress.mockReturnValueOnce(firstAck.promise).mockReturnValueOnce(secondAck.promise);
  const controller = new AbortController(), track = song('qq', 'cancel');
  const result = resolveWithImportedSourcePrewarm(track, [source], '128k', controller.signal);
  let finished = false;
  const observed = result.catch(error => { finished = true; return error; });
  await flush(); controller.abort(); await flush();
  expect(finished).toBe(false);
  firstAck.resolve(true); await flush(); expect(finished).toBe(false);
  secondAck.resolve(true);
  await expect(observed).resolves.toMatchObject({ name: 'AbortError' });
  expect(hasValidatedPlaybackPrewarm(track, [source], '128k')).toBe(false);
  slow.resolve(response('tx', 'late')); await flush();
});

test('interruption revalidation refreshes the whole queue and reuses the new winning interface beyond the next two', async () => {
  const native = bridge(); await registerThree(native);
  const tracks = Array.from({ length: 7 }, (_, index) => song('qq', 'queue-' + index));
  const scheduler = new UrlPrewarmScheduler(2, 2);
  scheduler.setQueueOrder(tracks.map(track => track.id));
  let resumed = false;
  native.resolve.mockImplementation(async (_script, platform, json, quality) => {
    const info = JSON.parse(json);
    if (resumed && info.__lxPinnedBackend === 'launch-fixed') throw new Error('HTTP 503');
    return { ...response(platform, info.songmid, info.__lxPinnedBackend, quality),
      url: 'https://audio.test/' + (resumed ? 'fresh' : 'expired') + '/' + info.songmid + '/' + quality };
  });
  const enqueue = () => tracks.forEach(track => scheduler.enqueue('queue', track.id,
    async signal => { await resolveWithImportedSourcePrewarm(track, [source], '128k', signal); }));
  enqueue(); await scheduler.whenIdle();
  expect(native.resolve).toHaveBeenCalledTimes(7);
  resumed = true;
  tracks.forEach(track => requirePlaybackPrewarmRevalidation(track, [source], '128k'));
  native.resolve.mockClear(); native.probe.mockClear();
  native.probe.mockImplementation(async url => {
    if (url.includes('/expired/')) throw new Error('HTTP 403');
    return { durationSeconds: 180, resolvedUrl: url, sampleBytes: 4096, mimeType: 'audio/mpeg', bitrate: 128000 };
  });
  enqueue(); await scheduler.whenIdle();
  const calls = native.resolve.mock.calls.map(call => JSON.parse(call[2]));
  expect(calls.map(info => info.songmid)).toEqual(['queue-0', 'queue-0', 'queue-0', ...tracks.slice(1).map(track => track.id)]);
  expect(calls.slice(3).every(info => info.__lxPinnedBackend === 'second-fixed')).toBe(true);
  for (const track of tracks) {
    expect(hasValidatedPlaybackPrewarm(track, [source], '128k')).toBe(true);
    await expect(resolveWithImportedSource(track, [source], '128k', false, undefined, true))
      .resolves.toMatchObject({ backend: 'second-fixed', url: expect.stringContaining('/fresh/') });
  }
  expect(native.probe).toHaveBeenCalledTimes(15);
});

test.each([false, true])('a validated cached song advances the preferred interface after revalidation=%s', async revalidate => {
  const native = bridge(); await registerThree(native);
  const cached = song('qq', 'cached-route');
  await resolveWithImportedSourcePrewarm(cached, [source], '128k');
  failPreferred(native);
  await resolveWithImportedSourcePrewarm(song('qq', 'changed-route'), [source], '128k');
  if (revalidate) requirePlaybackPrewarmRevalidation(cached, [source], '128k');
  native.resolve.mockClear();
  await expect(resolveWithImportedSourcePrewarm(cached, [source], '128k'))
    .resolves.toMatchObject({ backend: 'launch-fixed' });
  expect(native.resolve).not.toHaveBeenCalled();
  native.resolve.mockImplementation(async (_script, platform, json, quality) => {
    const info = JSON.parse(json);
    return response(platform, info.songmid, info.__lxPinnedBackend, quality);
  });
  await resolveWithImportedSourcePrewarm(song('qq', 'after-cached-route'), [source], '128k');
  expect(native.resolve).toHaveBeenCalledTimes(1);
  expect(JSON.parse(native.resolve.mock.calls[0][2]).__lxPinnedBackend).toBe('launch-fixed');
});


describe('startup interface concurrency', () => {
  const address = (track: Track, sources = [source], signal?: AbortSignal) =>
    resolveWithImportedSourceAddress(track, sources, '128k', signal, true);
  const discovered = ['slow', 'fast'].map(backend => endpoint('tx', backend));
  test('does not start stale health bindings alongside a token-dependent handler', async () => {
    const native = bridge();
    await registerThree(native);
    native.resolve.mockImplementation(async (_script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (info.__lxDiscoverBackendRoutes) return { url: '', discoveredRoutes: [endpoint(platform, 'token')] } as never;
      return response(platform, info.songmid, 'signed-audio', quality);
    });
    await expect(address(song('qq', 'single-token-chain'))).resolves.toMatchObject({ backend: 'signed-audio' });
    const workers = native.resolve.mock.calls.filter(call => !JSON.parse(call[2]).__lxDiscoverBackendRoutes);
    expect(workers).toHaveLength(1);
    expect(JSON.parse(workers[0]![2]).__lxPinnedBackend).toBeUndefined();
  });
  test('a shared prerequisite under different backend labels is one dependent chain', async () => {
    const native = bridge();
    native.resolve.mockImplementation(async (_script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (info.__lxDiscoverBackendRoutes) return { url: '', discoveredRoutes: ['first', 'second', 'third'].map(backend => ({
        ...endpoint(platform, backend), requestRoute: 'GET:https://resolver.test/token',
      })) } as never;
      if (info.__lxPinnedBackendRoutes) throw new Error('audio request filtered after token');
      return response(platform, info.songmid, 'signed-audio', quality);
    });
    await expect(address(song('qq', 'common-token'))).resolves.toMatchObject({ backend: 'signed-audio' });
    expect(native.resolve).toHaveBeenCalledTimes(2);
  });
  test('moves to the next source after all enumerated interfaces fail without waiting for a duplicate serial handler', async () => {
    const native = bridge();
    const second = { ...source, id: 'next-passing-source', script: 'next-passing-script' };
    native.resolve.mockImplementation((script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (script === second.script) return Promise.resolve(response(platform, info.songmid, 'next-winner', quality));
      if (info.__lxDiscoverBackendRoutes) return Promise.resolve({ url: '', discoveredRoutes: discovered } as never);
      if (info.__lxPinnedBackend) return Promise.reject(new Error('HTTP 503'));
      return new Promise(() => {});
    });
    const result = address(song('qq', 'no-serial-wait'), [source, second]);
    result.catch(() => {});
    await flush();
    expect(native.resolve.mock.calls.some(call => call[0] === second.script)).toBe(true);
    await expect(result).resolves.toMatchObject({ sourceId: second.id });
    expect(native.resolve.mock.calls.some(call => call[0] === source.script &&
      !JSON.parse(call[2]).__lxDiscoverBackendRoutes && !JSON.parse(call[2]).__lxPinnedBackend)).toBe(false);
  });
  test('starts the source interfaces together and proceeds on the first passing address without waiting for a slow branch', async () => {
    const native = bridge();
    const slow = deferred<ReturnType<typeof response>>();
    native.resolve.mockImplementation((_script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (info.__lxDiscoverBackendRoutes) return Promise.resolve({ url: '', discoveredRoutes: discovered } as never);
      if (info.__lxPinnedBackend === 'fast') return Promise.resolve(response(platform, info.songmid, 'fast', quality));
      return slow.promise;
    });
    const track = song('qq', 'startup-fast');
    await expect(address(track)).resolves.toMatchObject({ backend: 'fast' });
    expect(native.resolve.mock.calls.filter(call => JSON.parse(call[2]).__lxPinnedBackend)
      .map(call => JSON.parse(call[2]).__lxPinnedBackend)).toEqual(['slow', 'fast']);
    expect(NativeModules.LiuliuStorage.cancelSourceScriptAddress).toHaveBeenCalledTimes(1);
    slow.resolve(response('tx', track.id, 'slow')); await flush();
    const count = native.resolve.mock.calls.length;
    await expect(address(track)).resolves.toMatchObject({ backend: 'fast' });
    expect(native.resolve).toHaveBeenCalledTimes(count);
    expect(native.probe).not.toHaveBeenCalled();
  });
  test('does not enter the next source until every interface in the first source has failed', async () => {
    const native = bridge();
    const pending = deferred<ReturnType<typeof response>>();
    const second = { ...source, id: 'second-source', script: 'second-script' };
    native.resolve.mockImplementation((script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (script === second.script) return Promise.resolve(response(platform, info.songmid, 'second-winner', quality));
      if (info.__lxDiscoverBackendRoutes) return Promise.resolve({ url: '', discoveredRoutes: discovered } as never);
      if (info.__lxPinnedBackend === 'slow') return pending.promise;
      return Promise.reject(new Error('HTTP 503 first source'));
    });
    const result = address(song('qq', 'startup-fallback'), [source, second]);
    await flush();
    expect(native.resolve.mock.calls.some(call => call[0] === second.script)).toBe(false);
    // A resolved URL is deliberately invalid, so this is a real terminal failure.
    pending.resolve({ ...response('tx', 'failure'), url: '' });
    await expect(result).resolves.toMatchObject({ sourceId: second.id, backend: 'second-winner' });
  });
  test('retains the original token-dependent handler when discovery cannot enumerate independent interfaces', async () => {
    const native = bridge();
    native.resolve.mockImplementation(async (_script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (info.__lxDiscoverBackendRoutes) return { url: '', discoveredRoutes: [] } as never;
      return response(platform, info.songmid, 'token-path', quality);
    });
    await expect(address(song('qq', 'token-dependent'))).resolves.toMatchObject({ backend: 'token-path' });
  });
  test('keeps dependent token and audio requests within the same handler', async () => {
    const native = bridge();
    native.resolve.mockImplementation(async (_script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (info.__lxDiscoverBackendRoutes) return { url: '', discoveredRoutes: [endpoint(platform, 'token')] } as never;
      expect(info.__lxPinnedBackend).toBeUndefined();
      expect(info.__lxPinnedBackendRoutes).toBeUndefined();
      return response(platform, info.songmid, 'signed-audio', quality);
    });
    await expect(address(song('qq', 'token-then-audio'))).resolves.toMatchObject({ backend: 'signed-audio' });
    expect(native.resolve).toHaveBeenCalledTimes(2);
  });
  test('a health winner does not turn a discovered token prerequisite into a complete audio interface', async () => {
    const native = bridge();
    await registerThree(native);
    native.resolve.mockImplementation(async (_script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (info.__lxDiscoverBackendRoutes) return { url: '', discoveredRoutes: [endpoint(platform, 'token')] } as never;
      if (info.__lxPinnedBackendRoutes?.length) throw new Error('token or dependent audio request was filtered');
      return response(platform, info.songmid, 'signed-audio', quality);
    });
    await expect(address(song('qq', 'health-then-new-token'))).resolves.toMatchObject({ backend: 'signed-audio' });
  });
  test('a dependent handler failure still proceeds to the next passed source', async () => {
    const native = bridge();
    await registerThree(native);
    const second = { ...source, id: 'second-source', script: 'second-script' };
    native.resolve.mockImplementation(async (script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (script === second.script) return response(platform, info.songmid, 'second-winner', quality);
      if (info.__lxDiscoverBackendRoutes) return { url: '', discoveredRoutes: [endpoint(platform, 'token')] } as never;
      throw new Error('token service unavailable');
    });
    await expect(address(song('qq', 'dependency-failure'), [source, second])).resolves.toMatchObject({ sourceId: second.id });
    expect(native.resolve.mock.calls.filter(call => call[0] === source.script &&
      !JSON.parse(call[2]).__lxDiscoverBackendRoutes && !JSON.parse(call[2]).__lxPinnedBackend)).toHaveLength(1);
  });
  test('cancels all active workers and rejects late addresses without populating the cache', async () => {
    const native = bridge();
    const slow = deferred<ReturnType<typeof response>>();
    native.resolve.mockImplementation((_script, _platform, json) => JSON.parse(json).__lxDiscoverBackendRoutes
      ? Promise.resolve({ url: '', discoveredRoutes: discovered } as never) : slow.promise);
    const controller = new AbortController();
    const track = song('qq', 'startup-cancel');
    const result = address(track, [source], controller.signal).catch(error => error);
    await flush(); controller.abort();
    await expect(result).resolves.toMatchObject({ name: 'AbortError' });
    expect(NativeModules.LiuliuStorage.cancelSourceScriptAddress).toHaveBeenCalledTimes(2);
    slow.resolve(response('tx', 'late')); await flush();
    expect(hasValidatedPlaybackPrewarm(track, [source], '128k')).toBe(false);
    native.resolve.mockImplementation(async (_script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (info.__lxDiscoverBackendRoutes) return { url: '', discoveredRoutes: [] } as never;
      return response(platform, info.songmid, 'fresh', quality);
    });
    await expect(address(track)).resolves.toMatchObject({ backend: 'fresh' });
  });
});

describe('foreground selections use startup interface concurrency', () => {
  test('background preparation preserves rate limiting without exhausting the healthy interface pool', async () => {
    const native = bridge(); await registerThree(native);
    native.resolve.mockRejectedValue(Object.assign(new Error('token unavailable'), { code: 'SOURCE_RATE_LIMITED' }));
    await expect(resolveWithImportedSourcePrewarm(song('qq', 'background-limited'), [source], '128k'))
      .rejects.toMatchObject({ code: 'SOURCE_RATE_LIMITED' });
    expect(native.resolve).toHaveBeenCalledTimes(1);
    native.resolve.mockClear();
    native.resolve.mockImplementation(async (_script, platform, json, quality) =>
      response(platform, JSON.parse(json).songmid, JSON.parse(json).__lxPinnedBackend, quality));
    await expect(resolveWithImportedSourcePrewarm(song('qq', 'background-recovered'), [source], '128k'))
      .resolves.toMatchObject({ backend: 'launch-fixed' });
    expect(native.resolve).toHaveBeenCalledTimes(1);
  });
  test('a rate-limited source tries the next source without repeating token requests at lower qualities', async () => {
    const native = bridge();
    const second = { ...source, id: 'limit-fallback', script: 'limit-fallback-script' };
    native.resolve.mockImplementation(async (script, platform, json, quality) => {
      if (script === source.script) throw Object.assign(new Error('token unavailable'), { code: 'SOURCE_RATE_LIMITED' });
      return response(platform, JSON.parse(json).songmid, 'next', quality);
    });
    await expect(resolveWithImportedSource(song('qq', 'limit', ['flac', '320k', '128k']), [source, second], 'flac', false, undefined, false, true))
      .resolves.toMatchObject({ sourceId: second.id });
    expect(native.resolve.mock.calls.filter(call => call[0] === source.script)).toHaveLength(1);
  });
  test('rate limiting remains distinguishable after all sources fail and does not blacklist the song', async () => {
    const native = bridge();
    native.resolve.mockRejectedValue(Object.assign(new Error('token unavailable'), { code: 'SOURCE_RATE_LIMITED' }));
    const track = song('qq', 'all-limited', ['flac', '320k', '128k']);
    await expect(resolveWithImportedSource(track, [source], 'flac', false, undefined, false, true))
      .rejects.toMatchObject({ code: 'SOURCE_RATE_LIMITED' });
    expect(native.resolve).toHaveBeenCalledTimes(1);
    expect(isRuntimeTrackBlocked(track)).toBe(false);
  });
  test('a slow previous winner cannot hold a newly selected song', async () => {
    const native = bridge(); await registerThree(native);
    const slow = deferred<ReturnType<typeof response>>();
    native.resolve.mockImplementation((_script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (info.__lxDiscoverBackendRoutes) return Promise.resolve({ url: '', discoveredRoutes:
        ['launch-fixed', 'second-fixed', 'third-fixed'].map(backend => endpoint(platform, backend)) } as never);
      if (info.__lxPinnedBackend === 'launch-fixed') return slow.promise;
      return Promise.resolve(response(platform, info.songmid, info.__lxPinnedBackend, quality));
    });
    await expect(resolveWithImportedSource(song('qq', 'foreground-race'), [source], '128k', false, undefined, false, true))
      .resolves.toMatchObject({ backend: 'second-fixed', audio: { sampleBytes: 4096 } });
    expect(native.resolve.mock.calls.filter(call => !JSON.parse(call[2]).__lxDiscoverBackendRoutes)
      .map(call => JSON.parse(call[2]).__lxPinnedBackend))
      .toEqual(['launch-fixed', 'second-fixed', 'third-fixed']);
    expect(NativeModules.LiuliuStorage.cancelSourceScriptAddress).toHaveBeenCalledTimes(1);
    slow.resolve(response('tx', 'late', 'launch-fixed')); await flush();
  });
  test('invalid audio cannot win; the next source waits for all current interfaces', async () => {
    const native = bridge(); await registerThree(native);
    const pending = deferred<ReturnType<typeof response>>();
    const second = { ...source, id: 'foreground-next', script: 'foreground-next-script' };
    native.resolve.mockImplementation((script, platform, json, quality) => {
      const info = JSON.parse(json);
      if (script === second.script) return Promise.resolve(response(platform, info.songmid, 'next', quality));
      if (info.__lxDiscoverBackendRoutes) return Promise.resolve({ url: '', discoveredRoutes:
        ['launch-fixed', 'second-fixed', 'third-fixed'].map(backend => endpoint(platform, backend)) } as never);
      if (info.__lxPinnedBackend === 'third-fixed') return pending.promise;
      return Promise.resolve(response(platform, 'bad', info.__lxPinnedBackend, quality));
    });
    native.probe.mockImplementation(async url => {
      if (url.includes('/bad/')) throw new Error('not an audio stream');
      return { durationSeconds: 180, resolvedUrl: url, sampleBytes: 4096, mimeType: 'audio/mpeg', bitrate: 128000 };
    });
    const result = resolveWithImportedSource(song('qq', 'foreground-next-source'), [source, second], '128k', false, undefined, false, true);
    await flush();
    expect(native.resolve.mock.calls.some(call => call[0] === second.script)).toBe(false);
    pending.resolve({ ...response('tx', 'bad', 'third-fixed'), url: '' });
    await expect(result).resolves.toMatchObject({ sourceId: second.id, backend: 'next' });
  });
});
