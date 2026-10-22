import type {
  PlatformSetting,
  SourceSetting,
  Track,
} from '../src/domain/types';
import {
  detectHealthyPlatforms,
  orderedHealthyProviders,
  startPlatformHealthDetection,
  loadDesktopHealthSample,
  loadStartupHealthSample,
  type PlatformHealthResult,
} from '../src/services/liveDiscovery';
import { getCatalog, getCollection } from '../src/services/onlineCatalog';
import { probeStartupSource } from '../src/services/sourceRuntime';

jest.mock('../src/services/onlineCatalog', () => ({
  getCatalog: jest.fn(),
  getCollection: jest.fn(),
  newSongChart: jest.requireActual('../src/services/onlineCatalog').newSongChart,
}));
jest.mock('../src/services/onlineMusic', () => ({
  searchOnline: jest.fn(),
}));
jest.mock('../src/services/sourceRuntime', () => ({
  probeStartupSource: jest.fn(),
}));

const platforms: PlatformSetting[] = [
  { id: 'netease', name: '网易云音乐', enabled: true },
  { id: 'qq', name: 'QQ音乐', enabled: true },
  { id: 'kugou', name: '酷狗音乐', enabled: false },
  { id: 'kuwo', name: '酷我音乐', enabled: true },
];
const sources: SourceSetting[] = [
  {
    id: 'source',
    name: '测试源',
    enabled: true,
    healthy: false,
    script: 'test script',
  },
];
const sample = (provider: PlatformSetting['id']): Track => ({
  id: `${provider}-sample`,
  title: '测试歌曲',
  artist: '测试歌手',
  album: '测试专辑',
  duration: 180,
  provider,
  providerId: '1',
  coverKey: 'train',
  language: '华语',
  genre: '流行',
  mood: '发现',
  releaseYear: 2026,
});
const monotonicClock = jest.requireActual('perf_hooks').performance;
declare const performance: { now(): number };
beforeEach(() => {
  jest.clearAllMocks();
  // React Native's Jest preset leaves performance.now as an empty mock.
  jest.spyOn(performance, 'now').mockImplementation(() => monotonicClock.now());
  jest
    .mocked(getCatalog)
    .mockImplementation(async provider => [
      {
        id: `${provider}-chart`,
        title: '榜单',
        description: '',
        provider,
        kind: 'charts',
      },
    ]);
  jest
    .mocked(getCollection)
    .mockImplementation(async (provider, _kind, id) => ({
      id,
      title: '榜单',
      description: '',
      provider,
      kind: 'charts',
      tracks: [sample(provider)],
    }));
  jest.mocked(probeStartupSource).mockImplementation(async track => {
    if (track.provider === 'qq') throw new Error('QQ 播放链路检测失败');
    return {
      url: `https://audio.example/${track.provider}.mp3`,
      quality: '128k',
      sourceId: 'source',
      backend: '测试后端',
      probe: { sampleBytes: 65_536 },
    };
  });
});
afterEach(() => jest.restoreAllMocks());

