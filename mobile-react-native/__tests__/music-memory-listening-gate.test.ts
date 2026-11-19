import type { HistoryEntry, MusicProfile, Track } from '../src/domain/types';
import { accumulateMusicStatistics, emptyMusicStatistics, memoryStatisticsFor } from '../src/services/musicPreferenceStatistics';
import { MusicMemoryPlaybackRecorder } from '../src/services/musicMemoryPlayback';
import { trackQueueKey, type NativePlayerState } from '../src/domain/types';

const track: Track = { id: 'memory-track', provider: 'qq', title: 'A', artist: 'Artist', album: 'Album', duration: 240, language: '华语', genre: '流行', mood: '发现', coverKey: 'train', releaseYear: 2026, metadata: { genre: 'rock' } };
const profile: MusicProfile = { artists: {}, languages: {}, genres: {}, moods: {}, timeSlots: {}, longTermTrackIds: [], shortTermTrackIds: [], sessionTrackIds: [] };
const entry = (seconds: number, id = String(seconds)): HistoryEntry => ({ track: { ...track, id }, playedAt: 1000, listenedSeconds: seconds, completed: false, skipped: false });

test('recall history admits only finite actual listening totals of at least 30 seconds', () => {
  const result = memoryStatisticsFor(profile, [entry(0), entry(29.999), entry(30), entry(31), entry(Infinity), entry(NaN)]);
  expect(result.samples).toBe(2);
});

test('an old immediate-play aggregate cannot bypass the new listening threshold', () => {
  const old = accumulateMusicStatistics(emptyMusicStatistics(), track);
  expect(memoryStatisticsFor({ ...profile, memoryStatistics: old }, [entry(0)]).samples).toBe(0);
});

test('migration reconstructs only eligible history and preserves the other profile signals', () => {
  const old = { ...profile, artists: { keep: 7 }, memoryStatistics: accumulateMusicStatistics(emptyMusicStatistics(), track) };
  expect(memoryStatisticsFor(old, [entry(29), entry(35)]).samples).toBe(1);
  expect(old.artists).toEqual({ keep: 7 });
  expect(old.memoryStatistics.samples).toBe(1);
});

const listening = (seconds: number, sequence = 1, key = trackQueueKey(track)): NonNullable<NativePlayerState['listening']> => ({
  sequence, mediaId: key, seconds,
  qualified: [{ sequence, mediaId: key, seconds }],
});

test('a playhead seek past 30 and unqualified native playback do not create a sample', () => {
  const recorder = new MusicMemoryPlaybackRecorder();
  recorder.confirm(track);
  expect(recorder.observe(undefined)).toEqual([]);
  expect(recorder.observe({ ...listening(130), seconds: 2, qualified: [] })).toEqual([]);
  expect(recorder.observe(listening(29.999))).toEqual([]);
  expect(recorder.observe(listening(Infinity))).toEqual([]);
  expect(recorder.observe(listening(NaN))).toEqual([]);
});

test('a native 30-second qualification is counted once across repeated polls and events', () => {
  const recorder = new MusicMemoryPlaybackRecorder();
  recorder.confirm(track);
  expect(recorder.observe(listening(30))).toEqual([track]);
  expect(recorder.observe(listening(45))).toEqual([]);
  expect(recorder.observe(listening(120))).toEqual([]);
});

test('a new actual 30-second replay of the same song counts as a new play', () => {
  const recorder = new MusicMemoryPlaybackRecorder();
  recorder.confirm(track);
  expect(recorder.observe(listening(30, 1))).toEqual([track]);
  expect(recorder.observe(listening(30, 2))).toEqual([track]);
  expect(recorder.observe(listening(90, 1))).toEqual([]);
});

test('outgoing qualification can be consumed after a quick switch without changing the current track', () => {
  const recorder = new MusicMemoryPlaybackRecorder();
  recorder.confirm(track);
  const next = { ...track, id: 'next' };
  recorder.confirm(next);
  expect(recorder.observe({ ...listening(0, 2, trackQueueKey(next)), qualified: listening(30, 1).qualified })).toEqual([track]);
});

test('foreign identities and spoken media cannot enter the music profile', () => {
  const recorder = new MusicMemoryPlaybackRecorder();
  expect(recorder.observe(listening(60))).toEqual([]);
  recorder.confirm({ ...track, metadata: { mediaType: 'podcast' } });
  expect(recorder.observe(listening(60))).toEqual([]);
  recorder.confirm(track);
  expect(recorder.observe(listening(60))).toEqual([track]);
});

test('qualified statistics survive restart without reseeding or admitting quick history', () => {
  const seeded = memoryStatisticsFor(profile, []);
  const stats = accumulateMusicStatistics(seeded, track);
  const restored = JSON.parse(JSON.stringify(stats));
  expect(memoryStatisticsFor({ ...profile, memoryStatistics: restored }, [entry(0)])).toEqual(stats);
  expect(stats.minimumListenedSeconds).toBe(30);
  expect(stats.samples).toBe(1);
});
