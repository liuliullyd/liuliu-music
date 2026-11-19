import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import Svg from 'react-native-svg';
import { BottomNav } from '../src/components/UI';
import { adaptivePageMetrics } from '../src/layout';
import { useApp } from '../src/state/AppContext';
import { LayoutProvider } from '../src/state/LayoutContext';
const { readFileSync } = require('fs');
const { join } = require('path');

jest.mock('../src/state/AppContext', () => ({ useApp: jest.fn() }));

let app: ReturnType<typeof useApp>;
let renderer: Renderer.ReactTestRenderer;

beforeEach(() => {
  app = {
    page: 'player',
    tab: 'discovery',
    current: { id: 'current-song' },
    player: { playing: false },
    togglePlay: jest.fn(async () => {}),
    playDefaultTrack: jest.fn(async () => {}),
    open: jest.fn(),
    setTab: jest.fn(),
    refreshHome: jest.fn(),
  } as unknown as ReturnType<typeof useApp>;
  jest.mocked(useApp).mockImplementation(() => app);
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
});

const navElement = (designHeight = 680) => (
  <LayoutProvider designHeight={designHeight}>
    <BottomNav attached transparent={app.page !== 'root'} />
  </LayoutProvider>
);

test.each(['player', 'lyrics', 'effects', 'queue'] as const)('%s selects only the center playback navigation', async page => {
  app.page = page;
  await renderNav();
  expect(renderer.root.findByProps({ testID: 'nav-player' }).props.accessibilityState.selected).toBe(true);
  for (const tab of ['discovery', 'search', 'library', 'settings']) {
    expect(renderer.root.findByProps({ testID: `nav-${tab}` }).props.accessibilityState.selected).toBe(false);
  }
});

const renderNav = async (designHeight = 680) => {
  await act(async () => {
    renderer = Renderer.create(navElement(designHeight));
  });
};

test.each(['player', 'home'] as const)('menu opened from %s retains its underlying navigation', async origin => {
  app.page = origin === 'player' ? 'player' : 'root';
  await renderNav();
  const buttonStyle = () => StyleSheet.flatten(
    renderer.root.findByProps({ testID: 'nav-player-button' }).props.style,
  );
  const originalStyle = buttonStyle();
  const originalRingCount = renderer.root.findAllByProps({ testID: 'nav-player-activity' }).length;
  app.page = 'home-menu';
  app.homeMenuOrigin = origin;
  await act(async () => renderer.update(navElement()));
  expect(buttonStyle()).toEqual(originalStyle);
  expect(renderer.root.findByProps({ testID: 'nav-player' }).props.accessibilityState.selected).toBe(origin === 'player');
  expect(renderer.root.findByProps({ testID: 'nav-discovery' }).props.accessibilityState.selected).toBe(origin === 'home');
  expect(renderer.root.findAllByProps({ testID: 'nav-player-activity' })).toHaveLength(originalRingCount);
});