test('completed diagnostics preserve every platform and source with bounded sanitized message parts', async () => {
  const { Buffer } = require('buffer');
  const info = jest.spyOn(console, 'info').mockImplementation(() => {});
  const all = (['netease', 'qq', 'kugou', 'kuwo', 'migu', 'qishui'] as const)
    .map(id => ({ id, name: id, enabled: true }));
  const inputs = [
    { ...sources[0]!, id: 'first' },
    { ...sources[0]!, id: 'second' },
  ];
  const before = JSON.stringify({ all, inputs });
  const failure = '音频校验失败😀'.repeat(1200) +
    ' HTTPS_DOWNGRADE_BLOCKED https://private.test/audio?key=url-secret' +
    ' token=token-secret key=standalone-secret {"key":"json-secret"} END_OF_FAILURE';
  jest.mocked(probeStartupSource).mockImplementation(async (track, source) => {
    if (track.provider === 'qishui') throw new Error(failure);
    return { ...probeResult(), sourceId: source.id };
  });
  const session = startPlatformHealthDetection(all, inputs, '128k', true);
  await expect(session.firstPassed).resolves.toBeDefined();
  const result = await session.completed;
  expect(result.healthy).toHaveLength(5);
  expect(result.healthy).not.toContain('qishui');
  expect(result.byProvider.qishui?.checks).toHaveLength(2);
  expect(result.byProvider.qishui?.checks.every(check => !check.passed)).toBe(true);
  expect(getCollection).toHaveBeenCalledTimes(6);
  expect(probeStartupSource).toHaveBeenCalledTimes(12);
  expect(jest.mocked(probeStartupSource).mock.calls.every(args => args[2] === '128k')).toBe(true);
  expect(JSON.stringify({ all, inputs })).toBe(before);

  const emitted = info.mock.calls.filter(args => args[0] === '[startup-health-detail]');
  const rows = emitted.map(args => JSON.parse(String(args[1])));
  expect(new Set(rows.map(row => row.provider))).toEqual(new Set(all.map(item => item.id)));
  expect(emitted.every(args => Buffer.byteLength(JSON.stringify(args), 'utf8') < 3000)).toBe(true);
  const joined = emitted.map(args => String(args[1])).join('');
  for (const secret of ['url-secret', 'token-secret', 'standalone-secret', 'json-secret', 'private.test'])
    expect(joined).not.toContain(secret);
  for (const sourceId of ['first', 'second']) {
    const chunks = rows.filter(row => row.provider === 'qishui' && row.sourceId === sourceId);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((row, index) => row.part === index + 1 && row.parts === chunks.length)).toBe(true);
    expect(chunks.every(row => row.stage === 'resolve' && row.passed === false)).toBe(true);
    const record = JSON.parse(chunks.map(row => row.payload).join(''));
    expect(record.sourceId).toBe(sourceId);
    expect(record.message).toContain('HTTPS_DOWNGRADE_BLOCKED');
    expect(record.message).toContain('END_OF_FAILURE');
    expect(record.message).toContain('音频校验失败😀');
  }
});

