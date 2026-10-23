import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { CollectionDetail } from '../src/screens/HomeScreen';
import {
  PlaylistInformationGradient,
  PlaylistInformationSurface,
} from '../src/components/PlaylistInformationSurface';
import { defaultState } from '../src/services/storage';
import { ThemeProvider } from '../src/theme';
import type { CatalogItem, Track } from '../src/domain/types';

let mockApp: any;
let mockPages: any;
jest.mock('../src/state/AppContext', () => ({ useApp: () => mockApp }));
jest.mock('../src/state/useCollectionPages', () => ({
  useCollectionPages: () => mockPages,
}));
jest.mock('../src/components/ResilientHomeCover', () => ({
  ResilientHomeCover: () => null,
}));

const track: Track = {
  id: 'song-1',
  providerId: '1',
  provider: 'netease',
  title: '歌曲',
  artist: '歌手',
  album: '专辑',
  duration: 180,
  coverKey: 'train',
  language: '华语',
  genre: '流行',
  mood: '轻松',
  releaseYear: 2026,
};
const item: CatalogItem = {
  id: 'playlist-1',
  kind: 'playlists',
  provider: 'netease',
  title: '歌单',
  description: '描述',
  cover: '',
};

beforeEach(() => {
  mockApp = {
    page: 'playlist-detail',
    tab: 'discovery',
    state: defaultState(),
    current: null,
    back: jest.fn(),
    isFavorite: jest.fn(() => false),
    toggleFavorite: jest.fn(),
    isCollectionFavorite: jest.fn(() => false),
    toggleCollectionFavorite: jest.fn(),
    playTrack: jest.fn(async () => undefined),
    setPlaybackMode: jest.fn(),
    downloadTrack: jest.fn(),
    notify: jest.fn(),
    prewarmDetailTracks: jest.fn(),
    releaseDetailPrewarm: jest.fn(),
  };
  mockPages = {
    tracks: [track],
    offset: 1,
    hasMore: false,
    loading: false,
    error: '',
    kind: 'playlists',
    loadMore: jest.fn(),
  };
});

test.each([
  { entry: 'all playlists', tab: 'discovery' },
  { entry: 'roam collection', tab: 'library', libraryAppearance: true },
  { entry: 'search collection', tab: 'search', searchAppearance: true },
  {
    entry: 'new releases reference',
    tab: 'discovery',
    homeReferenceAppearance: true,
  },
])(
  '$entry has one bottom fade below the controls before and after sticking',
  async props => {
    mockApp.tab = props.tab;
    let view!: Renderer.ReactTestRenderer;
    await act(async () => {
      view = Renderer.create(
        <ThemeProvider id="nature">
          <CollectionDetail item={item} {...props} />
        </ThemeProvider>,
      );
    });
    try {
      const header = view.root.findByType(PlaylistInformationSurface);
      expect(header.findAllByType(PlaylistInformationGradient)).toHaveLength(0);
      expect(view.root.findAllByType(PlaylistInformationGradient)).toHaveLength(
        1,
      );
      const controls = view.root.findByProps({
        testID: 'playlist-sticky-actions',
      });
      expect(StyleSheet.flatten(controls.props.style).backgroundColor).toBe(
        StyleSheet.flatten(
          header.findByProps({ testID: 'playlist-information-surface' }).props
            .style,
        ).backgroundColor,
      );
      await act(async () => {
        controls.props.onLayout({
          nativeEvent: { layout: { y: 280, height: 72 } },
        });
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
      expect(mockApp.playTrack).not.toHaveBeenCalled();
    } finally {
      await act(async () => view.unmount());
    }
  },
);
