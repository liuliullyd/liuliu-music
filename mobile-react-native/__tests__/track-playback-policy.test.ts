import type { Track } from '../src/domain/types';
import {
  clearRuntimeTrackBlacklist,
  filterPlayableCandidates,
  isRuntimeTrackBlocked,
  rejectDeterministicNativeFailure,
  throwIfRuntimeTrackBlocked,
  validateResolvedAudio,
} from '../src/services/trackPlaybackPolicy';
import { clearRuntimeResolutionCache } from '../src/services/sourceRuntime';

const track = (provider: Track['provider'], duration: number): Track => ({
  id: `${provider}-${duration}`,
  title: '测试歌曲',
  artist: '测试歌手',
  album: '测试专辑',
  duration,
  provider,
  providerId: `${provider}-${duration}`,
  coverKey: 'train',
  language: '华语',
  genre: '流行',
  mood: '发现',
  releaseYear: 2026,
});

afterEach(clearRuntimeTrackBlacklist);

test.each(['netease', 'qq', 'kugou', 'kuwo', 'migu'] as const)(
  'filters catalog durations below thirty-five seconds for %s',
  provider => {
    expect(
      filterPlayableCandidates([track(provider, 34), track(provider, 35)]),
    ).toEqual([track(provider, 35)]);
  },
);

test.each(['netease', 'qq', 'kugou', 'kuwo', 'migu'] as const)(
  'accepts positive short or mismatched online music durations for %s without blacklisting', provider => {
    const song = track(provider, 180);
    for (const durationSeconds of [11, 30, 40, 89]) {
      expect(validateResolvedAudio(song, { durationSeconds })).toEqual({ durationSeconds });
      expect(isRuntimeTrackBlocked(song)).toBe(false);
      expect(filterPlayableCandidates([song])).toEqual([song]);
    }
  },
);

test('user cache cleanup does not clear the deterministic playback blacklist', () => {
  const short = track('migu', 180);
  expect(() => validateResolvedAudio(short, { durationSeconds: 0 })).toThrow();
  clearRuntimeResolutionCache();
  expect(isRuntimeTrackBlocked(short)).toBe(true);
});

test.each(['podcast', 'long-audio'])(
  'preserves the existing short and ratio gates for %s', mediaType => {
    const spoken = { ...track('qq', 180), metadata: { mediaType } };
    expect(() => validateResolvedAudio(spoken, { durationSeconds: 11 })).toThrow();
    clearRuntimeTrackBlacklist();
    expect(() => validateResolvedAudio(spoken, { durationSeconds: 40 })).toThrow();
  },
);

test.each([
  ['AUDIO_NO_TRACK', 'no-audio-track'],
  ['AUDIO_DURATION_UNREADABLE', 'duration-unreadable'],
  ['AUDIO_NO_FRAMES', 'no-audio-frames'],
])('preserves %s rejection and does not relabel it as a music preview', (code, reason) => {
  const song = track('qq', 180);
  expect(() => rejectDeterministicNativeFailure(song, { code })).toThrow();
  expect(isRuntimeTrackBlocked(song)).toBe(true);
  try { throwIfRuntimeTrackBlocked(song); }
  catch (error) {
    expect(error).toMatchObject({ reason });
    expect((error as Error).message).not.toContain('试听片段');
  }
});

test('accepts a real duration at both the absolute and relative boundaries', () => {
  expect(
    validateResolvedAudio(track('qq', 70), { durationSeconds: 35 }),
  ).toMatchObject({ durationSeconds: 35 });
});