test('diagnostic output for successful results records the same bound source without adding probes', async () => {
  const info = jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.mocked(probeStartupSource).mockResolvedValue(probeResult('original-backend'));
  const result = await startPlatformHealthDetection([platforms[0]!], sources, '128k', false).completed;
  const rows = info.mock.calls.filter(args => args[0] === '[startup-health-detail]')
    .map(args => JSON.parse(String(args[1])));
  const summary = rows.filter(row => row.provider === 'netease' && row.stage === 'complete');
  expect(summary).toHaveLength(1);
  expect(JSON.parse(summary[0].payload).selectedSourceId).toBe(result.byProvider.netease?.selectedSourceId);
  expect(rows.some(row => row.sourceId === 'source' && row.passed === true)).toBe(true);
  expect(getCollection).toHaveBeenCalledTimes(1);
  expect(probeStartupSource).toHaveBeenCalledTimes(1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const probeResult = (backend = '测试后端') => ({
  url: 'https://audio.example/health.mp3',
  quality: '128k' as const,
  sourceId: 'source',
  backend,
  probe: { sampleBytes: 65_536 },
});

test('exposes only the selected passing source probe duration without adding a probe', async () => {
  let now = 1000;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => now);
  const slow = deferred<ReturnType<typeof probeResult>>();
  const fast = deferred<ReturnType<typeof probeResult>>();
  jest
    .mocked(probeStartupSource)
    .mockImplementation((_track, source) =>
      source.id === 'slow' ? slow.promise : fast.promise,
    );
  try {
    const session = startPlatformHealthDetection(
      [platforms[0]!],
      [
        { ...sources[0]!, id: 'slow' },
        { ...sources[0]!, id: 'fast' },
      ],
      'hires',
      true,
    );
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(probeStartupSource).toHaveBeenCalledTimes(2);
    now = 1030;
    fast.resolve(probeResult('fast-backend'));
    await Promise.resolve();
    now = 1120;
    slow.resolve(probeResult('slow-backend'));
    const health = await session.completed;
    expect(health.byProvider.netease).toMatchObject({
      passed: true,
      selectedSourceId: 'fast',
      backend: 'fast-backend',
      elapsedMs: 30,
    });
    expect(probeStartupSource).toHaveBeenCalledTimes(2);
  } finally {
    clock.mockRestore();
  }
});

test('launch starts five probes together and releases only the first bound platform while the other probes continue', async () => {
  const five = ['netease', 'qq', 'kugou', 'kuwo', 'migu'].map(id => ({
    id,
    name: id,
    enabled: true,
  })) as PlatformSetting[];
  const pending = Object.fromEntries(
    five.map(p => [p.id, deferred<ReturnType<typeof probeResult>>()]),
  );
  jest
    .mocked(probeStartupSource)
    .mockImplementation(track => pending[track.provider].promise);
  const updates: PlatformHealthResult[] = [];
  const session = startPlatformHealthDetection(
    five,
    sources,
    '320k',
    false,
    health => updates.push(health),
  );
  let completed = false;
  session.completed.then(() => {
    completed = true;
  });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(probeStartupSource).toHaveBeenCalledTimes(5);
  pending.kuwo.resolve(probeResult('酷我后端'));
  const first = await session.firstPassed;
  expect(first).toMatchObject({
    first: 'kuwo',
    healthy: ['kuwo'],
    pending: ['netease', 'qq', 'kugou', 'migu'],
    completed: false,
    sourceIdsByProvider: { kuwo: ['source'] },
    backendByProvider: { kuwo: '酷我后端' },
  });
  expect(completed).toBe(false);
  pending.qq.reject(new Error('QQ 不可用'));
  pending.netease.resolve(probeResult('网易后端'));
  pending.kugou.resolve(probeResult('酷狗后端'));
  pending.migu.resolve(probeResult('咪咕后端'));
  const final = await session.completed;
  expect(final).toMatchObject({
    first: 'kuwo',
    healthy: ['netease', 'kugou', 'kuwo', 'migu'],
    pending: [],
    completed: true,
  });
  expect(final.byProvider.qq?.passed).toBe(false);
  expect(first.healthy).toEqual(['kuwo']);
  expect(first).toHaveProperty('passedOrder', ['kuwo']);
  expect(final).toHaveProperty('passedOrder', ['kuwo', 'netease', 'kugou', 'migu']);
  expect(first.byProvider.netease).toBeUndefined();
  expect(updates.at(-1)).toEqual(final);
  expect(probeStartupSource).toHaveBeenCalledTimes(5);
});

test('multi-source releases a proven fastest source while seven source checks continue to completion', async () => {
  let now = 1000;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => now);
  const seven = Array.from({ length: 7 }, (_, index) => ({
    ...sources[0]!,
    id: `source-${index}`,
  }));
  const checks = seven.map(() => deferred<ReturnType<typeof probeResult>>());
  jest
    .mocked(probeStartupSource)
    .mockImplementation(
      (_track, source) =>
        checks[seven.findIndex(item => item.id === source.id)]!.promise,
    );
  const updates: PlatformHealthResult[] = [];
  try {
    const session = startPlatformHealthDetection(
      [platforms[0]!],
      seven,
      'hires',
      true,
      health => updates.push(health),
    );
    let firstReady = false;
    let completed = false;
    session.firstPassed.then(() => {
      firstReady = true;
    });
    session.completed.then(() => {
      completed = true;
    });
    await flushHealthMicrotasks();
    expect(probeStartupSource).toHaveBeenCalledTimes(7);
    now = 1040;
    checks[0]!.resolve(probeResult('fast-backend'));
    await flushHealthMicrotasks();
    expect(firstReady).toBe(true);
    expect(completed).toBe(false);
    const first = await session.firstPassed;
    expect(first).toMatchObject({
      first: 'netease',
      healthy: ['netease'],
      pending: [],
      completed: false,
      sourceIdsByProvider: { netease: ['source-0'] },
      backendByProvider: { netease: 'fast-backend' },
    });
    expect(first.byProvider.netease!.checks).toHaveLength(1);
    now = 1500;
    checks.slice(1).forEach((check, index) => {
      if (index % 2) check.reject(new Error('late source failure'));
      else check.resolve(probeResult('late-backend'));
    });
    const final = await session.completed;
    expect(final).toMatchObject({
      first: 'netease',
      pending: [],
      completed: true,
      sourceIdsByProvider: { netease: ['source-0'] },
      backendByProvider: { netease: 'fast-backend' },
    });
    expect(final.byProvider.netease!.checks).toHaveLength(7);
    expect(first.byProvider.netease!.checks).toHaveLength(1);
    expect(updates.at(-1)).toEqual(final);
    expect(probeStartupSource).toHaveBeenCalledTimes(7);
  } finally {
    clock.mockRestore();
  }
});

async function flushHealthMicrotasks() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

test('a later platform completing all its checks cannot replace the early bound startup platform', async () => {
  let now = 1000;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => now);
  const two = [platforms[0]!, platforms[1]!];
  const twoSources = [...sources, { ...sources[0]!, id: 'second' }];
  const checks = two.map(() =>
    twoSources.map(() => deferred<ReturnType<typeof probeResult>>()),
  );
  jest
    .mocked(probeStartupSource)
    .mockImplementation(
      (track, source) =>
        checks[two.findIndex(item => item.id === track.provider)]![
          twoSources.findIndex(item => item.id === source.id)
        ]!.promise,
    );
  try {
    const session = startPlatformHealthDetection(two, twoSources, 'flac', true);
    let firstReady = false;
    session.firstPassed.then(() => {
      firstReady = true;
    });
    await flushHealthMicrotasks();
    expect(getCollection).toHaveBeenCalledTimes(2);
    expect(probeStartupSource).toHaveBeenCalledTimes(4);
    now = 1020;
    checks[0]![0]!.resolve(probeResult('startup-backend'));
    await flushHealthMicrotasks();
    expect(firstReady).toBe(true);
    expect(await session.firstPassed).toMatchObject({
      first: 'netease',
      healthy: ['netease'],
      pending: ['qq'],
      completed: false,
    });
    now = 1040;
    checks[1]![0]!.resolve(probeResult('qq-backend'));
    checks[1]![1]!.reject(new Error('qq second source failed'));
    await flushHealthMicrotasks();
    now = 1200;
    checks[0]![1]!.reject(new Error('late netease source failed'));
    expect(await session.completed).toMatchObject({
      first: 'netease',
      healthy: ['netease', 'qq'],
      completed: true,
      backendByProvider: { netease: 'startup-backend', qq: 'qq-backend' },
    });
    expect(getCollection).toHaveBeenCalledTimes(2);
    expect(probeStartupSource).toHaveBeenCalledTimes(4);
  } finally {
    clock.mockRestore();
  }
});

