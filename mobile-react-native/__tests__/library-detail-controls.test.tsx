import React from 'react';
import { Image, ScrollView, StyleSheet } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { LibraryScreen } from '../src/screens/LibraryScreen';
import { LibraryPlaylistActions } from '../src/components/LibraryPlaylistActions';
import {
  PlaylistInformationGradient,
  PlaylistInformationSurface,
} from '../src/components/PlaylistInformationSurface';
import { PlaybackModePicker } from '../src/components/PlaybackModePicker';
import { defaultState } from '../src/services/storage';
import { ThemeProvider } from '../src/theme';
import type { Track } from '../src/domain/types';

let mockApp: any;
jest.mock('../src/screens/HomeScreen', () => ({
  CollectionDetail: () => null,
}));
jest.mock('../src/state/useLibraryPlaylists', () => ({
  useLibraryPlaylists: () => ({
    items: [],
    loading: false,
    error: '',
    hasMore: false,
  }),
}));
jest.mock('../src/state/AppContext', () => ({
  useApp: () => mockApp,
  useCatalogViewState: (key: string, initial: unknown) =>
    require('react').useState(mockApp.catalogViewState.get(key) ?? initial),
}));
jest.mock('../src/services/libraryArtwork', () => ({
  sampleLibraryCoverEdgeColor: jest.fn(async () => '#376150'),
}));
const tracks: Track[] = ['one', 'two'].map(id => ({
  id,
  title: id,
  provider: 'custom',
  playUrl: `content://media/external/audio/media/${id}`,
  artist: '歌手',
  album: '专辑',
  duration: 180,
  coverKey: 'ocean',
  language: '华语',
  genre: '流行',
  mood: '平静',
  releaseYear: 2026,
}));
beforeEach(() => {
  jest
    .spyOn(Image, 'resolveAssetSource')
    .mockReturnValue({
      uri: 'bundled_ocean',
      width: 168,
      height: 168,
      scale: 1,
    });
  const state = defaultState();
  state.localTracks = tracks;
  state.savedTracks = tracks;
  state.favorites = tracks.map(track => track.id);
  mockApp = {
    state,
    page: 'local',
    current: null,
    recommendationPlatforms: [],
    catalogViewState: new Map(),
    open: jest.fn(),
    back: jest.fn(),
    playTrack: jest.fn(async () => undefined),
    isFavorite: jest.fn(() => true),
    toggleFavorite: jest.fn(),
    isCollectionFavorite: jest.fn(() => false),
    toggleCollectionFavorite: jest.fn(),
    setPlaybackMode: jest.fn(),
    downloadTrack: jest.fn(),
    notify: jest.fn(),
    scanLocalMusic: jest.fn(async () => undefined),
    addLocalMusicDirectory: jest.fn(async () => undefined),
    removeLocalTrack: jest.fn(),
    removeLocalTracks: jest.fn(),
  };
});
afterEach(() => jest.restoreAllMocks());
async function render() {
  let view!: Renderer.ReactTestRenderer;
  await act(async () => {
    view = Renderer.create(
      <ThemeProvider id="nature">
        <LibraryScreen />
      </ThemeProvider>,
    );
  });
  return view;
}
const style = (node: Renderer.ReactTestInstance) =>
  StyleSheet.flatten(node.props.style);

test.each(['favorites', 'downloads', 'local'])(
  '%s title has no repeated bottom fade',
  async page => {
    mockApp.page = page;
    const view = await render();
    try {
      const header = view.root.findByType(PlaylistInformationSurface);
      expect(header.findAllByType(PlaylistInformationGradient)).toHaveLength(0);
      expect(view.root.findAllByType(PlaylistInformationGradient)).toHaveLength(
        1,
      );
      const controls = view.root.findByProps({
        testID: 'library-reference-action-surface',
      });
      expect(style(controls).backgroundColor).toBe(
        style(header.findByProps({ testID: 'playlist-information-surface' }))
          .backgroundColor,
      );
    } finally {
      await act(async () => view.unmount());
    }
  },
);

