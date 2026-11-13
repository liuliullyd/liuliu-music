import { defaultState, normalizeState } from '../src/services/storage';

describe('interrupt playback preference migration', () => {
  test('fresh installations and missing preferences leave interruption off', () => {
    const state = defaultState();
    expect(state.settings.interruptPlayback).toBe(false);
    const { interruptPlayback: _ignored, ...settings } = state.settings;
    expect(normalizeState({ ...state, settings } as any).settings.interruptPlayback).toBe(false);
  });

  test.each([true, false])('preserves explicit interruptPlayback=%s', value => {
    const state = defaultState();
    expect(normalizeState({ ...state, settings: { ...state.settings, interruptPlayback: value } }).settings.interruptPlayback).toBe(value);
  });
  test.each([true, false])(
    'migrates legacy spectrum preference into interruptPlayback=%s once',
    legacyValue => {
      const { interruptPlayback: _ignored, ...legacySettings } =
        defaultState().settings;
      const state = defaultState();
      const restored = normalizeState({
        ...state,
        settings: { ...legacySettings, spectrum: legacyValue },
      } as any);

      expect(restored.settings.interruptPlayback).toBe(legacyValue);
      expect('spectrum' in (restored.settings as object)).toBe(false);
    },
  );

  test.each([true, false])('explicit interruptPlayback=%s wins over the legacy spectrum field', value => {
    const state = defaultState();
    const restored = normalizeState({
      ...state,
      settings: { ...state.settings, spectrum: !value, interruptPlayback: value },
    } as any);

    expect(restored.settings.interruptPlayback).toBe(value);
    expect('spectrum' in (restored.settings as object)).toBe(false);
  });
});