test('wall-clock adjustments cannot change the monotonic fastest-source decision', async () => {
  let now = 1000;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => now);
  const wallClock = jest.spyOn(Date, 'now').mockReturnValue(200_000);
  const a = deferred<ReturnType<typeof probeResult>>();
  const b = deferred<ReturnType<typeof probeResult>>();
  jest
    .mocked(probeStartupSource)
    .mockImplementation((_track, source) =>
      source.id === 'source' ? a.promise : b.promise,
    );
  try {
    const session = startPlatformHealthDetection(
      [platforms[0]!],
      [...sources, { ...sources[0]!, id: 'second' }],
      '320k',
      true,
    );
    await flushHealthMicrotasks();
    now = 1020;
    a.resolve(probeResult('winner'));
    await flushHealthMicrotasks();
    expect((await session.firstPassed).backendByProvider.netease).toBe(
      'winner',
    );
    wallClock.mockReturnValue(100_000);
    now = 1300;
    b.resolve(probeResult('late-backend'));
    expect((await session.completed).byProvider.netease).toMatchObject({
      selectedSourceId: 'source',
      backend: 'winner',
      elapsedMs: 20,
    });
  } finally {
    wallClock.mockRestore();
    clock.mockRestore();
  }
});

test('multi-source waits only until an earlier source can no longer win the same-duration tie', async () => {
  jest.useFakeTimers();
  let now = 1000;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => now);
  const a = deferred<ReturnType<typeof probeResult>>();
  const b = deferred<ReturnType<typeof probeResult>>();
  jest
    .mocked(probeStartupSource)
    .mockImplementation((_track, source) =>
      source.id === 'source' ? a.promise : b.promise,
    );
  try {
    const session = startPlatformHealthDetection(
      [platforms[0]!],
      [...sources, { ...sources[0]!, id: 'second' }],
      '320k',
      true,
    );
    let firstReady = false;
    session.firstPassed.then(() => {
      firstReady = true;
    });
    await flushHealthMicrotasks();
    now = 1020;
    b.resolve(probeResult('快后端'));
    await flushHealthMicrotasks();
    expect(firstReady).toBe(false);
    now = 1021;
    jest.advanceTimersByTime(1);
    await flushHealthMicrotasks();
    expect(firstReady).toBe(true);
    expect(await session.firstPassed).toMatchObject({
      sourceIdsByProvider: { netease: ['second'] },
      backendByProvider: { netease: '快后端' },
      completed: false,
    });
    now = 1100;
    a.resolve(probeResult('慢后端'));
    expect((await session.completed).sourceIdsByProvider.netease).toEqual([
      'second',
    ]);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    clock.mockRestore();
    jest.useRealTimers();
  }
});