test('local controls fit the design canvas in two complete sticky rows and preserve actions', async () => {
  const view = await render();
  try {
    const primary = view.root.findByProps({
      testID: 'library-playlist-primary-actions',
    });
    const local = view.root.findByProps({
      testID: 'library-playlist-local-actions',
    });
    const ids = [
      'library-action-favorite',
      'library-action-download',
      'library-list-play-all',
    ];
    const buttons = ids.map(testID => primary.findByProps({ testID }));
    const mode = primary.findByType(PlaybackModePicker);
    const toolIds = [
      'library-scan-local',
      'library-add-local',
      'library-delete-all-local',
    ];
    const tools = toolIds.map(testID => local.findByProps({ testID }));
    const width = (
      nodes: Renderer.ReactTestInstance[],
      row: Renderer.ReactTestInstance,
    ) =>
      nodes.reduce(
        (sum, node) =>
          sum + Math.max(style(node).width ?? 0, style(node).minWidth ?? 0),
        0,
      ) +
      style(row).gap * (nodes.length - 1);
    expect(width([...buttons, mode], primary)).toBeLessThanOrEqual(420 - 24);
    expect(width(tools, local)).toBeLessThanOrEqual(420 - 24);
    for (const row of [primary, local]) expect(style(row).height).toBe(72);
    expect(
      style(view.root.findByProps({ testID: 'library-list-controls' })).height,
    ).toBe(144);
    expect(
      style(
        view.root.findByProps({ testID: 'library-reference-action-surface' }),
      ).height,
    ).toBe(144);
    await act(async () => tools[0]!.props.onPress());
    await act(async () => tools[1]!.props.onPress());
    expect(mockApp.scanLocalMusic).toHaveBeenCalledTimes(1);
    expect(mockApp.addLocalMusicDirectory).toHaveBeenCalledTimes(1);
    await act(async () => buttons[0]!.props.onPress());
    expect(
      mockApp.toggleFavorite.mock.calls.map((call: any[]) => call[0]),
    ).toEqual(tracks);
    await act(async () => buttons[2]!.props.onPress());
    expect(mockApp.playTrack).toHaveBeenCalledWith(
      tracks[0],
      tracks,
      0,
      expect.objectContaining({ bulkPlay: true }),
    );
    await act(async () => tools[2]!.props.onPress());
    expect(
      view.root.find(
        node =>
          typeof node.type === 'function' &&
          node.type.name === 'TrackDeleteModal',
      ).props.tracks,
    ).toEqual(tracks);
    expect(mockApp.removeLocalTracks).not.toHaveBeenCalled();
    await act(async () => {
      view.root
        .findByProps({ testID: 'library-list-controls' })
        .props.onLayout({ nativeEvent: { layout: { y: 280, height: 144 } } });
      view.root.findByType(ScrollView).props.onScroll({
        nativeEvent: {
          contentOffset: { x: 0, y: 320 },
          contentSize: { height: 1500 },
          layoutMeasurement: { height: 600 },
        },
      });
    });
    expect(view.root.findAllByType(PlaylistInformationGradient)).toHaveLength(
      1,
    );
  } finally {
    await act(async () => view.unmount());
  }
});

test('empty local list keeps scan/add enabled and disables destructive/play actions', async () => {
  mockApp.state.localTracks = [];
  const view = await render();
  try {
    for (const testID of [
      'library-action-favorite',
      'library-action-download',
      'library-list-play-all',
      'library-delete-all-local',
    ]) {
      expect(view.root.findByProps({ testID }).props.disabled).toBe(true);
    }
    for (const testID of ['library-scan-local', 'library-add-local']) {
      expect(view.root.findByProps({ testID }).props.disabled).toBeUndefined();
    }
  } finally {
    await act(async () => view.unmount());
  }
});

test('ordinary list retains its original single-row action layout', async () => {
  let view!: Renderer.ReactTestRenderer;
  await act(async () => {
    view = Renderer.create(
      <ThemeProvider id="nature">
        <LibraryPlaylistActions tracks={tracks} />
      </ThemeProvider>,
    );
  });
  try {
    expect(
      style(view.root.findByProps({ testID: 'library-playlist-actions' }))
        .height,
    ).toBe(72);
    expect(
      view.root.findAllByProps({ testID: 'library-playlist-local-actions' }),
    ).toHaveLength(0);
    expect(view.root.findAllByType(PlaybackModePicker)).toHaveLength(1);
  } finally {
    await act(async () => view.unmount());
  }
});