test.each<['player' | 'lyrics', number, boolean]>([
  ['player', 560, false],
  ['player', 560, true],
  ['player', 680, false],
  ['player', 680, true],
  ['player', 1000, false],
  ['player', 1000, true],
  ['lyrics', 560, false],
  ['lyrics', 560, true],
  ['lyrics', 680, false],
  ['lyrics', 680, true],
  ['lyrics', 1000, false],
  ['lyrics', 1000, true],
])(
  '%s has the shared centered ring without a lower shadow at height %s, playing=%s',
  async (page, height, playing) => {
    app.page = page;
    app.player.playing = playing;
    await renderNav(height);
    const layout = adaptivePageMetrics(height);
    const button = renderer.root.findByProps({ testID: 'nav-player-button' });
    const style = StyleSheet.flatten(button.props.style);
    expect(style).toMatchObject({
      width: layout.bottomNavPlayerSize,
      height: layout.bottomNavPlayerSize,
      borderRadius: layout.bottomNavPlayerSize / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.72)',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    });
    expect(style.transform).toBeUndefined();
    const icon = button.findByType(Svg);
    expect(icon.props.width).toBe(
      Math.round(layout.bottomNavPlayerSize * 0.52),
    );
    expect(icon.props.height).toBe(icon.props.width);
    expect(icon.props.viewBox).toBe('0 0 24 24');
    const nav = renderer.root.findByProps({ testID: 'bottom-nav' });
    expect(StyleSheet.flatten(nav.props.style)).toMatchObject({
      backgroundColor: 'transparent',
      height: layout.bottomNavHeight,
      transform: [{ translateY: -layout.bottomNavLift }],
    });
    const discoveryLabel = nav
      .findByProps({ testID: 'nav-discovery' })
      .findByType(Text);
    expect(StyleSheet.flatten(discoveryLabel.props.style).fontSize).toBe(
      layout.bottomNavLabelFontSize,
    );
    const action = renderer.root.findByProps({ testID: 'nav-player' });
    expect(action.props.hitSlop).toBe(8);
    expect(StyleSheet.flatten(action.props.style).minHeight).toBe(
      layout.bottomNavHeight,
    );
    expect(action.props.accessibilityLabel).toBe(playing ? '暂停' : '播放');
    await act(async () => action.props.onPress());
    expect(app.togglePlay).toHaveBeenCalledTimes(1);
    expect(app.open).not.toHaveBeenCalled();
    expect(app.playDefaultTrack).not.toHaveBeenCalled();
  },
);

test('the mounted navigation retains the same ring across page and playback-state changes', async () => {
  await renderNav();
  const originalStyle = StyleSheet.flatten(
    renderer.root.findByProps({ testID: 'nav-player-button' }).props.style,
  );
  for (const page of ['player', 'lyrics', 'player'] as const) {
    for (const playing of [true, false]) {
      app.page = page;
      app.player.playing = playing;
      await act(async () => renderer.update(navElement()));
      const button = renderer.root.findByProps({ testID: 'nav-player-button' });
      expect(StyleSheet.flatten(button.props.style)).toEqual(originalStyle);
      const action = renderer.root.findByProps({ testID: 'nav-player' });
      expect(action.props.accessibilityLabel).toBe(playing ? '暂停' : '播放');
      expect(action.props.accessibilityState).toEqual({
        selected: true,
        busy: playing,
      });
      expect(app.togglePlay).not.toHaveBeenCalled();
      expect(app.playDefaultTrack).not.toHaveBeenCalled();
      expect(app.open).not.toHaveBeenCalled();
    }
  }
});

test.each(['root', 'queue', 'effects'] as const)(
  '%s keeps its existing button appearance and action',
  async page => {
    app.page = page;
    await renderNav();
    const style = StyleSheet.flatten(
      renderer.root.findByProps({ testID: 'nav-player-button' }).props.style,
    );
    expect(style).toMatchObject({
      borderWidth: 0,
      shadowColor: '#9D6CF4',
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: 5,
      backgroundColor: page === 'queue' ? 'transparent' : '#B17CFA',
    });
    await act(async () =>
      renderer.root.findByProps({ testID: 'nav-player' }).props.onPress(),
    );
    if (page === 'root') {
      expect(app.open).toHaveBeenCalledWith('player');
      expect(app.togglePlay).not.toHaveBeenCalled();
    } else {
      expect(app.togglePlay).toHaveBeenCalledTimes(1);
      expect(app.open).not.toHaveBeenCalled();
    }
  },
);

test('the native system bars have no static color layer behind the player', () => {
  const styles = readFileSync(
    join(__dirname, '../android/app/src/main/res/values/styles.xml'),
    'utf8',
  );
  expect(styles).toContain(
    'android:statusBarColor">@android:color/transparent',
  );
  expect(styles).toContain(
    'android:navigationBarColor">@android:color/transparent',
  );
  expect(styles).not.toContain('android:statusBarColor">#F5F9FF');
  expect(styles).not.toContain('android:navigationBarColor">#F5F9FF');
});

test.each(['player', 'lyrics', 'effects', 'root'] as const)(
  '%s without a current song retains the shared default-play action',
  async page => {
    app.page = page;
    app.current = null;
    await renderNav();
    await act(async () =>
      renderer.root.findByProps({ testID: 'nav-player' }).props.onPress(),
    );
    expect(app.playDefaultTrack).toHaveBeenCalledTimes(1);
    expect(app.togglePlay).not.toHaveBeenCalled();
    expect(app.open).not.toHaveBeenCalled();
  },
);