test('an earlier persisted source wins a same-duration tie even when its result arrives second', async () => {
  jest.useFakeTimers();
  let now = 1000;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => now);
  const a = deferred<ReturnType<typeof probeResult>>();
  const b = deferred<ReturnType<typeof probeResult>>();
  jest
    .mocked(probeStartupSource)
    .mockImplementation((_track, source) =>
      source.id === 'source' ? a.promise : b.promise,
    );
  try {
    const session = startPlatformHealthDetection(
      [platforms[0]!],
      [...sources, { ...sources[0]!, id: 'second' }],
      '320k',
      true,
    );
    let firstReady = false;
    session.firstPassed.then(() => {
      firstReady = true;
    });
    await flushHealthMicrotasks();
    now = 1020;
    b.resolve(probeResult('second-backend'));
    await flushHealthMicrotasks();
    expect(firstReady).toBe(false);
    a.resolve(probeResult('first-backend'));
    expect(await session.firstPassed).toMatchObject({
      sourceIdsByProvider: { netease: ['source'] },
      backendByProvider: { netease: 'first-backend' },
    });
    await session.completed;
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    clock.mockRestore();
    jest.useRealTimers();
  }
});

test('a later-started source may beat the first completed source and must finish before binding', async () => {
  jest.useFakeTimers();
  let now = 1000;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => now);
  const a = deferred<ReturnType<typeof probeResult>>();
  const b = deferred<ReturnType<typeof probeResult>>();
  jest.mocked(probeStartupSource).mockImplementation((_track, source) => {
    if (source.id === 'source') {
      now = 1005;
      return a.promise;
    }
    return b.promise;
  });
  try {
    const session = startPlatformHealthDetection(
      [platforms[0]!],
      [...sources, { ...sources[0]!, id: 'second' }],
      '320k',
      true,
    );
    let firstReady = false;
    session.firstPassed.then(() => {
      firstReady = true;
    });
    await flushHealthMicrotasks();
    now = 1010;
    a.resolve(probeResult('first-completed'));
    await flushHealthMicrotasks();
    expect(firstReady).toBe(false);
    now = 1012;
    b.resolve(probeResult('shorter-duration'));
    expect(await session.firstPassed).toMatchObject({
      sourceIdsByProvider: { netease: ['second'] },
      backendByProvider: { netease: 'shorter-duration' },
    });
    expect((await session.completed).byProvider.netease!.elapsedMs).toBe(7);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    clock.mockRestore();
    jest.useRealTimers();
  }
});

test('all failures release the first-result wait only when the same launch has finished', async () => {
  const pending = deferred<ReturnType<typeof probeResult>>();
  jest.mocked(probeStartupSource).mockImplementation(() => pending.promise);
  const session = startPlatformHealthDetection([platforms[0]], sources, '320k');
  pending.reject(new Error('不可用'));
  const first = await session.firstPassed;
  expect(first).toMatchObject({
    first: null,
    healthy: [],
    pending: [],
    completed: true,
  });
  expect(await session.completed).toEqual(first);
});

test('no imported source completes immediately without probing or inventing a passing platform', async () => {
  const session = startPlatformHealthDetection(platforms, [], '320k');
  expect(await session.firstPassed).toMatchObject({
    first: null,
    healthy: [],
    pending: [],
    completed: true,
  });
  await session.completed;
  expect(probeStartupSource).not.toHaveBeenCalled();
});

test('declares a platform healthy when its new-release first song resolves and probes successfully', async () => {
  await expect(
    detectHealthyPlatforms(platforms, sources, '320k'),
  ).resolves.toMatchObject({
    healthy: ['netease', 'kuwo'],
    first: 'netease',
    sourceIds: ['source'],
    sourceIdsByProvider: { netease: ['source'], kuwo: ['source'] },
    backendByProvider: { netease: '测试后端', kuwo: '测试后端' },
  });
  expect(getCatalog).not.toHaveBeenCalled();
  expect(jest.mocked(getCollection).mock.calls.map(call => call[2])).toEqual([
    '3779629',
    '27',
    '17',
  ]);
  expect(probeStartupSource).not.toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'kugou' }),
    expect.anything(),
    '320k',
  );
  expect(probeStartupSource).toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'netease' }),
    expect.objectContaining({ id: 'source', healthy: true }),
    '320k',
  );
  expect(probeStartupSource).toHaveBeenCalledTimes(3);
});

