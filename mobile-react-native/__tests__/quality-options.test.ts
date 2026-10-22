import { playbackQualityOptions, settingsQualityLabel } from '../src/domain/types';
import { defaultState, normalizeState } from '../src/services/storage';

test('exposes the five settings values and player labels in order', () => {
  expect(playbackQualityOptions.map(item => item.settingsLabel)).toEqual([
    '标清',
    '高清',
    '无损',
    '至臻',
    '母带',
  ]);
  expect(playbackQualityOptions.map(item => item.playerLabel)).toEqual([
    '标清',
    '高清',
    '无损',
    '至臻',
    '母带',
  ]);
});

test('round-trips the new flac24bit setting without changing the default', () => {
  expect(defaultState().settings.quality).toBe('320k');
  const state = defaultState();
  const restored = normalizeState({
    ...state,
    settings: { ...state.settings, quality: 'flac24bit' },
  });
  expect(restored.settings.quality).toBe('flac24bit');
});

test.each([
  ['128k', '标清'], ['320k', '高清'], ['flac', '无损'],
  ['flac24bit', '至臻'], ['hires', '母带'],
] as const)('switch feedback uses %s as the real request value and displays %s', (value, label) => {
  expect(settingsQualityLabel(value)).toBe(label);
  expect(playbackQualityOptions.find(option => option.value === value)?.value).toBe(value);
});

test.each(playbackQualityOptions)(
  'legacy download quality inherits $value once and remains independent afterwards',
  ({ value }) => {
    const state = defaultState();
    const legacy = Object.fromEntries(
      Object.entries(state.settings).filter(
        ([key]) => key !== 'downloadQuality',
      ),
    );
    const migrated = normalizeState({
      ...state,
      settings: { ...legacy, quality: value },
    });
    expect(migrated.settings.downloadQuality).toBe(value);
    const restored = normalizeState({
      ...migrated,
      settings: {
        ...migrated.settings,
        quality: value === '128k' ? 'hires' : '128k',
      },
    });
    expect(restored.settings.downloadQuality).toBe(value);
    expect(defaultState().settings.downloadQuality).toBe('320k');
  },
);

test('invalid download quality falls back to the valid saved playback quality', () => {
  const state = defaultState();
  const restored = normalizeState({
    ...state,
    settings: {
      ...state.settings,
      quality: 'flac',
      downloadQuality: 'invalid',
    },
  });
  expect(restored.settings.downloadQuality).toBe('flac');
});
