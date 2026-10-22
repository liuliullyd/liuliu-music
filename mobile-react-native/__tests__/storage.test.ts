import { defaultState, getStateStorageStatus, loadState, normalizeState, saveState, serializePersistedState } from '../src/services/storage';

test('process-only prewarm bindings are removed from saved data and backups without changing local playback URLs', async () => {
  const state = defaultState();
  const metadata = { songmid: 'qq-warm', _prewarmedUrl: true, _prewarmedAt: 123,
    _prewarmedQuality: 'hires', _prewarmedAudio: { durationSeconds: 240, sampleBytes: 4096 } };
  state.savedTracks = [{ id: 'qq-warm', provider: 'qq', playUrl: 'https://audio.test/warm', metadata } as any,
    { id: 'local', provider: 'custom', playUrl: 'file:///music/local.mp3', metadata: { _libraryLocalFile: 'local' } } as any,
    { id: 'qq-played', provider: 'qq', playUrl: 'https://audio.test/validated', metadata: {
      songmid: 'qq-played', _playerPreparationSource: 0, _playbackPreference: '128k',
      _playbackQuality: '128k', _playbackAudio: { durationSeconds: 240 }, _prewarmedUrl: false,
    } } as any,
    { id: 'qq-downloaded', provider: 'qq', playUrl: 'content://downloads/qq-local', metadata: {
      _libraryLocalFile: 'download:123', _playerPreparationSource: 0, _prewarmedUrl: true,
    } } as any];
  // Keep these fixtures owned by favorites while independently testing process-field stripping.
  state.favorites = state.savedTracks.map(track => track.id);
  const restored = JSON.parse(serializePersistedState(state, 2));
  expect(restored.savedTracks[0].playUrl).toBeUndefined();
  expect(restored.savedTracks[0].metadata).toEqual({ songmid: 'qq-warm' });
  expect(restored.savedTracks[1].playUrl).toBe('file:///music/local.mp3');
  expect(restored.savedTracks[2].playUrl).toBeUndefined();
  expect(restored.savedTracks[2].metadata).toEqual({ songmid: 'qq-played' });
  expect(restored.savedTracks[3].playUrl).toBe('content://downloads/qq-local');
  expect(restored.savedTracks[3].metadata._libraryLocalFile).toBe('download:123');
  expect(state.savedTracks[0]!.playUrl).toBe('https://audio.test/warm');
  expect(metadata._prewarmedUrl).toBe(true);
  await saveState(state);
  expect((await loadState()).savedTracks.every(track => !/^https?:\/\//i.test(track.playUrl ?? ''))).toBe(true);
  await saveState(defaultState());
});

test('restores typed same-id favorite entities and migrates only complete legacy records', () => {
  const current = defaultState();
  current.savedCollections = [
    {id: 'same', provider: 'qq', kind: 'playlists', title: '歌手', description: '', metadata: {collectionKind: 'artist'}},
    {id: 'same', provider: 'qq', kind: 'new-albums', title: '专辑', description: ''},
    {id: 'same', provider: 'qq', kind: 'playlists', title: '歌单', description: ''},
  ];
  current.favoriteCollections = ['qq:same', 'netease:orphan'];
  const restored = normalizeState(current);
  expect(restored.savedCollections).toHaveLength(3);
  expect(restored.favoriteCollections).toEqual(['qq:artist:same', 'qq:album:same', 'qq:playlist:same', 'netease:orphan']);
  expect(normalizeState(restored)).toEqual(restored);
});

test('legacy media bucket keys migrate when the complete entity still lives in the old mixed collection store', () => {
  const current = defaultState();
  current.savedCollections = [{id: 'legacy-radio', title: '真实节目', description: '', provider: 'netease', kind: 'playlists', metadata: {mediaType: 'podcast'}}];
  current.podcastLibrary.favoriteCollections = ['netease:legacy-radio'];
  const restored = normalizeState(current);
  expect(restored.savedCollections).toEqual([]);
  expect(restored.podcastLibrary.savedCollections).toHaveLength(1);
  expect(restored.podcastLibrary.favoriteCollections).toEqual(['netease:podcast:legacy-radio']);
});

test('mixed legacy favorite keys follow complete entities already in typed buckets while incomplete entities remain orphan keys', () => {
  const current = defaultState();
  current.savedCollections = [{id: 'incomplete', provider: 'qq'} as any];
  current.podcastLibrary.savedCollections = [{id: 'legacy-radio', title: '真实节目', description: '', provider: 'netease', kind: 'playlists', metadata: {mediaType: 'podcast'}}];
  current.favoriteCollections = ['netease:legacy-radio', 'qq:incomplete'];
  const restored = normalizeState(current);
  expect(restored.favoriteCollections).toEqual(['qq:incomplete']);
  expect(restored.podcastLibrary.favoriteCollections).toEqual(['netease:podcast:legacy-radio']);
});

test('enables the locked startup autoplay flow on a fresh installation', () => {
  expect(defaultState().settings.startupAutoplay).toBe(true);
});

test('starts with no fabricated search history and normalizes saved entries', () => {
  expect(defaultState().searchHistory).toEqual([]);
  expect(
    normalizeState({
      ...defaultState(),
      searchHistory: ['  晴天 ', '晴天', '', '   ', 42],
    }).searchHistory,
  ).toEqual(['晴天']);
});

test('persists and normalizes the Home catalog launch cursor', () => {
  expect(defaultState().homeCatalogLaunchPage).toBe(0);
  expect(
    normalizeState({
      ...defaultState(),
      homeCatalogLaunchPage: 4.9,
    }).homeCatalogLaunchPage,
  ).toBe(4);
  expect(
    normalizeState({
      ...defaultState(),
      homeCatalogLaunchPage: 'invalid',
    } as any).homeCatalogLaunchPage,
  ).toBe(0);
});

test('repairs the old false startup default once without overriding later choices', () => {
  const current = defaultState();
  const migrated = normalizeState({
    ...current,
    settings: {
      ...current.settings,
      startupAutoplay: false,
      startupAutoplayVersion: undefined,
    },
  });
  expect(migrated.settings.startupAutoplay).toBe(true);
  expect(migrated.settings.startupAutoplayVersion).toBe(1);

  current.settings.startupAutoplay = false;
  expect(normalizeState(current).settings.startupAutoplay).toBe(false);
});

test('migrates legacy mixed platform and source rows into separate collections', () => {
  const legacy = defaultState();
  const migrated = normalizeState({
    ...legacy,
    platforms: undefined,
    sources: [
      { id: 'netease', name: '网易云音乐', enabled: false },
      {
        id: 'source-1',
        name: '墨澜聚合音源',
        enabled: true,
        script: '/* source */',
        healthy: true,
        capabilities: ['tx', 'wy', 'kw', 'kg', 'mg'],
      },
    ],
  });

  expect(migrated.platforms).toHaveLength(6);
  expect(migrated.platforms.find(item => item.id === 'netease')?.enabled).toBe(
    false,
  );
  expect(migrated.sources.map(item => item.name)).toEqual(['墨澜聚合音源']);
});

test('preserves any number of imported source scripts independently', () => {
  const current = defaultState();
  current.sources = Array.from({ length: 5 }, (_, index) => ({
    id: `source-${index}`,
    name: `测试音源 ${index + 1}`,
    enabled: true,
    script: `/* source ${index + 1} */`,
    healthy: undefined,
    capabilities: ['tx', 'wy', 'kw', 'kg', 'mg'],
  }));

  const restored = normalizeState(current);
  expect(restored.sources).toHaveLength(5);
  expect(restored.sources.map(source => source.id)).toEqual([
    'source-0',
    'source-1',
    'source-2',
    'source-3',
    'source-4',
  ]);
});

test('preserves platform switches after the separated state is saved', () => {
  const current = defaultState();
  current.platforms = current.platforms.map(platform =>
    platform.id === 'qq' ? { ...platform, enabled: false } : platform,
  );

  expect(
    normalizeState(current).platforms.find(item => item.id === 'qq')?.enabled,
  ).toBe(false);
});

test('migrates the legacy decorative theme value to the real white-blue theme', () => {
  const current = defaultState();
  const migrated = normalizeState({
    ...current,
    version: 1,
    settings: {
      ...current.settings,
      theme: 'sunset',
      themeSystemVersion: 1,
      accent: '#FF6B35',
    },
  });

  expect(migrated.settings.theme).toBe('white');
  expect(migrated.settings.themeSystemVersion).toBe(2);
  expect(migrated.settings.themePaletteVersion).toBe(1);
  expect(migrated.settings.accent).toBe('#0878FF');
});

test('preserves an explicit theme after the real theme system migration', () => {
  const current = defaultState();
  current.settings = {
    ...current.settings,
    theme: 'night',
    themeSystemVersion: 2,
    themePaletteVersion: 1,
  };

  expect(normalizeState(current).settings.theme).toBe('night');
});

test('migrates and preserves persisted podcast and audiobook collection favorites', () => {
  expect(
    normalizeState({
      ...defaultState(),
      favoriteCollections: undefined,
    }).favoriteCollections,
  ).toEqual([]);

  const current = defaultState();
  current.favoriteCollections = ['netease:radio-1', 'kugou:book-2'];
  expect(normalizeState(current).favoriteCollections).toEqual([
    'netease:radio-1',
    'kugou:book-2',
  ]);
});

test('persists complete collection entities for real library favorite views', () => {
  const current = defaultState();
  const collection = {
    id: 'radio-1',
    title: '真实播客收藏',
    description: '用于恢复收藏页中的完整实体',
    provider: 'netease' as const,
    kind: 'playlist' as const,
    metadata: { mediaType: 'podcast' },
  };
  const restored = normalizeState({
    ...current,
    savedCollections: [collection, collection, null],
  });

  expect(restored.savedCollections).toEqual([]);
  expect(restored.podcastLibrary.savedCollections).toEqual([collection]);
  expect(
    normalizeState({ ...current, savedCollections: undefined })
      .savedCollections,
  ).toEqual([]);
});

test('keeps podcast and audiobook library buckets isolated during migration', () => {
  const current = defaultState();
  const podcastTrack = {
    id: 'same-id',
    title: '播客单集',
    artist: '播客作者',
    album: '播客节目',
    duration: 120,
    provider: 'netease' as const,
    providerId: 'same-id',
    cover: '',
    coverKey: 'train' as const,
    language: '华语' as const,
    genre: '播客',
    mood: '发现',
    releaseYear: 2026,
    metadata: { mediaType: 'podcast' },
  };
  const audiobookTrack = {
    ...podcastTrack,
    title: '听书章节',
    metadata: { mediaType: 'long-audio' },
  };
  const restored = normalizeState({
    ...current,
    savedTracks: [podcastTrack, audiobookTrack],
    favorites: ['same-id'],
    downloads: [
      {
        id: 'podcast-download',
        track: podcastTrack,
        status: 'downloaded',
        createdAt: 1,
      },
      {
        id: 'audiobook-download',
        track: audiobookTrack,
        status: 'downloaded',
        createdAt: 2,
      },
    ],
  });

  expect(restored.savedTracks).toEqual([]);
  expect(restored.podcastLibrary.savedTracks).toEqual([podcastTrack]);
  expect(restored.audiobookLibrary.savedTracks).toEqual([audiobookTrack]);
  expect(restored.podcastLibrary.favorites).toEqual(['same-id']);
  expect(restored.audiobookLibrary.favorites).toEqual(['same-id']);
  expect(restored.downloads).toEqual([]);
  expect(restored.podcastLibrary.downloads).toHaveLength(1);
  expect(restored.audiobookLibrary.downloads).toHaveLength(1);
});

test('splits legacy recent playback by media type and caps each history at 100', () => {
  const current = defaultState();
  const makeTrack = (index: number, mediaType?: 'podcast' | 'long-audio') => ({
    id: `history-${mediaType ?? 'music'}-${index}`,
    title: `历史 ${index}`,
    artist: '测试作者',
    album: '测试专辑',
    duration: 120,
    provider: 'netease' as const,
    providerId: `history-${mediaType ?? 'music'}-${index}`,
    cover: '',
    coverKey: 'train' as const,
    language: '华语' as const,
    genre: '测试',
    mood: '发现',
    releaseYear: 2026,
    ...(mediaType ? { metadata: { mediaType } } : {}),
  });
  const musicHistory = Array.from({ length: 125 }, (_, index) => ({
    track: makeTrack(index),
    playedAt: index,
    listenedSeconds: 0,
    completed: false,
    skipped: false,
  }));
  const podcastHistory = Array.from({ length: 125 }, (_, index) => ({
    track: makeTrack(index, 'podcast'),
    playedAt: index + 1_000,
    listenedSeconds: 0,
    completed: false,
    skipped: false,
  }));
  const restored = normalizeState({
    ...current,
    history: [...musicHistory, ...podcastHistory],
  });

  expect(restored.history).toHaveLength(100);
  expect(restored.history.every(entry => !entry.track.metadata?.mediaType)).toBe(
    true,
  );
  expect(restored.podcastLibrary.history).toHaveLength(100);
  expect(
    restored.podcastLibrary.history.every(
      entry => entry.track.metadata?.mediaType === 'podcast',
    ),
  ).toBe(true);
  expect(restored.history[0]?.playedAt).toBe(124);
  expect(restored.podcastLibrary.history[0]?.playedAt).toBe(1124);
  expect(restored.audiobookLibrary.history).toEqual([]);
});

test('preserves complete metadata for tracks saved before they are played', () => {
  const current = defaultState();
  const track = {
    id: 'qq:123',
    title: '未播放也能收藏',
    artist: '测试歌手',
    album: '测试专辑',
    duration: 188,
    provider: 'qq' as const,
    providerId: '123',
    cover: 'https://img.example/123.jpg',
    coverKey: 'ocean' as const,
    language: '华语' as const,
    genre: '流行',
    mood: '发现',
    releaseYear: 2026,
  };

  const restored = normalizeState({
    ...current,
    savedTracks: [track, track],
    favorites: [track.id],
    playlists: [{ ...current.playlists[0], trackIds: [track.id] }],
  });

  expect(restored.savedTracks).toEqual([track]);
  expect(restored.favorites).toContain(track.id);
  expect(restored.playlists[0].trackIds).toContain(track.id);
});

test('history migration keeps the newest duplicate and identical IDs in separate media buckets', () => {
  const state = defaultState();
  const base = { id: 'same', provider: 'qq', providerId: 'same', metadata: {} } as any;
  const entry = (mediaType: string | undefined, playedAt: number) => ({
    track: { ...base, metadata: mediaType ? { mediaType } : {} },
    playedAt, listenedSeconds: 0, completed: false, skipped: false,
  });
  state.history = [entry(undefined, 10), entry('podcast', 20), entry('long-audio', 30), entry(undefined, 1)];
  const migrated = normalizeState(state);
  expect(migrated.history.map(item => item.playedAt)).toEqual([10]);
  expect(migrated.podcastLibrary.history.map(item => item.playedAt)).toEqual([20]);
  expect(migrated.audiobookLibrary.history.map(item => item.playedAt)).toEqual([30]);
  expect(normalizeState(migrated)).toEqual(migrated);
});

test('display paging never truncates persisted favorites, downloads or local music', () => {
  const state = defaultState();
  state.savedTracks = Array.from({ length: 620 }, (_, index) => ({
    id: `saved-${index}`, provider: 'custom', metadata: {},
  } as any));
  state.favorites = state.savedTracks.map(track => track.id);
  state.localTracks = state.savedTracks;
  state.downloads = state.savedTracks.map(track => ({
    id: track.id, track, status: 'failed', createdAt: 1,
  }));
  const restored = normalizeState(state);
  for (const records of [restored.savedTracks, restored.favorites, restored.downloads, restored.localTracks])
    expect(records).toHaveLength(620);
});

test('round trips independent platform switches and user settings through the persisted state', async () => {
  const state = defaultState();
  const enabledByPlatform = new Map([
    ['netease', false],
    ['qq', true],
    ['kugou', false],
    ['kuwo', true],
    ['migu', false],
  ]);
  state.platforms = state.platforms.map(platform => ({
    ...platform,
    enabled: enabledByPlatform.get(platform.id) ?? platform.enabled,
  }));
  state.settings.multiSourceDetection = false;
  state.settings.quality = 'flac';
  state.settings.theme = 'night';
  state.savedTracks = [{ id: 'saved-after-update', provider: 'qq' } as any];
  state.favorites = ['saved-after-update'];

  await saveState(state);
  const restored = await loadState();

  expect(restored.platforms.filter(platform => enabledByPlatform.has(platform.id)))
    .toEqual(state.platforms.filter(platform => enabledByPlatform.has(platform.id)));
  expect(restored.settings.multiSourceDetection).toBe(false);
  expect(restored.settings.quality).toBe('flac');
  expect(restored.settings.theme).toBe('night');
  expect(restored.favorites).toEqual(['saved-after-update']);
  await saveState(defaultState());
});

test('keeps old persisted data protected when a read or decode fails', async () => {
  const protectedState = defaultState();
  protectedState.settings.multiSourceDetection = false;
  protectedState.platforms = protectedState.platforms.map(platform => ({
    ...platform,
    enabled: platform.id !== 'qq',
  }));
  const protectedRaw = serializePersistedState(protectedState);

  const readFailureFallback = await loadState(async () => {
    throw new Error('native read failed');
  });
  expect(readFailureFallback.settings.multiSourceDetection).toBe(true);
  expect(getStateStorageStatus().readError?.code).toBe('STATE_READ_FAILED');
  await expect(saveState(defaultState())).rejects.toMatchObject({
    code: 'STATE_WRITE_BLOCKED',
  });

  await loadState(async () => {
    throw Object.assign(new Error('state missing after update'), {
      code: 'STATE_MISSING_AFTER_UPDATE',
    });
  });
  expect(getStateStorageStatus().readError?.code).toBe('STATE_MISSING_AFTER_UPDATE');
  await expect(saveState(defaultState())).rejects.toMatchObject({
    code: 'STATE_WRITE_BLOCKED',
  });

  await loadState(async () => '{invalid json');
  expect(getStateStorageStatus().readError?.code).toBe('STATE_JSON_INVALID');
  await expect(saveState(defaultState())).rejects.toMatchObject({
    code: 'STATE_WRITE_BLOCKED',
  });

  const restored = await loadState(async () => protectedRaw);
  expect(getStateStorageStatus().readError).toBeNull();
  expect(restored.settings.multiSourceDetection).toBe(false);
  expect(restored.platforms.find(platform => platform.id === 'qq')?.enabled).toBe(false);
  await saveState(defaultState());
});

test('surfaces save serialization failures as persistent storage diagnostics', async () => {
  const invalid = defaultState() as any;
  invalid.invalidCircularReference = invalid;
  await expect(saveState(invalid)).rejects.toThrow();
  expect(getStateStorageStatus().writeError?.code).toBe('STATE_WRITE_FAILED');
  await saveState(defaultState());
  expect(getStateStorageStatus().writeError).toBeNull();
});