test('exposes launch-scoped platform and source diagnostics', async () => {
  jest.mocked(probeStartupSource).mockImplementation(async (_track, source) => {
    if (source.id === 'first-source') throw new Error('后端不可用');
    return {
      url: 'https://audio.example/second.mp3',
      quality: '128k',
      sourceId: source.id,
      backend: '测试后端',
      probe: { sampleBytes: 65_536 },
    };
  });
  const result = await detectHealthyPlatforms(
    [{ id: 'qq', name: 'QQ音乐', enabled: true }],
    [
      { ...sources[0]!, id: 'first-source' },
      { ...sources[0]!, id: 'second-source' },
    ],
    '320k',
    true,
  );
  expect(result.byProvider.qq).toMatchObject({
    passed: true,
    selectedSourceId: 'second-source',
    checks: [
      {
        sourceId: 'first-source',
        passed: false,
        stage: 'resolve',
        message: '后端不可用',
      },
      { sourceId: 'second-source', passed: true, stage: 'resolve' },
    ],
  });
});

test('requests the one startup chart sample for enabled platforms concurrently', async () => {
  let activeSearches = 0;
  let maximumActiveSearches = 0;
  jest.mocked(getCollection).mockImplementation(async (provider, _kind, id) => {
    activeSearches += 1;
    maximumActiveSearches = Math.max(maximumActiveSearches, activeSearches);
    await Promise.resolve();
    activeSearches -= 1;
    return {
        id,
        title: '榜单',
        description: '',
        provider,
        kind: 'charts',
        tracks: [sample(provider)],
    };
  });

  await detectHealthyPlatforms(platforms, sources, '320k');

  expect(maximumActiveSearches).toBe(3);
});

test('returns no fallback platform when every enabled playback probe fails', async () => {
  jest.mocked(probeStartupSource).mockRejectedValue(new Error('全部不可播放'));
  await expect(
    detectHealthyPlatforms(platforms, sources, '320k'),
  ).resolves.toMatchObject({
    healthy: [],
    first: null,
    sourceIds: [],
    sourceIdsByProvider: {},
    backendByProvider: {},
  });
});

test('probes the original new-release first song below thirty-five seconds without substituting its second song', async () => {
  jest
    .mocked(getCollection)
    .mockImplementation(async (provider, _kind, id) => ({
      id,
      title: '榜单',
      description: '',
      provider,
      kind: 'charts',
      tracks: [{ ...sample(provider), duration: 34 }, { ...sample(provider), id: 'second-valid-song' }],
    }));
  await expect(
    detectHealthyPlatforms(platforms, sources, '320k'),
  ).resolves.toMatchObject({
    healthy: ['netease', 'kuwo'],
    sourceIds: ['source'],
    byProvider: { netease: { passed: true } },
  });
  expect(probeStartupSource).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'netease-sample', duration: 34 }),
    expect.objectContaining({ id: 'source' }),
    '320k',
  );
  expect(jest.mocked(probeStartupSource).mock.calls.some(([track]) => track.id === 'second-valid-song')).toBe(false);
});

test('probes the original new-release first song when catalog duration is unreadable', async () => {
  jest
    .mocked(getCollection)
    .mockImplementation(async (provider, _kind, id) => ({
      id,
      title: '榜单',
      description: '',
      provider,
      kind: 'charts',
      tracks: [{ ...sample(provider), duration: 0 }],
    }));
  await expect(
    detectHealthyPlatforms(
      [{ id: 'kuwo', name: '酷我音乐', enabled: true }],
      sources,
      '320k',
    ),
  ).resolves.toMatchObject({
    healthy: ['kuwo'],
    first: 'kuwo',
    sourceIds: ['source'],
    sourceIdsByProvider: { kuwo: ['source'] },
    backendByProvider: { kuwo: '测试后端' },
  });
  expect(probeStartupSource).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'kuwo-sample', duration: 0 }),
    expect.objectContaining({ id: 'source' }),
    '320k',
  );
});

