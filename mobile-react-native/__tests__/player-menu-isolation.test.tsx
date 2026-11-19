import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import App from '../App';
import { useApp } from '../src/state/AppContext';
import { defaultState } from '../src/services/storage';
import { OrderedCoverScope } from '../src/components/OrderedRemoteCover';
import { paletteForTheme } from '../src/theme';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: require('react-native').View,
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));
jest.mock('../src/state/AppContext', () => ({
  useApp: jest.fn(),
  AppProvider: ({ children }: any) => children,
}));
jest.mock('../src/state/useMediaNotification', () => ({
  useMediaNotificationControls: jest.fn(), useMediaNotificationLyrics: jest.fn(),
}));
jest.mock('../src/state/useCarLibrary', () => ({ useCarLibrary: jest.fn() }));
jest.mock('../src/state/usePlaylistClipboard', () => ({ usePlaylistClipboard: jest.fn() }));
jest.mock('../src/screens/HomeScreen', () => ({ HomeScreen: () => null }));
jest.mock('../src/screens/SearchScreen', () => ({ SearchScreen: () => null }));
jest.mock('../src/screens/LibraryScreen', () => ({ LibraryScreen: () => null }));
jest.mock('../src/screens/SettingsScreen', () => ({ SettingsScreen: () => null }));
jest.mock('../src/components/HomePlayerBar', () => ({ HomePlayerBar: () => null }));
jest.mock('../src/components/StartupSplash', () => ({
  ...jest.requireActual('../src/components/StartupSplash'), StartupSplash: () => null,
}));
jest.mock('../src/components/UI', () => ({
  ...jest.requireActual('../src/components/UI'), BottomNav: () => null, Toast: () => null,
}));
jest.mock('../src/components/PlaybackQueueSheet', () => ({ PlaybackQueueSheet: () => null }));
jest.mock('../src/components/HomeMenuDrawer', () => ({
  HomeMenuDrawer: () => null, requestHomeMenuClose: () => false,
}));
// Keep Shell's real reconciliation, cover scope and layout. The child stands in
// for Player's local gesture state so a remount cannot hide behind equal props.
jest.mock('../src/screens/PlayerScreen', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    PlayerBackdrop: () => <View testID="unexpected-player-backdrop" />,
    PlayerScreen: () => {
      const identity = ReactModule.useRef({ offset: -1600, gesture: 7 }).current;
      return <View testID="player-local-state" nativeState={identity} />;
    },
  };
});

test('menu, independent player pages and catalog navigation retain the player session', async () => {
  const app = {
    state: defaultState(), page: 'player', tab: 'discovery', homeMenuOrigin: 'player',
    current: { id: 'prepared-song', provider: 'migu' }, queue: [],
    queuePage: { hasMore: false }, player: { playing: true },
    startup: { visible: false }, ready: true, pageRefreshToken: 0,
    homeRefreshToken: 0, back: jest.fn(),
  } as unknown as ReturnType<typeof useApp>;
  jest.mocked(useApp).mockImplementation(() => app);
  let renderer!: Renderer.ReactTestRenderer;
  await act(async () => { renderer = Renderer.create(<App />); });
  try {
    const page = renderer.root.findByProps({ testID: 'player-local-state' });
    const localState = page.props.nativeState;
    const scope = renderer.root.findAllByType(OrderedCoverScope).find(node =>
      node.findAllByProps({ testID: 'player-local-state' }).length > 0)!;
    const generation = scope.props.generationKey;
    const viewport = renderer.root.findByProps({ testID: 'scaled-viewport' });
    const layout = StyleSheet.flatten(viewport.props.style);
    for (const nextPage of ['home-menu', 'player', 'lyrics', 'player', 'effects', 'player', 'queue', 'player', 'root', 'player', 'playlist', 'player']) {
      app.page = nextPage as typeof app.page;
      if (nextPage === 'playlist') { app.tab = 'library'; app.pageRefreshToken += 1; }
      await act(async () => { renderer.update(<App />); });
      expect(renderer.root.findByProps({ testID: 'player-local-state' })).toBe(page);
      expect(page.props.nativeState).toBe(localState);
      expect(scope.props.generationKey).toBe(generation);
      if (!['root', 'playlist'].includes(nextPage)) expect(StyleSheet.flatten(viewport.props.style)).toEqual(layout);
      const backdrops=renderer.root.findAllByProps({ testID: 'unexpected-player-backdrop' });
      if(nextPage==='lyrics') expect(backdrops.length).toBeGreaterThan(0);
      else expect(backdrops).toHaveLength(0);
      if(nextPage==='effects') {
        const palette=paletteForTheme(app.state.settings.theme, app.state.settings.accent);
        expect(StyleSheet.flatten(renderer.root.findByProps({testID:'app-edge-shell'}).props.style).backgroundColor).toBe(palette.bg);
      }
    }
  } finally {
    await act(async () => renderer.unmount());
  }
});
