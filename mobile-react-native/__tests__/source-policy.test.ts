import { filterImportedSources, isImportedSource, isSourceEnabled } from '../src/services/sourcePolicy';
import { defaultState, normalizeState, serializePersistedState } from '../src/services/storage';
import type { SourceSetting } from '../src/domain/types';

const imported: SourceSetting = {id: 'source_test', name: 'User source', script: '/* @name User source */', enabled: true, origin: 'imported'};

test('fresh install has no sources and requires no activation', () => {
  expect(defaultState().sources).toEqual([]);
  expect(normalizeState(null).sources).toEqual([]);
});

test('only locally imported scripts participate in source selection', () => {
  expect(isSourceEnabled(imported)).toBe(true);
  expect(isSourceEnabled({...imported, enabled:false})).toBe(false);
  expect(isImportedSource({...imported, script:''})).toBe(false);
  expect(isImportedSource({...imported, origin:'github'})).toBe(false);
  expect(isImportedSource({...imported, id:'builtin_old'})).toBe(false);
  expect(isImportedSource({...imported, id:'github_source_old'})).toBe(false);
  expect(isImportedSource({...imported, origin:undefined})).toBe(true);
});

test('state and backup retain user scripts but cannot revive old distributed records', () => {
  const state = defaultState();
  state.sources = [imported, {...imported, id:'remote', origin:'github'}, {...imported, id:'builtin_old'}];
  expect(filterImportedSources(state.sources)).toEqual([imported]);
  expect(normalizeState(state).sources).toEqual([imported]);
  const saved = JSON.parse(serializePersistedState(state));
  expect(saved.sources).toEqual([imported]);
  expect(normalizeState(saved).sources).toEqual([imported]);
});