test('all five startup platforms use exactly their new-release first song across every enabled source', async () => {
  const providers = ['netease', 'qq', 'kugou', 'kuwo', 'migu'] as const;
  jest.mocked(getCollection).mockImplementation(async (provider, _kind, id) => ({
    id, title: '新歌首发', description: '', provider, kind: 'charts',
    tracks: [sample(provider), { ...sample(provider), id: `${provider}-second` }],
  }));
  jest.mocked(probeStartupSource).mockImplementation(async () => probeResult());
  const result = await detectHealthyPlatforms(
    providers.map(id => ({ id, name: id, enabled: true })),
    [sources[0]!, { ...sources[0]!, id: 'second-source' }], 'hires', true,
  );
  expect(result.healthy).toEqual([...providers]);
  expect(getCatalog).not.toHaveBeenCalled();
  expect(jest.mocked(getCollection).mock.calls.map(call => [call[0], call[1], call[2]]))
    .toEqual([
      ['netease', 'charts', '3779629'], ['qq', 'charts', '27'],
      ['kugou', 'charts', '31308'], ['kuwo', 'charts', '17'],
      ['migu', 'charts', '27553319'],
    ]);
  expect(probeStartupSource).toHaveBeenCalledTimes(10);
  for (const [track] of jest.mocked(probeStartupSource).mock.calls)
    expect(track.id).toBe(`${track.provider}-sample`);
});

test('manual source health retains its first-chart sample instead of the launch new-release sample', async () => {
  await expect(loadDesktopHealthSample('qq')).resolves.toEqual(sample('qq'));
  expect(getCatalog).toHaveBeenCalledWith('qq', 'charts', 1);
  expect(getCollection).toHaveBeenCalledWith('qq', 'charts', 'qq-chart');
});

test.each(['empty', 'request-error'] as const)('a %s new-release first song fails without an alternate chart or song', async failure => {
  if (failure === 'request-error') jest.mocked(getCollection).mockRejectedValueOnce(new Error('新歌榜不可用'));
  else jest.mocked(getCollection).mockResolvedValueOnce({
    id: '27', title: '新歌首发', provider: 'qq', kind: 'charts', description: '', tracks: [],
  });
  await expect(loadStartupHealthSample('qq')).rejects.toThrow();
  expect(getCollection).toHaveBeenCalledTimes(1);
  expect(getCollection).toHaveBeenCalledWith('qq', 'charts', '27');
  expect(getCatalog).not.toHaveBeenCalled();
  expect(probeStartupSource).not.toHaveBeenCalled();
});

test('preserves the first completed healthy platform for startup autoplay while retaining ordered health results', async () => {
  jest.mocked(probeStartupSource).mockImplementation(async track => {
    if (track.provider === 'qq') throw new Error('QQ 播放链路检测失败');
    if (track.provider === 'netease')
      await new Promise<void>(resolve => setTimeout(resolve, 20));
    return {
      url: `https://audio.example/${track.provider}.mp3`,
      quality: '128k',
      sourceId: 'source',
      backend: '测试后端',
      probe: { sampleBytes: 65_536 },
    };
  });
  await expect(
    detectHealthyPlatforms(platforms, sources, '320k'),
  ).resolves.toMatchObject({
    healthy: ['netease', 'kuwo'],
    first: 'kuwo',
    sourceIds: ['source'],
    sourceIdsByProvider: { netease: ['source'], kuwo: ['source'] },
    backendByProvider: { netease: '测试后端', kuwo: '测试后端' },
  });
});

test('keeps passing platforms when another platform fails its launch probe', async () => {
  jest.mocked(probeStartupSource).mockImplementation(async track => {
    if (track.provider === 'qq') throw new Error('QQ 播放链路检测失败');
    return {
      url: `https://audio.example/${track.provider}.mp3`,
      quality: '128k',
      sourceId: 'source',
      backend: '测试后端',
      probe: { sampleBytes: 65_536 },
    };
  });
  const health = await detectHealthyPlatforms(platforms, sources, '320k');
  expect(health.healthy).toEqual(['netease', 'kuwo']);
  expect(orderedHealthyProviders(health)).toEqual(['netease', 'kuwo']);
  expect(health.byProvider.qq).toMatchObject({
    passed: false,
    message: '所有已参与音源均未通过播放链路检测',
  });
});

