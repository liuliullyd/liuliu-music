import type { SourceSetting, Track } from '../src/domain/types';
import {
  clearResolvedSourceCache,
  sourceAddressCacheKey,
} from '../src/services/sourceRuntime';

const track = (id: string): Track => ({
  id, providerId: id, provider: 'kuwo', title: id, artist: '艺人',
  album: '专辑', duration: 240, coverKey: 'train', language: '华语',
  genre: '流行', mood: '发现', releaseYear: 2026,
});
const source = (script: string): SourceSetting => ({
  id: 'fingerprint-source', name: '导入源', version: '1',
  enabled: true, healthy: true, script, capabilities: ['kw'],
});

beforeEach(clearResolvedSourceCache);
afterEach(() => jest.restoreAllMocks());

test('queue cache checks reuse an unchanged script across tracks and cloned source settings', () => {
  const setting = source('unchanged-source-script;'.repeat(128));
  const charCodeAt = jest.spyOn(String.prototype, 'charCodeAt');
  sourceAddressCacheKey(track('first'), [setting], 'hires');
  expect(charCodeAt).toHaveBeenCalledTimes(setting.script!.length);
  charCodeAt.mockClear();

  for (let index = 0; index < 24; index += 1) {
    sourceAddressCacheKey(track(`queue-${index}`), [{ ...setting }], 'hires');
    sourceAddressCacheKey(track(`queue-${index}`), [{ ...setting, pinnedBackend: 'route-b' }], 'flac');
  }
  expect(charCodeAt).not.toHaveBeenCalled();
});

test('replacing script content invalidates the key even when source id and version stay unchanged', () => {
  const setting = source('source-script-A');
  const song = track('same-song');
  const original = sourceAddressCacheKey(song, [setting], 'hires');
  setting.script = 'source-script-B';
  expect(sourceAddressCacheKey(song, [setting], 'hires')).not.toBe(original);
  setting.script = 'source-script-A';
  expect(sourceAddressCacheKey(song, [setting], 'hires')).toBe(original);
});

test('fingerprints preserve existing cache keys and all route, track and quality distinctions', () => {
  const script = '原音源脚本\nreturn musicUrl;';
  let fingerprint = 5381;
  for (let index = 0; index < script.length; index += 1)
    fingerprint = (fingerprint * 33 + script.charCodeAt(index)) % 2_147_483_647;
  const setting = { ...source(script), pinnedBackend: 'route-a' };
  const song = track('provider-song');
  const key = sourceAddressCacheKey(song, [setting], 'hires');
  expect(key).toBe(`fingerprint-source:1:${fingerprint.toString(36)}:route-a|kw|provider-song|hires`);
  expect(sourceAddressCacheKey(song, [{ ...setting, pinnedBackend: 'route-b' }], 'hires')).not.toBe(key);
  expect(sourceAddressCacheKey(song, [{ ...setting, version: '2' }], 'hires')).not.toBe(key);
  expect(sourceAddressCacheKey(song, [{ ...setting, id: 'other-source' }], 'hires')).not.toBe(key);
  expect(sourceAddressCacheKey(song, [setting], 'flac')).not.toBe(key);
  expect(sourceAddressCacheKey(track('other-song'), [setting], 'hires')).not.toBe(key);
});
