import { loadHomeMenuFirstBatch } from '../src/services/homeMenuDiscovery';
jest.mock('../src/services/homeMenuDiscovery', () => ({
  ...jest.requireActual('../src/services/homeMenuDiscovery'),
  loadHomeMenuFirstBatch: jest.fn(async () => ({ tracks: [], hasMore: false })),
}));
/**
 * @format
 */

import React from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import {
  completedEdgeBack,
  completedEdgeBackFrom,
  isEdgeBackStart,
  shouldStartEdgeBack,
  shouldStartEdgeBackFrom,
} from '../src/edgeBackGesture';
import { defaultState, loadState } from '../src/services/storage';
import { loadCategoryFeed } from '../src/services/liveDiscovery';
import { nativePlayer } from '../src/services/nativePlayer';

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) =>
      ReactModule.createElement(View, props, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('../src/services/storage', () => {
  const actual = jest.requireActual('../src/services/storage');
  return {
    ...actual,
    loadState: jest.fn(async () => actual.defaultState()),
    saveState: jest.fn(async () => undefined),
    probeAudioUrl: jest.fn(async () => ({
      durationSeconds: 180,
      sampleBytes: 4096,
    })),
    importSourceScript: jest.fn(async () => ({
      fileName: 'test-source.js',
      content:
        '/*\n * @name 测试音源\n * @description Android 导入回归\n * @author 六六\n * @version 1.0.0\n */\n',
    })),
    testImportedSourceScript: jest.fn(async () => ({
      ok: true,
      message: '脚本初始化通过',
      sources: ['kw', 'wy'],
    })),
  };
});
jest.mock('../src/services/onlineCatalog', () => ({
  ...jest.requireActual('../src/services/onlineCatalog'),
  getCatalog: jest.fn(async () => []),
}));
jest.mock('../src/services/homeNewReleases', () => ({
  ...jest.requireActual('../src/services/homeNewReleases'),
  loadMixedHomeChartPage: jest.fn(async () => ({ tracks: [], hasMore: false })),
}));
jest.mock('../src/services/liveDiscovery', () => ({
  startPlatformHealthDetection: jest.fn((...args) =>
    require('../test-support/launchHealthMock').launchHealthMock(
      require('../src/services/liveDiscovery').detectHealthyPlatforms,
      ...args,
    ),
  ),
  loadDesktopHealthSample: jest.fn(async provider => ({
    id: `${provider}-sample`,
    title: '榜单歌曲',
    artist: '测试歌手',
    album: '测试专辑',
    duration: 180,
    provider,
    providerId: `${provider}-1`,
    coverKey: 'train',
    language: '华语',
    genre: '流行',
    mood: '发现',
    releaseYear: 2026,
  })),
  loadCategoryFeed: jest.fn(async () => []),
  orderedHealthyProviders: jest.fn(() => [
    'netease',
    'qq',
    'kugou',
    'kuwo',
    'migu',
  ]),
  detectHealthyPlatforms: jest.fn(async () => ({
    healthy: ['netease', 'qq', 'kugou', 'kuwo', 'migu'],
    first: 'netease',
    sourceIds: [],
    sourceIdsByProvider: {},
    backendByProvider: {},
    byProvider: {},
  })),
}));
jest.mock('../src/services/sourceRuntime', () => ({
  ...jest.requireActual('../src/services/sourceRuntime'),
  clearResolvedSourceCache: jest.fn(),
  resetLaunchBackendPools: jest.fn(),
  probeStartupSource: jest.fn(async () => ({
    url: 'https://audio.example/source-health.mp3',
    quality: '128k',
    sourceId: 'source',
    backend: '测试后端',
    probe: { sampleBytes: 65_536 },
  })),
}));
jest.mock('../src/services/onlineMusic', () => ({
  ...jest.requireActual('../src/services/onlineMusic'),
  resolvePlaybackWithQuality: jest.fn(async (...args: any[]) => ({
    url: await require('../src/services/onlineMusic').resolvePlayback(
      ...args.slice(0, 3),
    ),
    quality: args[0]?.metadata?._playbackQuality ?? '320k',
  })),
  trackLyricsKey: jest.requireActual('../src/services/onlineMusic')
    .trackLyricsKey,
  getCachedTrackLyrics: jest.fn(),
  searchOnline: jest.fn(async () => ({
    tracks: [
      {
        id: 'test-track',
        title: '测试歌曲',
        artist: '测试歌手',
        album: '测试专辑',
        duration: 180,
        provider: 'netease',
        providerId: '1',
        coverKey: 'train',
        language: '华语',
        genre: '流行',
        mood: '发现',
        releaseYear: 2026,
      },
    ],
    errors: [],
  })),
  searchOnlinePlaylists: jest.fn(async () => ({ items: [], errors: [] })),
  testOnlineSource: jest.fn(async () => ({
    message: '网易云音乐公开搜索接口正常',
    sample: {
      id: 'sample',
      title: '晴天',
      artist: '周杰伦',
      album: '',
      duration: 269,
      provider: 'netease',
      providerId: '186016',
      coverKey: 'train',
      language: '华语',
      genre: '流行',
      mood: '发现',
      releaseYear: 2003,
    },
  })),
  resolvePlayback: jest.fn(async () => 'https://audio.example/song.mp3'),
  getArtistTracks: jest.fn(async () => []),
  getTrackLyrics: jest.fn(async () => []),
  getAlbumDetail: jest.fn(async () => ({ tracks: [] })),
}));

import {
  importSourceScript,
  testImportedSourceScript,
  saveState,
} from '../src/services/storage';
jest.mock('../src/state/useDesktopLyrics', () => ({
  DesktopLyricsBridge: () => null,
}));
jest.mock('../src/screens/HomeScreen', () => ({ HomeScreen: () => null }));

let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(async () => {
  if (renderer) await ReactTestRenderer.act(async () => renderer!.unmount());
  renderer = undefined;
});

async function openSources() {
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(
    () => new Promise<void>(resolve => setTimeout(resolve, 30)),
  );
  await ReactTestRenderer.act(async () =>
    renderer!.root.findByProps({ testID: 'nav-settings' }).props.onPress(),
  );
  await ReactTestRenderer.act(async () =>
    renderer!.root.findByProps({ testID: 'settings-sources' }).props.onPress(),
  );
  return renderer!.root;
}
async function importFile() {
  await ReactTestRenderer.act(async () => {
    await renderer!.root
      .findByProps({ testID: 'import-source-button' })
      .props.onPress();
  });
}
const status = () =>
  String(
    renderer!.root.findByProps({ testID: 'source-import-status' }).props
      .children,
  );
const sourceRows = () =>
  renderer!.root.findAll(
    node => node.type === View && node.props.testID === 'imported-source',
  );

test('Home, Library and Search expose only music features', async () => {
  await openSources();
  for (const tab of ['discovery', 'library', 'search']) {
    await ReactTestRenderer.act(async () =>
      renderer!.root.findByProps({ testID: `nav-${tab}` }).props.onPress(),
    );
    const view = renderer!.root;
    expect(
      view.findAll(
        node =>
          typeof node.props.testID === 'string' &&
          /home-top-(podcast|audiobook)|library-mode-(podcast|audiobook)|home-deferred-(podcast|audiobook)/.test(
            node.props.testID,
          ),
      ),
    ).toHaveLength(0);
    const labels = view
      .findAll(node => node.type === Text)
      .map(node => node.props.children)
      .flat(Infinity);
    expect(labels).not.toContain('播客');
    expect(labels).not.toContain('听书');
  }
});

test('fresh app opens settings without sources or a passphrase flow', async () => {
  const view = await openSources();
  expect(view.findAllByProps({ testID: 'settings-car-connection' })).toHaveLength(0);
  expect(
    view.findAllByProps({ accessibilityLabel: '车载互联与蓝牙' }),
  ).toHaveLength(0);
  expect(view.findByProps({ testID: 'settings-playback-panel' })).toBeTruthy();
  expect(view.findByProps({ testID: 'settings-theme-grid' })).toBeTruthy();
  expect(view.findByProps({ testID: 'source-empty-state' })).toBeTruthy();
  expect(
    view.findByProps({ testID: 'import-source-button' }).props.disabled,
  ).toBe(false);
  expect(
    view.findAllByProps({ testID: 'source-activation-button' }),
  ).toHaveLength(0);
  expect(
    view.findAllByProps({ testID: 'source-hidden-controls-trigger' }),
  ).toHaveLength(0);
  expect(view.findAllByProps({ testID: 'refresh-source-button' })).toHaveLength(
    0,
  );
  expect(testImportedSourceScript).not.toHaveBeenCalled();
});
test('cancelling the system file picker leaves the source list empty', async () => {
  jest.mocked(importSourceScript).mockResolvedValueOnce(null);
  await openSources();
  await importFile();
  expect(sourceRows()).toHaveLength(0);
  expect(status()).toBe('已取消导入');
  expect(testImportedSourceScript).not.toHaveBeenCalled();
});
test('invalid uploaded metadata is rejected before runtime initialization', async () => {
  jest
    .mocked(importSourceScript)
    .mockResolvedValueOnce({ fileName: 'invalid.js', content: 'invalid' });
  await openSources();
  await importFile();
  expect(sourceRows()).toHaveLength(0);
  expect(status()).toContain('缺少头部注释');
  expect(testImportedSourceScript).not.toHaveBeenCalled();
});
test('failed runtime initialization does not persist a source', async () => {
  jest
    .mocked(testImportedSourceScript)
    .mockResolvedValueOnce({ ok: false, sources: [], message: 'failed' });
  await openSources();
  await importFile();
  expect(sourceRows()).toHaveLength(0);
  expect(status()).toBe('检测未通过');
});
test('uploaded source is saved locally, duplicate import rejected, and source can be deleted', async () => {
  await openSources();
  await importFile();
  expect(sourceRows()).toHaveLength(1);
  expect(status()).toBe('音源已导入并保存');
  await ReactTestRenderer.act(
    () => new Promise<void>(resolve => setTimeout(resolve, 220)),
  );
  const saved = jest
    .mocked(saveState)
    .mock.calls.map(call => call[0])
    .filter(state => state.sources.length);
  expect(saved.length).toBeGreaterThan(0);
  const source = saved[saved.length - 1]!.sources[0]!;
  expect(source.origin).toBe('imported');
  expect(source.script).toContain('@name 测试音源');
  await importFile();
  expect(sourceRows()).toHaveLength(1);
  expect(status()).toContain('已存在相同版本');
  await ReactTestRenderer.act(async () =>
    renderer!.root
      .findByProps({ testID: 'delete-source-button' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(async () =>
    renderer!.root
      .findByProps({ testID: 'select-delete-source-' + source.id })
      .props.onPress(),
  );
  await ReactTestRenderer.act(async () => {
    await renderer!.root
      .findByProps({ testID: 'confirm-delete-source' })
      .props.onPress();
  });
  expect(sourceRows()).toHaveLength(0);
  expect(
    renderer!.root.findByProps({ testID: 'source-empty-state' }),
  ).toBeTruthy();
});