test('records the exact user-enabled source that passed each platform probe', async () => {
  jest.mocked(probeStartupSource).mockResolvedValue({
    url: 'https://audio.example/qq.mp3',
    quality: '128k',
    backend: '测试后端',
    audio: { durationSeconds: 180, verifiedThroughSeconds: 180, sampleBytes: 65_536 },
  });
  const selected = { ...sources[0]!, id: 'user-selected-source' };
  const disabledBundled = {
    ...sources[0]!,
    id: 'bundled-molan-2.3.0',
    enabled: false,
  };
  await expect(
    detectHealthyPlatforms(
      [{ id: 'qq', name: 'QQ音乐', enabled: true }],
      [disabledBundled, selected],
      '320k',
    ),
  ).resolves.toMatchObject({
    healthy: ['qq'],
    first: 'qq',
    sourceIds: ['user-selected-source'],
    sourceIdsByProvider: { qq: ['user-selected-source'] },
    backendByProvider: { qq: '测试后端' },
  });
  expect(probeStartupSource).toHaveBeenCalledTimes(1);
  expect(probeStartupSource).toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'qq' }),
    expect.objectContaining({ id: 'user-selected-source', healthy: true }),
    '320k',
  );
});

test('single-source startup checks only the first enabled source', async () => {
  const first = { ...sources[0]!, id: 'first-source' };
  const second = { ...sources[0]!, id: 'second-source' };
  jest.mocked(probeStartupSource).mockImplementation(async (_track, source) => {
    if (source.id === 'first-source') throw new Error('first failed');
    return {
      url: 'https://audio.example/second.mp3',
      quality: '128k',
      sourceId: source.id,
      backend: '测试后端',
      probe: { sampleBytes: 65_536 },
    };
  });

  await expect(
    detectHealthyPlatforms(
      [{ id: 'netease', name: '网易云音乐', enabled: true }],
      [first, second],
      '320k',
    ),
  ).resolves.toMatchObject({
    healthy: [],
    first: null,
    sourceIds: [],
    sourceIdsByProvider: {},
    backendByProvider: {},
  });
  expect(probeStartupSource).toHaveBeenCalledTimes(1);
  expect(probeStartupSource).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ id: 'first-source' }),
    '320k',
  );
});

test('single-source startup keeps the first source when it passes', async () => {
  const first = { ...sources[0]!, id: 'first-source' };
  const second = { ...sources[0]!, id: 'second-source' };
  jest.mocked(probeStartupSource).mockImplementation(async (_track, source) => {
    if (source.id === 'first-source')
      await new Promise<void>(resolve => setTimeout(resolve, 20));
    return {
      url: `https://audio.example/${source.id}.mp3`,
      quality: '128k',
      sourceId: source.id,
      backend: '测试后端',
      probe: { sampleBytes: 65_536 },
    };
  });

  const result = await detectHealthyPlatforms(
    [{ id: 'netease', name: '网易云音乐', enabled: true }],
    [first, second],
    '320k',
  );

  expect(result.sourceIdsByProvider).toEqual({ netease: ['first-source'] });
  expect(result.byProvider.netease).toMatchObject({
    selectedSourceId: 'first-source',
    checks: [{ sourceId: 'first-source', passed: true }],
  });
  expect(probeStartupSource).toHaveBeenCalledTimes(1);
});

test('startup health passes the user ceiling to the shared real URL selection', async () => {
  await detectHealthyPlatforms(
    [{ id: 'netease', name: '网易云音乐', enabled: true }],
    sources,
    'flac',
  );

  expect(probeStartupSource).toHaveBeenCalledTimes(1);
  expect(probeStartupSource).toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'netease' }),
    expect.objectContaining({ id: 'source' }),
    'flac',
  );
});

test.each([
  'netease',
  'qq',
  'kugou',
  'kuwo',
  'migu',
] as PlatformSetting['id'][])(
  'multi-source detection selects the fastest passing source independently for %s',
  async provider => {
    const slow = { ...sources[0]!, id: 'slow-source' };
    const fast = { ...sources[0]!, id: 'fast-source' };
    jest
      .mocked(probeStartupSource)
      .mockImplementation(async (_track, source) => {
        if (source.id === 'slow-source')
          await new Promise<void>(resolve => setTimeout(resolve, 20));
        return {
          url: `https://audio.example/${source.id}.mp3`,
          quality: '128k',
          sourceId: source.id,
          backend: '测试后端',
          probe: { sampleBytes: 65_536 },
        };
      });
    await expect(
      detectHealthyPlatforms(
        [{ id: provider, name: provider, enabled: true }],
        [slow, fast],
        '320k',
        true,
      ),
    ).resolves.toMatchObject({
      healthy: [provider],
      first: provider,
      sourceIds: ['fast-source'],
      sourceIdsByProvider: { [provider]: ['fast-source'] },
      backendByProvider: { [provider]: '测试后端' },
    });
    expect(probeStartupSource).toHaveBeenCalledTimes(2);
  },
);
