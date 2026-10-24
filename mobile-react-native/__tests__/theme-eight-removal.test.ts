import { NativeModules } from 'react-native';
import { themeOptions, themesForFilter } from '../src/themeCatalog';
import { themeBackgroundArtwork } from '../src/assets/themeBackgrounds';
import { paletteForTheme, themeDefaultAccents } from '../src/theme';
import {
  readStartupAppearance,
  STARTUP_PALETTES,
} from '../src/components/StartupSplash';
import { defaultState, normalizeState } from '../src/services/storage';

const retired = [
  'anime-youth',
  'anime-moon',
  'sport-ski',
  'sport-skate',
  'film-road',
  'film-ocean',
  'curated-vinyl',
  'curated-stars',
] as const;
jest.mock('../src/state/AppContext', () => ({ useApp: jest.fn() }));

test('theme directory and bundled artwork expose the same 24 retained themes', () => {
  expect(themeOptions).toHaveLength(24);
  expect(Object.keys(themeBackgroundArtwork).sort()).toEqual(
    themeOptions.map(option => option.id).sort(),
  );
  expect(Object.keys(themeDefaultAccents).sort()).toEqual(
    themeOptions.map(option => option.id).sort(),
  );
  expect(Object.keys(STARTUP_PALETTES).sort()).toEqual(
    themeOptions.map(option => option.id).sort(),
  );
});

test.each([
  ['classic', 8],
  ['anime', 4],
  ['sports', 4],
  ['film', 4],
  ['featured', 4],
] as const)('%s retains %i themes', (category, count) => {
  expect(themesForFilter(category)).toHaveLength(count);
});

test.each(retired)(
  '%s is absent from the catalog, artwork and palette registries',
  id => {
    expect(themeOptions.some(option => String(option.id) === id)).toBe(false);
    expect(themeBackgroundArtwork).not.toHaveProperty(id);
    expect(themeDefaultAccents).not.toHaveProperty(id);
    expect(STARTUP_PALETTES).not.toHaveProperty(id);
  },
);

test.each(retired)(
  'persisted %s selection returns to white without changing other settings or music data',
  id => {
    const state = defaultState();
    const input = JSON.parse(
      JSON.stringify({
        ...state,
        favorites: ['saved-song'],
        settings: {
          ...state.settings,
          theme: id,
          accent: '#123456',
          startupAutoplay: false,
          autoNext: false,
        },
      }),
    );
    const result = normalizeState(input);
    const retainedSettings = normalizeState({
      ...input,
      settings: { ...input.settings, theme: 'white', accent: '#0878FF' },
    }).settings;
    expect(result.settings.theme).toBe('white');
    expect(result.settings.accent).toBe('#0878FF');
    expect(result.settings).toEqual(retainedSettings);
    expect(result.favorites).toEqual(input.favorites);
    expect(result.playlists).toEqual(input.playlists);
    expect(result.history).toEqual(input.history);
  },
);

test.each(retired)(
  'native startup mirror for %s also returns to the white default accent',
  id => {
    const original = NativeModules.LiuliuStorage;
    try {
      NativeModules.LiuliuStorage = {
        startupTheme: id,
        startupAccent: '#123456',
      };
      expect(readStartupAppearance()).toEqual({
        theme: 'white',
        accent: '#0878FF',
      });
    } finally {
      NativeModules.LiuliuStorage = original;
    }
  },
);

test('retained themes keep valid palettes and a saved custom accent', () => {
  for (const option of themeOptions) {
    expect(paletteForTheme(option.id).id).toBe(option.id);
    const input = defaultState();
    input.settings.theme = option.id;
    input.settings.accent = '#123456';
    expect(normalizeState(input).settings.theme).toBe(option.id);
    expect(normalizeState(input).settings.accent).toBe('#123456');
  }
});
